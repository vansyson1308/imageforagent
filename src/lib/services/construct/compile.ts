import type { CompileResult, ProjectedFace, Vec2 } from "@/lib/services/construct/types";
import type { ConstructSpec, Shape2D, Solid, Cutout } from "@/lib/validation/constructSchema";
import { AppError } from "@/lib/services/apiError";
import { CONSTRUCT_LIMITS } from "@/lib/config/limits";
import {
  circlePath,
  convexHull2D,
  ellipsePath,
  flattenToContours,
  linePath,
  placementToAffine,
  polygonPath,
  rectPath,
  regularPolygonPath,
  segmentsToPathData,
  starPath,
  transformSegments,
  type Segment2D,
} from "@/lib/services/construct/geometry2d";
import { parsePathData } from "@/lib/services/construct/pathParse";
import { normalizeSelfUnion, runBoolean } from "@/lib/services/construct/pathBoolean";
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
 */

function err(message: string, hint: string): never {
  throw new AppError("CONSTRUCTION_INVALID", message, hint);
}

/** Levenshtein cho gợi ý "Did you mean". */
function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let j = 1; j <= b.length; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const tmp = dp[i];
      dp[i] = Math.min(dp[i] + 1, dp[i - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[a.length];
}

function unknownRefError(ref: string, context: string, known: readonly string[]): never {
  const nearest = [...known].sort((a, b) => levenshtein(ref, a) - levenshtein(ref, b))[0];
  const suggestion = nearest && levenshtein(ref, nearest) <= 3 ? `Did you mean "${nearest}"? ` : "";
  err(
    `Shape ref "${ref}" not found in ${context}.`,
    `${suggestion}Defined ids: ${known.join(", ") || "(none)"}.`,
  );
}

interface ResolvedShape {
  readonly shape: Shape2D;
  /** Path data cuối (đã transform + boolean). */
  readonly d: string;
  /** true nếu boolean cho kết quả rỗng. */
  readonly isEmpty: boolean;
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

  // ---------- Resolve 2D shapes (topo qua đệ quy có memo + cycle detect) ----------
  const resolved = new Map<string, ResolvedShape>();
  const resolving = new Set<string>();

  function primitiveSegments(shape: Shape2D): Segment2D[] {
    switch (shape.type) {
      case "rect":
        return rectPath(shape.w, shape.h, shape.rx);
      case "circle":
        return circlePath(shape.r);
      case "ellipse":
        return ellipsePath(shape.rx, shape.ry);
      case "polygon":
        return polygonPath(shape.points);
      case "regularPolygon":
        return regularPolygonPath(shape.sides, shape.r);
      case "star":
        return starPath(shape.points, shape.rOuter, shape.rInner);
      case "line":
        return linePath(shape.points);
      case "path":
        return parsePathData(shape.d, shape.id);
      case "boolean":
        throw new Error("unreachable");
    }
  }

  function resolveShape(id: string, context: string, depth: number): ResolvedShape {
    const cached = resolved.get(id);
    if (cached) return cached;
    const shape = shapeMap.get(id);
    if (!shape) unknownRefError(id, context, allIds);
    if (depth > CONSTRUCT_LIMITS.maxOpDepth) {
      err(`Boolean nesting deeper than ${CONSTRUCT_LIMITS.maxOpDepth} at "${id}".`, "Flatten the boolean tree — most artwork needs 2-3 levels.");
    }
    if (resolving.has(id)) {
      err(`Boolean "${id}" is part of a reference cycle: ${[...resolving, id].join(" → ")}.`, "Boolean ops must form a tree — remove the back-reference.");
    }

    let result: ResolvedShape;
    if (shape.type === "boolean") {
      resolving.add(id);
      const operands = shape.of.map((ref) => {
        const op = resolveShape(ref, `"${id}".of`, depth + 1);
        if (op.shape.type === "line") {
          err(`Boolean "${id}" references line "${ref}" — open strokes cannot participate in booleans.`, "Use a closed shape (rect/circle/polygon/path with Z) instead.");
        }
        return op;
      });
      resolving.delete(id);
      const nonEmpty = operands.filter((o) => !o.isEmpty);
      if (nonEmpty.length < 2 && operands.some((o) => o.isEmpty)) {
        warnings.push(`Boolean "${id}": some operands are empty — result may be unexpected.`);
      }
      const bool = runBoolean(shape.op, operands.map((o) => o.d), spec.precision, id);
      // Placement của chính boolean node áp dụng SAU phép toán
      let d = bool.d;
      if (!bool.isEmpty && hasPlacement(shape)) {
        const segs = transformSegments(parsePathData(bool.d, id), placementToAffine(shape));
        d = segmentsToPathData(segs, spec.precision);
      }
      result = { shape, d, isEmpty: bool.isEmpty };
      checkClock(`boolean "${id}"`);
    } else {
      const segs = transformSegments(primitiveSegments(shape), placementToAffine(shape));
      result = { shape, d: segmentsToPathData(segs, spec.precision), isEmpty: false };
    }
    resolved.set(id, result);
    return result;
  }

  function hasPlacement(s: Shape2D): boolean {
    return (
      s.at[0] !== 0 || s.at[1] !== 0 || s.rotate !== 0 || s.skew[0] !== 0 || s.skew[1] !== 0 ||
      s.mirror !== undefined || (typeof s.scale === "number" ? s.scale !== 1 : true)
    );
  }

  for (const shape of spec.shapes) resolveShape(shape.id, "shapes", 0);
  checkClock("shapes");

  // ---------- Consumed set + emitted 2D ----------
  const consumed = new Set<string>();
  for (const s of spec.shapes) if (s.type === "boolean") s.of.forEach((r) => consumed.add(r));
  for (const s of spec.solids) if (s.type === "extrude") consumed.add(s.profile);
  for (const c of spec.cutouts) consumed.add(c.shape);

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
        const profile = resolveShape(solid.profile, `"${solid.id}".profile`, 0);
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
    readonly isCap?: boolean;
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
            isCap: true,
          });
        }
      }
    }
  }
  checkClock("projection");

  // ---------- Hợp nhất thứ tự vẽ ----------
  interface DrawEntry {
    readonly face: ProjectedFace;
    readonly fillOverride?: string;
  }
  const drawList: DrawEntry[] = [
    ...sortedFaces.map((face) => ({ face })),
    ...smoothItems.map((s) => ({ face: s.face, fillOverride: s.fill })),
  ].sort((a, b) => {
    if (a.face.depth !== b.face.depth) return a.face.depth - b.face.depth;
    if (a.face.solidIndex !== b.face.solidIndex) return a.face.solidIndex - b.face.solidIndex;
    return a.face.faceIndex - b.face.faceIndex;
  });

  // ---------- Cutouts (boolean 2D sau chiếu) ----------
  interface MutableEntry {
    face: ProjectedFace;
    fillOverride?: string;
    dOverride?: string;
    decals: PathItem[];
  }
  const entries: MutableEntry[] = drawList.map((e) => ({ ...e, decals: [] }));

  for (const cutout of spec.cutouts) {
    applyCutout(cutout, entries);
  }

  function applyCutout(cutout: Cutout, list: MutableEntry[]): void {
    const solid = solidMap.get(cutout.solid);
    if (!solid) unknownRefError(cutout.solid, "cutouts[].solid", allIds);
    const isSmoothTarget = smoothInfos.has(cutout.solid);

    let target: MutableEntry | undefined;
    if (isSmoothTarget) {
      if (cutout.mode === "subtract") {
        err(
          `Cutout target "${cutout.solid}" is a smooth ${smoothInfos.get(cutout.solid)!.kind}.`,
          'Overlay maps to the silhouette plane; "subtract" requires a flat face (box, prism, extrude) or shading:"faceted".',
        );
      }
      target = list.find((e) => e.face.solidId === cutout.solid && e.face.label === "silhouette");
    } else if (typeof cutout.face === "string") {
      target = list.find((e) => e.face.solidId === cutout.solid && e.face.label === cutout.face);
    } else {
      target = list.find((e) => e.face.solidId === cutout.solid && e.face.faceIndex === cutout.face);
    }
    if (!target) {
      const available = list
        .filter((e) => e.face.solidId === cutout.solid)
        .map((e) => e.face.label ?? String(e.face.faceIndex));
      err(
        `Cutout face "${String(cutout.face)}" of "${cutout.solid}" is not visible from this camera.`,
        `Visible faces of "${cutout.solid}": ${available.join(", ") || "(none)"} — change the camera or the face.`,
      );
    }

    const shapeRes = resolveShape(cutout.shape, "cutouts[].shape", 0);
    if (shapeRes.shape.type === "line") {
      err(`Cutout shape "${cutout.shape}" is an open line.`, "Use a closed shape for cutouts.");
    }
    // Đặt shape tại tâm mặt đã chiếu + offset at (toạ độ màn hình)
    const pts = target.face.points;
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    const affine = placementToAffine({
      at: [cx + cutout.at[0], cy + cutout.at[1]],
      rotate: cutout.rotate,
      scale: cutout.scale,
    });
    const shapeD = segmentsToPathData(
      transformSegments(parsePathData(shapeRes.d, cutout.shape), affine),
      spec.precision,
    );

    const faceD = target.dOverride ?? faceToPathData(target.face, spec.precision);
    if (cutout.mode === "subtract") {
      const result = runBoolean("difference", [faceD, shapeD], spec.precision, `cutout on "${cutout.solid}"`);
      if (result.isEmpty) {
        warnings.push(`Cutout on "${cutout.solid}" removed the entire face.`);
      }
      target.dOverride = result.d;
    } else {
      const clipped = runBoolean("intersection", [shapeD, faceD], spec.precision, `cutout on "${cutout.solid}"`);
      if (clipped.isEmpty) {
        warnings.push(`Overlay cutout on "${cutout.solid}" does not intersect the face — skipped.`);
      } else {
        target.decals.push({
          d: clipped.d,
          fill: cutout.fill ?? shapeRes.shape.fill ?? "#c0c0c0",
          fillRule: "nonzero",
        });
      }
    }
    checkClock("cutouts");
  }

  // ---------- Ghép PathItems ----------
  const paths: PathItem[] = [];
  const globalStroke = spec.stroke;

  // 2D shapes trước (nền phẳng), theo thứ tự khai báo
  for (const id of emittedShapeIds) {
    const r = resolved.get(id)!;
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
