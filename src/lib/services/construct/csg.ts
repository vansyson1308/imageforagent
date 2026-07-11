import type { Mesh, MeshFace, Vec3 } from "@/lib/services/construct/types";
import { AppError } from "@/lib/services/apiError";
import {
  flipPlane,
  flipPolygon,
  planeFromPolygon,
  splitPolygonByPlane,
  weldVertices,
  type Plane,
  type Polygon3,
  type SharedTag,
} from "@/lib/services/construct/plane3";
import { isConvexFace, triangulateFace } from "@/lib/services/construct/triangulate";
import { faceNormal } from "@/lib/services/construct/math3d";

/**
 * csg — Layer 1: boolean THỂ TÍCH trên mesh, thuật toán BSP của csg.js
 * (Evan Wallace, MIT) viết tay thuần TS trên kernel plane3.
 * union = a ngoài b + b ngoài a (dedup coplanar bằng invert-clip-invert);
 * subtract = ~(~A ∪ B); intersect = ~(~A ∪ ~B).
 */

function err(message: string, hint: string): never {
  throw new AppError("CONSTRUCTION_INVALID", message, hint);
}

// ---------- Mesh ⇄ Polygon3 ----------

/**
 * Mesh → Polygon3[]: mặt lồi giữ nguyên; mặt lõm/có lỗ tam giác hoá
 * (kernel chỉ cắt đúng đa giác lồi). Trả kèm cờ degraded để caller warning.
 */
export function meshToPolygons(
  mesh: Mesh,
  tag: Omit<SharedTag, "faceIndex" | "label">,
): { polygons: Polygon3[]; degraded: boolean } {
  const polygons: Polygon3[] = [];
  let degraded = false;
  mesh.faces.forEach((face, faceIndex) => {
    const outer = face.vertices.map((i) => mesh.vertices[i]);
    const shared: SharedTag = { ...tag, faceIndex, label: face.label };
    const normal = faceNormal(outer);
    if (!face.holes?.length && isConvexFace(outer, normal)) {
      polygons.push({ vertices: outer, shared });
      return;
    }
    const holes = (face.holes ?? []).map((ring) => ring.map((i) => mesh.vertices[i]));
    const result = triangulateFace(outer, holes, normal);
    if (result.degraded) degraded = true;
    for (const tri of result.triangles) {
      polygons.push({ vertices: tri, shared });
    }
  });
  return { polygons, degraded };
}

/** Polygon3[] → Mesh + fill/label per face (dedup đỉnh theo giá trị). */
export function polygonsToMesh(polygons: readonly Polygon3[]): Mesh {
  const vertices: Vec3[] = [];
  const indexOf = new Map<string, number>();
  const key = (v: Vec3) => `${v[0]},${v[1]},${v[2]}`;

  const faces: MeshFace[] = polygons.map((poly) => ({
    vertices: poly.vertices.map((v) => {
      const k = key(v);
      let idx = indexOf.get(k);
      if (idx === undefined) {
        idx = vertices.length;
        vertices.push(v);
        indexOf.set(k, idx);
      }
      return idx;
    }),
    label: poly.shared.label,
    fill: poly.shared.fill,
  }));
  return { vertices, faces };
}

// ---------- BSP Node ----------

interface Node {
  plane: Plane | null;
  front: Node | null;
  back: Node | null;
  polygons: Polygon3[];
}

function newNode(): Node {
  return { plane: null, front: null, back: null, polygons: [] };
}

function build(node: Node, polygons: readonly Polygon3[], eps: number): void {
  if (polygons.length === 0) return;
  const rest = polygons;
  if (!node.plane) {
    // Splitter = plane của đa giác đầu (deterministic theo thứ tự input)
    for (let i = 0; i < rest.length; i++) {
      const plane = planeFromPolygon(rest[i].vertices);
      if (plane) {
        node.plane = plane;
        break;
      }
    }
    if (!node.plane) return; // toàn đa giác suy biến
  }
  const front: Polygon3[] = [];
  const back: Polygon3[] = [];
  for (const poly of rest) {
    // coplanar giữ tại node (cả 2 chiều)
    splitPolygonByPlane(node.plane, poly, eps, {
      coplanarFront: node.polygons,
      coplanarBack: node.polygons,
      front,
      back,
    });
  }
  if (front.length > 0) {
    if (!node.front) node.front = newNode();
    build(node.front, front, eps);
  }
  if (back.length > 0) {
    if (!node.back) node.back = newNode();
    build(node.back, back, eps);
  }
}

function invert(node: Node): void {
  node.polygons = node.polygons.map(flipPolygon);
  if (node.plane) node.plane = flipPlane(node.plane);
  if (node.front) invert(node.front);
  if (node.back) invert(node.back);
  const tmp = node.front;
  node.front = node.back;
  node.back = tmp;
}

/** Loại phần của `polygons` nằm TRONG khối của node-tree này. */
function clipPolygons(node: Node, polygons: readonly Polygon3[], eps: number): Polygon3[] {
  if (!node.plane) return [...polygons];
  let front: Polygon3[] = [];
  let back: Polygon3[] = [];
  for (const poly of polygons) {
    splitPolygonByPlane(node.plane, poly, eps, {
      coplanarFront: front,
      coplanarBack: back,
      front,
      back,
    });
  }
  if (node.front) front = clipPolygons(node.front, front, eps);
  back = node.back ? clipPolygons(node.back, back, eps) : []; // không con back = TRONG khối → bỏ
  return front.concat(back);
}

function clipTo(node: Node, other: Node, eps: number): void {
  node.polygons = clipPolygons(other, node.polygons, eps);
  if (node.front) clipTo(node.front, other, eps);
  if (node.back) clipTo(node.back, other, eps);
}

function allPolygons(node: Node): Polygon3[] {
  const out = [...node.polygons];
  if (node.front) out.push(...allPolygons(node.front));
  if (node.back) out.push(...allPolygons(node.back));
  return out;
}

// ---------- Boolean ops ----------

export type CsgOp = "union" | "difference" | "intersection";

function unionPair(a: readonly Polygon3[], b: readonly Polygon3[], eps: number): Polygon3[] {
  const na = newNode();
  const nb = newNode();
  build(na, a, eps);
  build(nb, b, eps);
  clipTo(na, nb, eps);
  clipTo(nb, na, eps);
  invert(nb);
  clipTo(nb, na, eps);
  invert(nb);
  build(na, allPolygons(nb), eps);
  return allPolygons(na);
}

function subtractPair(a: readonly Polygon3[], b: readonly Polygon3[], eps: number): Polygon3[] {
  const na = newNode();
  const nb = newNode();
  build(na, a, eps);
  build(nb, b, eps);
  invert(na);
  clipTo(na, nb, eps);
  clipTo(nb, na, eps);
  invert(nb);
  clipTo(nb, na, eps);
  invert(nb);
  build(na, allPolygons(nb), eps);
  invert(na);
  return allPolygons(na);
}

function intersectPair(a: readonly Polygon3[], b: readonly Polygon3[], eps: number): Polygon3[] {
  const na = newNode();
  const nb = newNode();
  build(na, a, eps);
  build(nb, b, eps);
  invert(na);
  clipTo(nb, na, eps);
  invert(nb);
  clipTo(na, nb, eps);
  clipTo(nb, na, eps);
  build(na, allPolygons(nb), eps);
  invert(na);
  return allPolygons(na);
}

interface Aabb {
  readonly min: Vec3;
  readonly max: Vec3;
}

function aabbOf(polygons: readonly Polygon3[]): Aabb {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const poly of polygons) {
    for (const [x, y, z] of poly.vertices) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

function aabbDisjoint(a: Aabb, b: Aabb, eps: number): boolean {
  return (
    a.max[0] < b.min[0] - eps || b.max[0] < a.min[0] - eps ||
    a.max[1] < b.min[1] - eps || b.max[1] < a.min[1] - eps ||
    a.max[2] < b.min[2] - eps || b.max[2] < a.min[2] - eps
  );
}

// ---------- T-junction repair ----------

/**
 * Chèn T-vertex: đỉnh của mảnh này nằm GIỮA cạnh của mảnh kia (hệ quả tất
 * yếu của BSP CSG — csg.js issue #13) → chèn vào cạnh đó để mọi cạnh chung
 * khớp nhau tuyệt đối. Không sửa = watertight vỡ + khe hairline khi render.
 * Input phải đã weld (đỉnh canonical). Deterministic: chèn theo t tăng dần.
 */
export function insertTVertices(polygons: readonly Polygon3[], eps: number): Polygon3[] {
  // Grid đỉnh canonical
  const verts: Vec3[] = [];
  const seen = new Set<Vec3>();
  for (const poly of polygons) {
    for (const v of poly.vertices) {
      if (!seen.has(v)) {
        seen.add(v);
        verts.push(v);
      }
    }
  }
  // Cell thích ứng theo kích thước hình — cell quá nhỏ khiến cạnh dài phải
  // quét hàng nghìn cell (bẫy hiệu năng), quá to thì bucket phình
  let minC = Infinity;
  let maxC = -Infinity;
  for (const v of verts) {
    for (const c of v) {
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;
    }
  }
  const cell = Math.max((maxC - minC) / 64, eps * 10, 1e-6);
  const grid = new Map<string, Vec3[]>();
  for (const v of verts) {
    const key = `${Math.floor(v[0] / cell)},${Math.floor(v[1] / cell)},${Math.floor(v[2] / cell)}`;
    const bucket = grid.get(key);
    if (bucket) bucket.push(v);
    else grid.set(key, [v]);
  }

  function candidatesNear(a: Vec3, b: Vec3): Vec3[] {
    const out: Vec3[] = [];
    const min = [Math.min(a[0], b[0]) - eps, Math.min(a[1], b[1]) - eps, Math.min(a[2], b[2]) - eps];
    const max = [Math.max(a[0], b[0]) + eps, Math.max(a[1], b[1]) + eps, Math.max(a[2], b[2]) + eps];
    for (let cx = Math.floor(min[0] / cell); cx <= Math.floor(max[0] / cell); cx++) {
      for (let cy = Math.floor(min[1] / cell); cy <= Math.floor(max[1] / cell); cy++) {
        for (let cz = Math.floor(min[2] / cell); cz <= Math.floor(max[2] / cell); cz++) {
          const bucket = grid.get(`${cx},${cy},${cz}`);
          if (bucket) out.push(...bucket);
        }
      }
    }
    return out;
  }

  return polygons.map((poly) => {
    const outVerts: Vec3[] = [];
    const n = poly.vertices.length;
    for (let i = 0; i < n; i++) {
      const a = poly.vertices[i];
      const b = poly.vertices[(i + 1) % n];
      outVerts.push(a);
      const abx = b[0] - a[0];
      const aby = b[1] - a[1];
      const abz = b[2] - a[2];
      const len2 = abx * abx + aby * aby + abz * abz;
      if (len2 < eps * eps) continue;
      // Đỉnh nằm giữa đoạn ab (khoảng cách ≤ eps, 0 < t < 1)
      const inserts: Array<{ t: number; v: Vec3 }> = [];
      for (const v of candidatesNear(a, b)) {
        if (v === a || v === b) continue;
        const t = ((v[0] - a[0]) * abx + (v[1] - a[1]) * aby + (v[2] - a[2]) * abz) / len2;
        if (t <= eps || t >= 1 - eps) continue;
        const px = a[0] + t * abx - v[0];
        const py = a[1] + t * aby - v[1];
        const pz = a[2] + t * abz - v[2];
        if (px * px + py * py + pz * pz <= eps * eps) {
          inserts.push({ t, v });
        }
      }
      inserts.sort((x, y) => x.t - y.t);
      for (const ins of inserts) outVerts.push(ins.v);
    }
    return outVerts.length === n ? poly : { vertices: outVerts, shared: poly.shared };
  });
}

export interface CsgResult {
  readonly polygons: Polygon3[];
  readonly warnings: readonly string[];
}

/**
 * Chạy phép CSG trên 2 tập polygon world-space (đã weld ở caller).
 * Fast-path AABB rời nhau: union = ghép, difference = A + warning,
 * intersection = lỗi rỗng.
 */
export function csgOperation(
  op: CsgOp,
  a: readonly Polygon3[],
  b: readonly Polygon3[],
  eps: number,
  context: string,
): CsgResult {
  const warnings: string[] = [];

  if (aabbDisjoint(aabbOf(a), aabbOf(b), eps)) {
    switch (op) {
      case "union":
        return { polygons: [...a, ...b], warnings };
      case "difference":
        warnings.push(`CSG "${context}": operands do not touch — difference had no effect.`);
        return { polygons: [...a], warnings };
      case "intersection":
        err(
          `CSG "${context}" (intersection) produced no volume — operands do not overlap.`,
          'Check "at" offsets — solids are centered at their own origin.',
        );
    }
  }

  const raw =
    op === "union"
      ? unionPair(a, b, eps)
      : op === "difference"
        ? subtractPair(a, b, eps)
        : intersectPair(a, b, eps);
  // Weld mảnh mới (đỉnh giao sinh trong lúc cắt) + vá T-junction
  const result = insertTVertices(weldVertices(raw, eps), eps);

  if (result.length === 0) {
    if (op === "intersection") {
      err(
        `CSG "${context}" (intersection) produced no volume — operands do not overlap.`,
        'Check "at" offsets — solids are centered at their own origin.',
      );
    }
    err(
      `CSG "${context}" (${op}) produced an empty solid.`,
      "One operand may fully contain the other with opposite orientation — check sizes and positions.",
    );
  }
  return { polygons: result, warnings };
}

/** Weld + chuyển mesh sang polygons cho một operand CSG. */
export function prepareOperand(
  mesh: Mesh,
  tag: Omit<SharedTag, "faceIndex" | "label">,
  eps: number,
): { polygons: Polygon3[]; degraded: boolean } {
  const { polygons, degraded } = meshToPolygons(mesh, tag);
  return { polygons: weldVertices(polygons, eps), degraded };
}
