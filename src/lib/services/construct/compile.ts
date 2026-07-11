import type { CompileResult, ProjectedFace, Vec2 } from "@/lib/services/construct/types";
import type { ConstructSpec, Solid } from "@/lib/validation/constructSchema";
import { AppError } from "@/lib/services/apiError";
import { CONSTRUCT_LIMITS } from "@/lib/config/limits";
import { convexHull2D, flattenToContours } from "@/lib/services/construct/geometry2d";
import { parsePathData } from "@/lib/services/construct/pathParse";
import { normalizeSelfUnion } from "@/lib/services/construct/pathBoolean";
import {
  applyCutout,
  collectConsumed,
  createShapeResolver,
  unknownRefError,
  type DrawEntry,
} from "@/lib/services/construct/resolve2d";
import {
  boxMesh,
  coneMesh,
  cylinderMesh,
  extrudeMesh,
  meshRadius,
  sphereMesh,
  transformMesh,
} from "@/lib/services/construct/geometry3d";
import { composePlacement4, normalize3, transformPoint, centroid3, faceNormal } from "@/lib/services/construct/math3d";
import {
  autoDistance,
  CAMERA_PRESETS,
  projectViewPoint,
  viewMatrix,
  viewNormal,
  type Projection,
} from "@/lib/services/construct/camera";
import { overlapWarnings, projectAndSort, type SolidSceneItem } from "@/lib/services/construct/painterSort";
import {
  applyLuminance,
  lambertFactor,
  luminance,
  parseHex,
  shadeFaceHex,
  sideGradient,
  sphereGradient,
  type GradientDescriptor,
  type LightParams,
} from "@/lib/services/construct/shading";
import {
  countFragmentPathCommands,
  emitFragment,
  faceToPathData,
  type PathItem,
} from "@/lib/services/construct/svgEmitter";
import { sanitizeSvg } from "@/lib/services/svgRenderer";

/**
 * compile — orchestrator của construct engine: spec kỷ hà → SVG fragment.
 * Pure (không I/O); mọi lỗi là CONSTRUCTION_INVALID kèm hint hành động được.
 * Tầng 2D (resolve refs + cutouts) ở resolve2d.ts.
 */

function err(message: string, hint: string): never {
  throw new AppError("CONSTRUCTION_INVALID", message, hint);
}

interface SmoothSolidInfo {
  readonly solid: Solid;
  readonly solidIndex: number;
  readonly kind: "sphere" | "cylinder" | "cone";
}

const FLATTEN_STEPS = 8;

export function compileConstruction(spec: ConstructSpec): CompileResult {
  const t0 = performance.now();
  const checkClock = (stage: string) => {
    if (performance.now() - t0 > CONSTRUCT_LIMITS.maxCompileMs) {
      err(
        `Compile exceeded ${CONSTRUCT_LIMITS.maxCompileMs}ms at stage "${stage}" — spec too complex.`,
        'Reduce "segments", shape counts, or boolean operand sizes.',
      );
    }
  };
  const warnings: string[] = [];

  // ---------- Id namespace chung + duplicate ----------
  const allIds: string[] = [];
  const seen = new Map<string, string>();
  spec.shapes.forEach((s, i) => {
    if (seen.has(s.id)) err(`Duplicate id "${s.id}" (${seen.get(s.id)} and shapes[${i}]).`, "Ids are global across shapes and solids — rename one.");
    seen.set(s.id, `shapes[${i}]`);
    allIds.push(s.id);
  });
  spec.solids.forEach((s, i) => {
    if (seen.has(s.id)) err(`Duplicate id "${s.id}" (${seen.get(s.id)} and solids[${i}]).`, "Ids are global across shapes and solids — rename one.");
    seen.set(s.id, `solids[${i}]`);
    allIds.push(s.id);
  });

  const shapeMap = new Map(spec.shapes.map((s) => [s.id, s]));
  const solidMap = new Map(spec.solids.map((s) => [s.id, s]));

  // ---------- Resolve 2D shapes (resolve2d.ts) ----------
  const resolver = createShapeResolver({
    shapeMap,
    allIds,
    precision: spec.precision,
    warnings,
    checkClock,
  });
  for (const shape of spec.shapes) resolver.resolve(shape.id, "shapes", 0);
  checkClock("shapes");

  // ---------- Consumed set + emitted 2D ----------
  const consumed = collectConsumed(spec);

  let emittedShapeIds: string[];
  if (spec.emit) {
    for (const ref of spec.emit) {
      if (!shapeMap.has(ref)) unknownRefError(ref, '"emit"', allIds);
    }
    emittedShapeIds = spec.emit;
  } else {
    emittedShapeIds = spec.shapes.filter((s) => !consumed.has(s.id)).map((s) => s.id);
  }

  // ---------- Solids → meshes ----------
  const light = spec.light;
  const facetedItems: SolidSceneItem[] = [];
  const smoothInfos = new Map<string, SmoothSolidInfo>();
  let facesGenerated = 0;

  spec.solids.forEach((solid, solidIndex) => {
    if (solid.shading !== "none" && solid.fill && !parseHex(solid.fill)) {
      err(
        `Solid "${solid.id}" uses fill "${solid.fill}" with shading enabled.`,
        'Shading needs a hex base color to derive tones — use "#hex", or set shading:"none" to pass the fill through.',
      );
    }

    let mesh;
    let smoothKind: SmoothSolidInfo["kind"] | null = null;
    switch (solid.type) {
      case "box":
        mesh = boxMesh(solid.size);
        break;
      case "cylinder":
        mesh = cylinderMesh(solid.r, solid.h, solid.segments);
        smoothKind = "cylinder";
        break;
      case "cone":
        mesh = coneMesh(solid.r, solid.rTop, solid.h, solid.segments);
        smoothKind = "cone";
        break;
      case "sphere":
        mesh = sphereMesh(solid.r, solid.segments);
        smoothKind = "sphere";
        break;
      case "prism":
        mesh = cylinderMesh(solid.r, solid.h, solid.sides);
        break;
      case "pyramid":
        mesh = coneMesh(solid.r, 0, solid.h, solid.sides);
        break;
      case "extrude": {
        const profile = resolver.resolve(solid.profile, `"${solid.id}".profile`, 0);
        if (profile.shape.type === "line") {
          err(`Extrude profile "${solid.profile}" is an open path.`, "Extrusion needs a closed profile — close the path or use polygon/rect/circle.");
        }
        if (profile.isEmpty) {
          err(`Extrude profile "${solid.profile}" is empty (boolean produced no area).`, 'Check the operand offsets — shapes are centered at [0,0] by default.');
        }
        const normalized = normalizeSelfUnion(profile.d, spec.precision, solid.profile);
        const contours = flattenToContours(parsePathData(normalized, solid.profile), FLATTEN_STEPS);
        mesh = extrudeMesh(contours, solid.depth);
        break;
      }
    }

    const isSmooth =
      smoothKind !== null && (solid.shading === "smooth" || solid.shading === "auto");
    const world = transformMesh(
      composePlacement4(solid.at, solid.rotate, solid.scale),
      mesh,
    );
    facesGenerated += world.faces.length;
    if (isSmooth) {
      smoothInfos.set(solid.id, { solid, solidIndex, kind: smoothKind! });
    }
    facetedItems.push({ solidId: solid.id, solidIndex, mesh: world });
  });

  if (facesGenerated > CONSTRUCT_LIMITS.maxTotalFaces) {
    err(
      `Scene tessellates to ${facesGenerated.toLocaleString("en-US")} faces (max ${CONSTRUCT_LIMITS.maxTotalFaces.toLocaleString("en-US")}).`,
      'Reduce segments (cylinder/sphere "segments") or split into multiple constructions.',
    );
  }
  checkClock("meshes");

  // ---------- Camera ----------
  const orbit = spec.camera.orbit ?? CAMERA_PRESETS[spec.camera.preset ?? "isometric"];
  const view = viewMatrix({ azimuth: orbit.azimuth, elevation: orbit.elevation, roll: orbit.roll ?? 0 });
  const projection: Projection =
    spec.camera.projection === "perspective"
      ? {
          kind: "perspective",
          zoom: spec.camera.zoom,
          distance: spec.camera.distance ?? autoDistance(meshRadius(facetedItems.map((i) => i.mesh))),
        }
      : { kind: "orthographic", zoom: spec.camera.zoom };

  const lightView = viewNormal(view, normalize3(light.direction));
  const lightParams: LightParams = {
    direction: lightView,
    tones: light.tones,
    ambient: light.ambient,
    mode: light.mode,
  };
  // Hướng sáng chiếu lên màn hình (cho gradient smooth)
  const lightScreenRaw: Vec2 = [lightView[0], -lightView[1]];
  const lightScreenLen = Math.hypot(lightScreenRaw[0], lightScreenRaw[1]) || 1;
  const lightScreen: Vec2 = [lightScreenRaw[0] / lightScreenLen, lightScreenRaw[1] / lightScreenLen];

  // ---------- Chiếu + sort ----------
  const facetedForSort = facetedItems.filter((i) => !smoothInfos.has(i.solidId));
  const sortedFaces = projectAndSort(facetedForSort, view, projection);

  // Solid smooth → silhouette hull + nắp trên (nếu thấy được)
  interface SmoothItem {
    readonly face: ProjectedFace;
    readonly fill: string;
  }
  const gradients: GradientDescriptor[] = [];
  const smoothItems: SmoothItem[] = [];

  for (const info of smoothInfos.values()) {
    const item = facetedItems[info.solidIndex];
    const viewVerts = item.mesh.vertices.map((v) => transformPoint(view, v));
    const projected = viewVerts.map((v) => projectViewPoint(v, projection).screen);
    const hull = convexHull2D(projected);
    const depth = centroid3(viewVerts)[2];
    const base = info.solid.fill ?? "#c0c0c0";

    let fill: string;
    if (info.solid.shading === "none") {
      fill = base;
    } else if (info.kind === "sphere") {
      const g = sphereGradient(info.solid.id, base, lightParams, [lightScreen[0], lightScreen[1]]);
      gradients.push(g);
      fill = `url(#${g.id})`;
    } else {
      const g = sideGradient(info.solid.id, base, lightParams, lightScreen[0]);
      gradients.push(g);
      fill = `url(#${g.id})`;
    }
    smoothItems.push({
      face: {
        points: hull,
        depth,
        normal: [0, 0, 1],
        solidId: info.solid.id,
        solidIndex: info.solidIndex,
        faceIndex: -1,
        label: "silhouette",
      },
      fill,
    });

    // Nắp trên trụ/nón cụt: vẽ đè lên silhouette nếu quay về camera
    if (info.kind !== "sphere" && info.solid.shading !== "none") {
      const capFace = item.mesh.faces.find((f) => f.label === "top");
      if (capFace) {
        const capViewPts = capFace.vertices.map((i) => viewVerts[i]);
        const capNormal = faceNormal(capViewPts);
        if (capNormal[2] > 0) {
          const factor = lambertFactor(capNormal, lightView);
          smoothItems.push({
            face: {
              points: capViewPts.map((v) => projectViewPoint(v, projection).screen),
              depth: depth + 1e-6, // luôn ngay trên silhouette của chính nó
              normal: capNormal,
              solidId: info.solid.id,
              solidIndex: info.solidIndex,
              faceIndex: -2,
              label: "top",
            },
            fill: applyLuminance(base, luminance(factor, light.ambient)),
          });
        }
      }
    }
  }
  checkClock("projection");

  // ---------- Hợp nhất thứ tự vẽ ----------
  const entries: DrawEntry[] = [
    ...sortedFaces.map((face): DrawEntry => ({ face, decals: [] })),
    ...smoothItems.map((s): DrawEntry => ({ face: s.face, fillOverride: s.fill, decals: [] })),
  ].sort((a, b) => {
    if (a.face.depth !== b.face.depth) return a.face.depth - b.face.depth;
    if (a.face.solidIndex !== b.face.solidIndex) return a.face.solidIndex - b.face.solidIndex;
    return a.face.faceIndex - b.face.faceIndex;
  });

  // ---------- Cutouts (resolve2d.ts) ----------
  for (const cutout of spec.cutouts) {
    applyCutout(cutout, entries, {
      solidMap,
      smoothKindOf: (solidId) => smoothInfos.get(solidId)?.kind,
      resolver,
      allIds,
      precision: spec.precision,
      warnings,
      checkClock,
    });
  }

  // ---------- Ghép PathItems ----------
  const paths: PathItem[] = [];
  const globalStroke = spec.stroke;

  // 2D shapes trước (nền phẳng), theo thứ tự khai báo
  for (const id of emittedShapeIds) {
    const r = resolver.resolved.get(id)!;
    if (r.isEmpty) {
      warnings.push(`"${id}" (${r.shape.type === "boolean" ? r.shape.op : r.shape.type}) produced an empty path — skipped.`);
      continue;
    }
    if (r.shape.type === "line") {
      paths.push({
        d: r.d,
        fill: "none",
        stroke: r.shape.stroke ?? "#333333",
        strokeWidth: r.shape.strokeWidth,
      });
    } else {
      paths.push({
        d: r.d,
        fill: r.shape.fill ?? "#c0c0c0",
        fillRule: "nonzero",
        stroke: r.shape.stroke ?? globalStroke?.color,
        strokeWidth: r.shape.strokeWidth ?? globalStroke?.width,
      });
    }
  }

  // 3D faces theo painter order
  for (const entry of entries) {
    const solid = solidMap.get(entry.face.solidId)!;
    const base = solid.fill ?? "#c0c0c0";
    let fill: string;
    if (entry.fillOverride) {
      fill = entry.fillOverride;
    } else if (solid.shading === "none") {
      fill = base;
    } else {
      fill = shadeFaceHex(base, entry.face.normal, lightParams);
    }
    paths.push({
      d: entry.dOverride ?? faceToPathData(entry.face, spec.precision),
      fill,
      fillRule: entry.face.holes ? "evenodd" : undefined,
      stroke: globalStroke?.color,
      strokeWidth: globalStroke?.width,
    });
    paths.push(...entry.decals);
  }

  if (paths.length === 0) {
    err("Nothing to emit — all shapes were consumed or empty.", 'Add shapes/solids, or list ids in "emit" to force-output consumed shapes.');
  }

  // ---------- Emit + guard cuối ----------
  const svg = emitFragment(gradients, paths, spec.place, spec.precision);

  const bytes = Buffer.byteLength(svg, "utf8");
  if (bytes > CONSTRUCT_LIMITS.maxOutputBytes) {
    err(
      `Compiled SVG is ${Math.round(bytes / 1024)}KB (max ${Math.round(CONSTRUCT_LIMITS.maxOutputBytes / 1024)}KB).`,
      'Lower "precision", reduce "segments", or split into multiple constructions.',
    );
  }
  const pathCommands = countFragmentPathCommands(svg);
  if (pathCommands > CONSTRUCT_LIMITS.maxPathCommandsOut) {
    err(
      `Compiled SVG has ${pathCommands.toLocaleString("en-US")} path commands (max ${CONSTRUCT_LIMITS.maxPathCommandsOut.toLocaleString("en-US")}).`,
      'Reduce "segments" or shape complexity.',
    );
  }
  // Bảo đảm runtime: output LUÔN qua được sanitizer của pipeline artwork
  sanitizeSvg(svg, "frame");

  warnings.push(...overlapWarnings(facetedItems));

  return {
    svg,
    stats: {
      shapes: spec.shapes.length,
      solids: spec.solids.length,
      facesGenerated,
      facesEmitted: entries.length,
      pathCommands,
      bytes,
      compileMs: Math.round((performance.now() - t0) * 10) / 10,
    },
    warnings,
  };
}
