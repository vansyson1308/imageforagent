import type { Mat4 } from "@/lib/services/construct/types";
import type { ConstructSpec, Solid } from "@/lib/validation/constructSchema";
import { AppError } from "@/lib/services/apiError";
import { CONSTRUCT_LIMITS } from "@/lib/config/limits";
import { flattenToContours } from "@/lib/services/construct/geometry2d";
import { parsePathData } from "@/lib/services/construct/pathParse";
import { normalizeSelfUnion } from "@/lib/services/construct/pathBoolean";
import { relativeEps, weldVertices, type Polygon3 } from "@/lib/services/construct/plane3";
import { csgOperation, meshToPolygons, prepareOperand } from "@/lib/services/construct/csg";
import { repairPolygons, repairedToMesh } from "@/lib/services/construct/meshRepair";
import { unknownRefError, type ShapeResolver } from "@/lib/services/construct/resolve2d";
import {
  boxMesh,
  coneMesh,
  cylinderMesh,
  extrudeMesh,
  meshRadius,
  sphereMesh,
  transformMesh,
} from "@/lib/services/construct/geometry3d";
import { composePlacement4, transformPoint } from "@/lib/services/construct/math3d";
import type { SolidSceneItem } from "@/lib/services/construct/painterSort";
import type { Mesh } from "@/lib/services/construct/types";
import { parseHex } from "@/lib/services/construct/shading";

/**
 * sceneMeshes — solids → mesh world (primitive tessellate + CSG DAG) — tách
 * khỏi compile.ts để MỘT nguồn mesh phục vụ cả renderer SVG lẫn exporter 3D
 * (glTF): mesh Blender nhận là đúng mesh engine vẽ. Pure.
 */

function err(message: string, hint: string): never {
  throw new AppError("CONSTRUCTION_INVALID", message, hint);
}

export interface SmoothSolidInfo {
  readonly solid: Solid;
  readonly solidIndex: number;
  readonly kind: "sphere" | "cylinder" | "cone";
}

/** Mesh LOCAL + ma trận đặt — cho exporter (node TRS animate được). */
export interface ExportMesh {
  readonly solidId: string;
  readonly solidIndex: number;
  readonly fill: string | undefined;
  readonly local: Mesh;
  readonly matrix: Mat4;
  readonly smoothKind: SmoothSolidInfo["kind"] | null;
}

export interface SolidMeshes {
  readonly facetedItems: SolidSceneItem[];
  readonly smoothInfos: Map<string, SmoothSolidInfo>;
  readonly worldMeshById: Map<string, { mesh: Mesh; solidIndex: number }>;
  readonly csgNodeCount: number;
  /** Chỉ có khi collectExport = true. */
  readonly exportMeshes?: ExportMesh[];
}

const FLATTEN_STEPS = 8;

export function buildSolidMeshes(
  opts: {
    readonly spec: ConstructSpec;
    readonly resolver: ShapeResolver;
    readonly solidMap: Map<string, Solid>;
    readonly allIds: readonly string[];
    readonly worldMatrixById: Map<string, Mat4>;
    readonly warnings: string[];
    readonly checkClock: (stage: string) => void;
  },
  collectExport = false,
): SolidMeshes {
  const { spec, resolver, solidMap, allIds, worldMatrixById, warnings, checkClock } = opts;
  const exportMeshes: ExportMesh[] | undefined = collectExport ? [] : undefined;
  // ---------- Solids → meshes (csg node resolve sau) ----------
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

    const matrix = worldMatrixById.get(solid.id) ?? composePlacement4(solid.at, solid.rotate, solid.scale);
    const world = transformMesh(matrix, mesh);
    worldMeshById.set(solid.id, { mesh: world, solidIndex });
    if (csgConsumed.has(solid.id)) return; // chỉ làm nguyên liệu CSG
    exportMeshes?.push({ solidId: solid.id, solidIndex, fill: solid.fill, local: mesh, matrix, smoothKind });

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
      exportMeshes?.push({
        solidId: node.id,
        solidIndex: solidIndexById.get(node.id)!,
        fill: node.fill,
        local: repairedToMesh(repaired),
        matrix: placement,
        smoothKind: null,
      });
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

  return { facetedItems, smoothInfos, worldMeshById, csgNodeCount: csgNodes.length, exportMeshes };
}
