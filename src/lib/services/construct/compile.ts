import type { CompileResult, ProjectedFace, Vec2 } from "@/lib/services/construct/types";
import type { ConstructSpec, Solid } from "@/lib/validation/constructSchema";
import { AppError } from "@/lib/services/apiError";
import { CONSTRUCT_LIMITS } from "@/lib/config/limits";
import { convexHull2D, flattenToContours } from "@/lib/services/construct/geometry2d";
import { parsePathData } from "@/lib/services/construct/pathParse";
import { normalizeSelfUnion } from "@/lib/services/construct/pathBoolean";
import { relativeEps, weldVertices, type Polygon3 } from "@/lib/services/construct/plane3";
import { csgOperation, meshToPolygons, prepareOperand } from "@/lib/services/construct/csg";
import { repairPolygons, repairedToMesh } from "@/lib/services/construct/meshRepair";
import { buildShadowLayer, type ShadowLayer } from "@/lib/services/construct/shadow";
import { faceGradientFill } from "@/lib/services/construct/faceGradient";
import { expandParts } from "@/lib/services/construct/partsExpand";
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
import { depthOrderNNS } from "@/lib/services/construct/depthOrder";
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

  // ---------- Stage 1: expand parts + groups (Layer 5, TRƯỚC id collect) ----------
  const expanded = expandParts(spec);
  warnings.push(...expanded.warnings);
  spec = { ...spec, shapes: expanded.shapes, solids: expanded.solids };
  const worldMatrixById = expanded.worldMatrixById;
  checkClock("expand");

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

  // ---------- Solids → meshes (csg node resolve sau) ----------
  const light = spec.light;
  const facetedItems: SolidSceneItem[] = [];
  const smoothInfos = new Map<string, SmoothSolidInfo>();
  /** World mesh của MỌI solid không-csg (kể cả operand bị tiêu thụ). */
  const worldMeshById = new Map<string, { mesh: ReturnType<typeof transformMesh>; solidIndex: number }>();
  const solidIndexById = new Map(spec.solids.map((s, i) => [s.id, i]));

  // Operand của csg bị tiêu thụ — không vẽ riêng, không smooth
  const csgConsumed = new Set<string>();
  for (const s of spec.solids) {
    if (s.type === "csg") s.of.forEach((ref) => csgConsumed.add(ref));
  }

  spec.solids.forEach((solid, solidIndex) => {
    if (solid.shading !== "none" && solid.fill && !parseHex(solid.fill)) {
      err(
        `Solid "${solid.id}" uses fill "${solid.fill}" with shading enabled.`,
        'Shading needs a hex base color to derive tones — use "#hex", or set shading:"none" to pass the fill through.',
      );
    }
    if (solid.type === "csg") {
      if (solid.shading === "smooth") {
        err(
          `CSG "${solid.id}" cannot use shading:"smooth".`,
          'CSG results are faceted — use shading:"auto" (faceted) or "none".',
        );
      }
      return; // resolve ở stage CSG bên dưới
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

    const world = transformMesh(
      worldMatrixById.get(solid.id) ?? composePlacement4(solid.at, solid.rotate, solid.scale),
      mesh,
    );
    worldMeshById.set(solid.id, { mesh: world, solidIndex });
    if (csgConsumed.has(solid.id)) return; // chỉ làm nguyên liệu CSG

    const isSmooth =
      smoothKind !== null && (solid.shading === "smooth" || solid.shading === "auto");
    if (isSmooth) {
      smoothInfos.set(solid.id, { solid, solidIndex, kind: smoothKind! });
    }
    // Extrude có thể lõm/có lỗ — mọi primitive khác lồi
    facetedItems.push({ solidId: solid.id, solidIndex, mesh: world, convex: solid.type !== "extrude" });
  });

  // ---------- Stage CSG (Layer 1): resolve DAG bottom-up ----------
  const csgNodes = spec.solids.filter((s) => s.type === "csg");
  if (csgNodes.length > CONSTRUCT_LIMITS.maxCsgOps) {
    err(
      `Spec has ${csgNodes.length} csg nodes (max ${CONSTRUCT_LIMITS.maxCsgOps}).`,
      "Merge operations or split into multiple constructions.",
    );
  }
  if (csgNodes.length > 0) {
    const sceneRadius = meshRadius([...worldMeshById.values()].map((e) => e.mesh));
    const eps = relativeEps(sceneRadius);
    const csgResolved = new Map<string, Polygon3[]>();
    const csgResolving = new Set<string>();

    const resolveCsgPolygons = (id: string, context: string, depth: number): Polygon3[] => {
      const cached = csgResolved.get(id);
      if (cached) return cached;
      const solid = solidMap.get(id);
      if (!solid) unknownRefError(id, context, allIds);
      if (depth > CONSTRUCT_LIMITS.maxOpDepth) {
        err(`CSG nesting deeper than ${CONSTRUCT_LIMITS.maxOpDepth} at "${id}".`, "Flatten the csg tree.");
      }
      if (solid.type !== "csg") {
        const entry = worldMeshById.get(id);
        if (!entry) unknownRefError(id, context, allIds);
        const prep = prepareOperand(
          entry.mesh,
          { solidId: id, solidIndex: entry.solidIndex, fill: solid.fill },
          eps,
        );
        if (prep.degraded) {
          warnings.push(`CSG operand "${id}": concave face triangulation degraded — result may have artifacts.`);
        }
        return prep.polygons;
      }
      if (csgResolving.has(id)) {
        err(`CSG "${id}" is part of a reference cycle: ${[...csgResolving, id].join(" → ")}.`, "CSG ops must form a tree — remove the back-reference.");
      }
      csgResolving.add(id);
      const operands = solid.of.map((ref) => resolveCsgPolygons(ref, `"${id}".of`, depth + 1));
      csgResolving.delete(id);

      // Compact giữa các phép fold: BSP làm mặt phân mảnh TÍCH LUỸ qua
      // chuỗi op — gộp đồng phẳng + re-triangulate giữ tăng trưởng bị chặn
      const compact = (polys: Polygon3[]): Polygon3[] => {
        const mesh = repairedToMesh(repairPolygons(polys, eps));
        // meshToPolygons giữ fill/label per-face (face.fill ưu tiên)
        return meshToPolygons(mesh, {
          solidId: id,
          solidIndex: solidIndexById.get(id)!,
        }).polygons;
      };

      let result = operands[0];
      for (let i = 1; i < operands.length; i++) {
        let inputFaces = result.length + operands[i].length;
        if (inputFaces > CONSTRUCT_LIMITS.maxCsgOperandFaces && i > 1) {
          result = weldVertices(compact(result), eps);
          inputFaces = result.length + operands[i].length;
        }
        if (inputFaces > CONSTRUCT_LIMITS.maxCsgOperandFaces) {
          err(
            `CSG "${id}" input has ${inputFaces.toLocaleString("en-US")} faces (max ${CONSTRUCT_LIMITS.maxCsgOperandFaces.toLocaleString("en-US")}).`,
            'Reduce "segments" on curved operands.',
          );
        }
        const opResult = csgOperation(solid.op, result, operands[i], eps, id);
        warnings.push(...opResult.warnings);
        result = opResult.polygons;
        checkClock(`csg "${id}"`);
      }

      // csg.fill override: ghi đè fill kế thừa trên mọi mảnh
      if (solid.fill) {
        result = result.map((p) => ({ ...p, shared: { ...p.shared, fill: solid.fill } }));
      }
      csgResolved.set(id, result);
      return result;
    };

    for (const node of csgNodes) {
      if (csgConsumed.has(node.id)) {
        // Node lồng trong csg khác — cha sẽ gọi; vòng ép-resolve bên dưới
        // bắt được cycle thuần (a↔b không có root)
        continue;
      }
      const polygons = resolveCsgPolygons(node.id, "solids", 0);
      // Layer 3: gộp mảnh đồng phẳng (TRƯỚC placement — repair cần đỉnh
      // welded so theo reference)
      let repaired = repairPolygons(polygons, eps);
      // Placement của csg node áp lên KẾT QUẢ (giống boolean 2D)
      const placement = composePlacement4(node.at, node.rotate, node.scale);
      const isIdentity =
        node.at[0] === 0 && node.at[1] === 0 && node.at[2] === 0 &&
        node.rotate[0] === 0 && node.rotate[1] === 0 && node.rotate[2] === 0 &&
        (typeof node.scale === "number" ? node.scale === 1 : false);
      if (!isIdentity) {
        repaired = repaired.map((f) => ({
          ...f,
          outer: f.outer.map((v) => transformPoint(placement, v)),
          holes: f.holes.map((ring) => ring.map((v) => transformPoint(placement, v))),
        }));
      }
      const solidIndex = solidIndexById.get(node.id)!;
      facetedItems.push({
        solidId: node.id,
        solidIndex,
        mesh: repairedToMesh(repaired),
      });
    }
    // Node csg chưa được resolve (toàn bộ bị tiêu thụ lẫn nhau) → ép resolve
    // để cycle detection báo lỗi rõ thay vì "Nothing to emit"
    for (const node of csgNodes) {
      if (!csgResolved.has(node.id)) resolveCsgPolygons(node.id, "solids", 0);
    }
    checkClock("csg");
  }

  let facesGenerated = 0;
  for (const item of facetedItems) facesGenerated += item.mesh.faces.length;

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

  // ---------- Shadow layer (Layer 4a) ----------
  let shadowLayer: ShadowLayer | null = null;
  if (spec.shadow && spec.shadow.style !== "none") {
    const casting = facetedItems.filter((i) => solidMap.get(i.solidId)!.shadow !== false);
    shadowLayer = buildShadowLayer(
      casting,
      normalize3(light.direction),
      view,
      projection,
      spec.shadow,
      spec.precision,
    );
    warnings.push(...shadowLayer.warnings);
    checkClock("shadow");
  }

  // ---------- Chiếu + sort ----------
  const facetedForSort = facetedItems.filter((i) => !smoothInfos.has(i.solidId));
  let sortedFaces: ProjectedFace[];
  let depthSplits = 0;
  if (spec.depthSort === "exact") {
    const ordered = depthOrderNNS(facetedForSort, view, projection, checkClock);
    sortedFaces = ordered.faces;
    depthSplits = ordered.splits;
    if (ordered.fallback) {
      warnings.push(
        `Depth sort split budget (${CONSTRUCT_LIMITS.maxDepthSplits}) exhausted — remaining faces use painter order.`,
      );
    }
  } else {
    sortedFaces = projectAndSort(facetedForSort, view, projection);
  }

  // Solid smooth → silhouette hull + nắp trên (nếu thấy được)
  interface SmoothItem {
    readonly face: ProjectedFace;
    readonly fill: string;
  }
  const gradients: GradientDescriptor[] = [];
  const smoothItems: SmoothItem[] = [];

  for (const info of smoothInfos.values()) {
    const item = facetedItems.find((i) => i.solidId === info.solid.id)!;
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
  let entries: DrawEntry[];
  if (spec.depthSort === "exact") {
    // Giữ NGUYÊN thứ tự NNS; smooth item chèn theo depth (binary insert)
    entries = sortedFaces.map((face): DrawEntry => ({ face, decals: [] }));
    const smoothSorted = [...smoothItems].sort((a, b) => {
      if (a.face.depth !== b.face.depth) return a.face.depth - b.face.depth;
      if (a.face.solidIndex !== b.face.solidIndex) return a.face.solidIndex - b.face.solidIndex;
      return a.face.faceIndex - b.face.faceIndex;
    });
    for (const s of smoothSorted) {
      let lo = 0;
      let hi = entries.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (entries[mid].face.depth <= s.face.depth) lo = mid + 1;
        else hi = mid;
      }
      entries.splice(lo, 0, { face: s.face, fillOverride: s.fill, decals: [] });
    }
  } else {
    entries = [
      ...sortedFaces.map((face): DrawEntry => ({ face, decals: [] })),
      ...smoothItems.map((s): DrawEntry => ({ face: s.face, fillOverride: s.fill, decals: [] })),
    ].sort((a, b) => {
      if (a.face.depth !== b.face.depth) return a.face.depth - b.face.depth;
      if (a.face.solidIndex !== b.face.solidIndex) return a.face.solidIndex - b.face.solidIndex;
      return a.face.faceIndex - b.face.faceIndex;
    });
  }

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

  // Shadow layer: vẽ SAU solid "nền" (toàn bộ mesh ≤ mặt phẳng bóng —
  // vd sàn/đất), TRƯỚC mọi solid nổi phía trên — bóng nằm ĐÈ lên mặt sàn
  const groundSolidIds = new Set<string>();
  if (shadowLayer && spec.shadow) {
    const groundY = spec.shadow.ground + 1e-6;
    for (const [id, entry] of worldMeshById) {
      if (entry.mesh.vertices.every((v) => v[1] <= groundY)) groundSolidIds.add(id);
    }
  }
  const groundEntries = shadowLayer
    ? entries.filter((e) => groundSolidIds.has(e.face.solidId))
    : [];
  const floatingEntries = shadowLayer
    ? entries.filter((e) => !groundSolidIds.has(e.face.solidId))
    : entries;

  // 3D faces theo painter order (nền → bóng → phần nổi)
  let gradientSeq = 0;
  let gradientOverflow = false;
  const emit3d = (entry: DrawEntry) => {
    const solid = solidMap.get(entry.face.solidId)!;
    // face.fill = fill kế thừa từ solid nguồn (CSG đa màu; csg.fill đã
    // override từ lúc resolve) — solid thường không có face.fill
    const base = entry.face.fill ?? solid.fill ?? "#c0c0c0";
    let fill: string;
    if (entry.fillOverride) {
      fill = entry.fillOverride;
    } else if (solid.shading === "none") {
      fill = base;
    } else if (lightParams.mode === "gradient") {
      const budgetLeft = CONSTRUCT_LIMITS.maxGradients - gradients.length;
      const result = faceGradientFill(
        entry.face,
        base,
        lightView,
        light.ambient,
        gradientSeq,
        budgetLeft,
      );
      if (result.gradient) {
        gradients.push(result.gradient);
        gradientSeq++;
      } else if (budgetLeft <= 0) {
        gradientOverflow = true;
      }
      fill = result.fill;
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
  };

  for (const entry of groundEntries) emit3d(entry);
  if (shadowLayer) {
    gradients.push(...shadowLayer.gradients);
    paths.push(...shadowLayer.paths);
  }
  for (const entry of floatingEntries) emit3d(entry);

  if (gradientOverflow) {
    warnings.push(
      `Gradient budget (${CONSTRUCT_LIMITS.maxGradients}) exhausted — remaining faces use flat smooth fill. Reduce face count or use light.mode "quantized".`,
    );
  }

  if (paths.length === 0) {
    err("Nothing to emit — all shapes were consumed or empty.", 'Add shapes/solids, or list ids in "emit" to force-output consumed shapes.');
  }

  // ---------- Emit + guard cuối ----------
  const svg = emitFragment(gradients, paths, spec.place, spec.precision, shadowLayer?.filters ?? []);

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

  // Exact mode tự giải xuyên khối — warning chỉ còn ý nghĩa với painter
  if (spec.depthSort === "painter") {
    warnings.push(...overlapWarnings(facetedItems));
  }

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
      csgOps: csgNodes.length,
      depthSplits,
      partsExpanded: expanded.partsExpanded,
    },
    warnings,
  };
}
