import type { Vec3 } from "@/lib/services/construct/types";

/**
 * plane3 — Layer 0 của Construct v2: NGUYÊN LÝ GỐC "một mặt phẳng chia
 * không gian làm hai; một đa giác phẳng lồi bị mặt phẳng cắt thành đúng
 * một mảnh trước + một mảnh sau".
 *
 * CSG (csg.ts) và depth-sort đúng (depthOrder.ts) đều chỉ là phép cắt này
 * với chiến lược đệ quy khác nhau. Thuật toán theo csg.js (Evan Wallace,
 * MIT) — viết tay lại thuần TS.
 */

// ---------- SharedTag + Polygon3 ----------

/** Nhãn nguồn gốc — mảnh cắt kế thừa để giữ fill/label/cutout targeting. */
export interface SharedTag {
  readonly solidId: string;
  readonly solidIndex: number;
  readonly faceIndex: number;
  readonly label?: string;
  readonly fill?: string;
}

/** Đa giác phẳng 3D lồi, CCW nhìn từ ngoài (normal hướng ra). */
export interface Polygon3 {
  readonly vertices: readonly Vec3[];
  readonly shared: SharedTag;
}

// ---------- Plane ----------

/** Mặt phẳng normal·x = w (normal đơn vị). */
export interface Plane {
  readonly normal: Vec3;
  readonly w: number;
}

/**
 * Plane từ đa giác theo Newell (ổn định với đa giác gần suy biến).
 * Trả null nếu suy biến (diện tích ~0).
 */
export function planeFromPolygon(vertices: readonly Vec3[]): Plane | null {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < vertices.length; i++) {
    const [x1, y1, z1] = vertices[i];
    const [x2, y2, z2] = vertices[(i + 1) % vertices.length];
    nx += (y1 - y2) * (z1 + z2);
    ny += (z1 - z2) * (x1 + x2);
    nz += (x1 - x2) * (y1 + y2);
  }
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-12) return null;
  const normal: Vec3 = [nx / len, ny / len, nz / len];
  const v = vertices[0];
  return { normal, w: normal[0] * v[0] + normal[1] * v[1] + normal[2] * v[2] };
}

export function flipPlane(plane: Plane): Plane {
  return { normal: [-plane.normal[0], -plane.normal[1], -plane.normal[2]], w: -plane.w };
}

export function flipPolygon(poly: Polygon3): Polygon3 {
  return { vertices: [...poly.vertices].reverse(), shared: poly.shared };
}

/** Khoảng cách có dấu điểm ↔ plane. */
export function signedDistance(plane: Plane, p: Vec3): number {
  return plane.normal[0] * p[0] + plane.normal[1] * p[1] + plane.normal[2] * p[2] - plane.w;
}

// ---------- Epsilon ----------

/**
 * Epsilon tương đối theo kích thước scene — 1e-5 tuyệt đối (csg.js) vỡ
 * khi toạ độ lớn cỡ nghìn (scene này dùng đơn vị canvas 1080-1920).
 */
export function relativeEps(sceneRadius: number): number {
  return 1e-5 * Math.max(1, sceneRadius);
}

// ---------- Phân loại + cắt ----------

export const COPLANAR = 0;
export const FRONT = 1;
export const BACK = 2;
export const SPANNING = 3; // FRONT | BACK

export function classifyPoint(plane: Plane, p: Vec3, eps: number): number {
  const d = signedDistance(plane, p);
  return d < -eps ? BACK : d > eps ? FRONT : COPLANAR;
}

export interface SplitBuckets {
  readonly coplanarFront: Polygon3[];
  readonly coplanarBack: Polygon3[];
  readonly front: Polygon3[];
  readonly back: Polygon3[];
}

function lerpVertex(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Diện tích ×2 (độ dài Newell chưa chuẩn hoá) — lọc mảnh suy biến. */
function newellMagnitude(vertices: readonly Vec3[]): number {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < vertices.length; i++) {
    const [x1, y1, z1] = vertices[i];
    const [x2, y2, z2] = vertices[(i + 1) % vertices.length];
    nx += (y1 - y2) * (z1 + z2);
    ny += (z1 - z2) * (x1 + x2);
    nz += (x1 - x2) * (y1 + y2);
  }
  return Math.hypot(nx, ny, nz);
}

/**
 * Cắt đa giác bằng plane, route vào 4 bucket (csg.js splitPolygon):
 * - COPLANAR toàn phần → coplanarFront/Back theo chiều normal
 * - FRONT/BACK toàn phần → front/back nguyên mảnh
 * - SPANNING → đúng 1 mảnh front + 1 mảnh back (đa giác lồi),
 *   đỉnh giao nội suy tại t = dᵢ/(dᵢ−dⱼ); mảnh <3 đỉnh hoặc suy biến bị bỏ.
 */
export function splitPolygonByPlane(
  plane: Plane,
  poly: Polygon3,
  eps: number,
  out: SplitBuckets,
): void {
  const n = poly.vertices.length;
  let polygonType = 0;
  const types = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const type = classifyPoint(plane, poly.vertices[i], eps);
    polygonType |= type;
    types[i] = type;
  }

  switch (polygonType) {
    case COPLANAR: {
      const polyPlane = planeFromPolygon(poly.vertices);
      const sameDir =
        polyPlane !== null &&
        plane.normal[0] * polyPlane.normal[0] +
          plane.normal[1] * polyPlane.normal[1] +
          plane.normal[2] * polyPlane.normal[2] >
          0;
      (sameDir ? out.coplanarFront : out.coplanarBack).push(poly);
      break;
    }
    case FRONT:
      out.front.push(poly);
      break;
    case BACK:
      out.back.push(poly);
      break;
    case SPANNING: {
      const f: Vec3[] = [];
      const b: Vec3[] = [];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ti = types[i];
        const tj = types[j];
        const vi = poly.vertices[i];
        const vj = poly.vertices[j];
        if (ti !== BACK) f.push(vi);
        if (ti !== FRONT) b.push(vi);
        if ((ti | tj) === SPANNING) {
          const di = signedDistance(plane, vi);
          const dj = signedDistance(plane, vj);
          const t = di / (di - dj);
          const v = lerpVertex(vi, vj, t);
          f.push(v);
          b.push(v);
        }
      }
      const minArea = eps * eps;
      if (f.length >= 3 && newellMagnitude(f) > minArea) {
        out.front.push({ vertices: f, shared: poly.shared });
      }
      if (b.length >= 3 && newellMagnitude(b) > minArea) {
        out.back.push({ vertices: b, shared: poly.shared });
      }
      break;
    }
  }
}

// ---------- Weld ----------

/**
 * Hàn đỉnh gần trùng về MỘT instance chuẩn (first-seen wins — deterministic
 * theo thứ tự input). Bước robustness đòn bẩy cao nhất trước CSG: cạnh chung
 * trở thành bit-identical, diệt T-junction hairline.
 */
export function weldVertices(polygons: readonly Polygon3[], eps: number): Polygon3[] {
  const grid = new Map<string, Vec3[]>();
  const cell = Math.max(eps, 1e-12);
  const keyOf = (x: number, y: number, z: number) =>
    `${Math.round(x / cell)},${Math.round(y / cell)},${Math.round(z / cell)}`;

  function canonical(v: Vec3): Vec3 {
    const cx = Math.round(v[0] / cell);
    const cy = Math.round(v[1] / cell);
    const cz = Math.round(v[2] / cell);
    // Soi cell của điểm + 26 cell lân cận — first match theo thứ tự chèn
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = grid.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (!bucket) continue;
          for (const c of bucket) {
            if (
              Math.abs(c[0] - v[0]) <= eps &&
              Math.abs(c[1] - v[1]) <= eps &&
              Math.abs(c[2] - v[2]) <= eps
            ) {
              return c;
            }
          }
        }
      }
    }
    const key = keyOf(v[0], v[1], v[2]);
    const bucket = grid.get(key);
    if (bucket) bucket.push(v);
    else grid.set(key, [v]);
    return v;
  }

  const out: Polygon3[] = [];
  for (const poly of polygons) {
    const vertices = poly.vertices.map(canonical);
    // Bỏ đỉnh liên tiếp trùng nhau sau weld
    const dedup: Vec3[] = [];
    for (const v of vertices) {
      if (dedup.length === 0 || dedup[dedup.length - 1] !== v) dedup.push(v);
    }
    while (dedup.length > 1 && dedup[0] === dedup[dedup.length - 1]) dedup.pop();
    if (dedup.length >= 3) out.push({ vertices: dedup, shared: poly.shared });
  }
  return out;
}
