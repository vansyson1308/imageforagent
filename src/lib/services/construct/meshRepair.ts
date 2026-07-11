import type { Mesh, MeshFace, Vec3 } from "@/lib/services/construct/types";
import { planeFromPolygon, type Polygon3, type SharedTag } from "@/lib/services/construct/plane3";

/**
 * meshRepair — Layer 3 (nghịch đảo của Layer 0): gộp các mảnh ĐỒNG PHẲNG
 * cùng nguồn (fill + label) mà BSP đã cắt vụn trở lại thành mặt lớn.
 * Diệt vân rạn hairline giữa các mảnh kề nhau + giảm mạnh path count.
 *
 * Yêu cầu input: đỉnh đã weld (so sánh theo REFERENCE) + T-vertex đã chèn
 * (cạnh chung bit-identical) — đúng output của csgOperation.
 */

export interface RepairedFace {
  readonly outer: readonly Vec3[];
  readonly holes: readonly (readonly Vec3[])[];
  readonly shared: SharedTag;
}

interface Group {
  readonly key: string;
  readonly faces: { poly: Polygon3; index: number }[];
}

/** Khoá nhóm: plane lượng tử + fill + label (không gộp chéo nguồn). */
function groupKey(poly: Polygon3, eps: number): string | null {
  const plane = planeFromPolygon(poly.vertices);
  if (!plane) return null;
  const q = (v: number) => Math.round(v * 1000) / 1000;
  const qw = Math.round(plane.w / Math.max(eps * 10, 1e-9));
  return `${q(plane.normal[0])},${q(plane.normal[1])},${q(plane.normal[2])}|${qw}|${poly.shared.fill ?? ""}|${poly.shared.label ?? ""}`;
}

/** Bỏ đỉnh thẳng hàng dọc chu vi (di sản T-vertex sau khi gộp). */
function dropCollinear(ring: readonly Vec3[]): Vec3[] {
  if (ring.length <= 3) return [...ring];
  const out: Vec3[] = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[(i - 1 + n) % n];
    const b = ring[i];
    const c = ring[(i + 1) % n];
    const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const bc: Vec3 = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
    const cross: Vec3 = [
      ab[1] * bc[2] - ab[2] * bc[1],
      ab[2] * bc[0] - ab[0] * bc[2],
      ab[0] * bc[1] - ab[1] * bc[0],
    ];
    const lenAb = Math.hypot(...ab);
    const lenBc = Math.hypot(...bc);
    const sin = Math.hypot(...cross) / (lenAb * lenBc || 1);
    if (sin > 1e-6) out.push(b);
  }
  return out.length >= 3 ? out : [...ring];
}

/** Diện tích ×2 của ring 3D (độ dài Newell). */
function ringArea(ring: readonly Vec3[]): number {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1, z1] = ring[i];
    const [x2, y2, z2] = ring[(i + 1) % ring.length];
    nx += (y1 - y2) * (z1 + z2);
    ny += (z1 - z2) * (x1 + x2);
    nz += (x1 - x2) * (y1 + y2);
  }
  return Math.hypot(nx, ny, nz);
}

/**
 * Gộp một nhóm mảnh đồng phẳng thành RepairedFace[] (mỗi region liên thông
 * → 1 mặt outer + holes). Fail bất kỳ bước nào → trả mảnh gốc (an toàn).
 */
function mergeGroup(group: Group): RepairedFace[] {
  if (group.faces.length === 1) {
    const { poly } = group.faces[0];
    return [{ outer: poly.vertices, holes: [], shared: poly.shared }];
  }

  // Id đỉnh theo reference
  const vertId = new Map<Vec3, number>();
  const idOf = (v: Vec3): number => {
    let id = vertId.get(v);
    if (id === undefined) {
      id = vertId.size;
      vertId.set(v, id);
    }
    return id;
  };

  // Adjacency qua cạnh vô hướng
  const edgeFaces = new Map<string, number[]>();
  group.faces.forEach(({ poly }, fi) => {
    const n = poly.vertices.length;
    for (let i = 0; i < n; i++) {
      const a = idOf(poly.vertices[i]);
      const b = idOf(poly.vertices[(i + 1) % n]);
      if (a === b) continue;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const list = edgeFaces.get(key);
      if (list) list.push(fi);
      else edgeFaces.set(key, [fi]);
    }
  });

  // Region grow từ index nhỏ nhất (deterministic)
  const regionOf = new Array<number>(group.faces.length).fill(-1);
  let regionCount = 0;
  for (let seed = 0; seed < group.faces.length; seed++) {
    if (regionOf[seed] !== -1) continue;
    const region = regionCount++;
    const queue = [seed];
    regionOf[seed] = region;
    while (queue.length > 0) {
      const fi = queue.pop()!;
      const poly = group.faces[fi].poly;
      const n = poly.vertices.length;
      for (let i = 0; i < n; i++) {
        const a = idOf(poly.vertices[i]);
        const b = idOf(poly.vertices[(i + 1) % n]);
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        for (const other of edgeFaces.get(key) ?? []) {
          if (regionOf[other] === -1) {
            regionOf[other] = region;
            queue.push(other);
          }
        }
      }
    }
  }

  const out: RepairedFace[] = [];
  for (let region = 0; region < regionCount; region++) {
    const faceIdx = group.faces
      .map((_, i) => i)
      .filter((i) => regionOf[i] === region);
    if (faceIdx.length === 1) {
      const { poly } = group.faces[faceIdx[0]];
      out.push({ outer: poly.vertices, holes: [], shared: poly.shared });
      continue;
    }
    const shared = group.faces[faceIdx[0]].poly.shared;

    // Cạnh CÓ HƯỚNG chỉ dùng 1 lần trong region = boundary
    const directed = new Map<string, { from: Vec3; to: Vec3 }>();
    const undirectedCount = new Map<string, number>();
    for (const fi of faceIdx) {
      const poly = group.faces[fi].poly;
      const n = poly.vertices.length;
      for (let i = 0; i < n; i++) {
        const va = poly.vertices[i];
        const vb = poly.vertices[(i + 1) % n];
        const a = idOf(va);
        const b = idOf(vb);
        if (a === b) continue;
        const uKey = a < b ? `${a}:${b}` : `${b}:${a}`;
        undirectedCount.set(uKey, (undirectedCount.get(uKey) ?? 0) + 1);
        directed.set(`${a}>${b}`, { from: va, to: vb });
      }
    }
    // Boundary = cạnh vô hướng dùng đúng 1 lần
    const outgoing = new Map<number, Array<{ to: Vec3; toId: number }>>();
    for (const [dKey, edge] of directed) {
      const [aStr, bStr] = dKey.split(">");
      const a = Number(aStr);
      const b = Number(bStr);
      const uKey = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (undirectedCount.get(uKey) !== 1) continue;
      const list = outgoing.get(a);
      const entry = { to: edge.to, toId: b };
      if (list) list.push(entry);
      else outgoing.set(a, [entry]);
    }

    // Non-manifold (đỉnh có >1 cạnh boundary ra) → bail region này
    let manifold = true;
    for (const list of outgoing.values()) {
      if (list.length !== 1) {
        manifold = false;
        break;
      }
    }
    if (!manifold) {
      for (const fi of faceIdx) {
        const { poly } = group.faces[fi];
        out.push({ outer: poly.vertices, holes: [], shared: poly.shared });
      }
      continue;
    }

    // Chain cycles (bắt đầu từ id đỉnh nhỏ nhất — deterministic)
    const idToVert = new Map<number, Vec3>();
    for (const [v, id] of vertId) idToVert.set(id, v);
    const visited = new Set<number>();
    const cycles: Vec3[][] = [];
    const startIds = [...outgoing.keys()].sort((a, b) => a - b);
    let broken = false;
    for (const start of startIds) {
      if (visited.has(start)) continue;
      const ring: Vec3[] = [];
      let cur = start;
      let guard = outgoing.size + 2;
      while (guard-- > 0) {
        visited.add(cur);
        ring.push(idToVert.get(cur)!);
        const next = outgoing.get(cur);
        if (!next) {
          broken = true;
          break;
        }
        cur = next[0].toId;
        if (cur === start) break;
      }
      if (broken || guard <= 0) {
        broken = true;
        break;
      }
      if (ring.length >= 3) cycles.push(dropCollinear(ring));
    }
    if (broken || cycles.length === 0) {
      for (const fi of faceIdx) {
        const { poly } = group.faces[fi];
        out.push({ outer: poly.vertices, holes: [], shared: poly.shared });
      }
      continue;
    }

    // Outer = cycle diện tích lớn nhất; còn lại = holes
    let outerIdx = 0;
    let maxArea = -1;
    cycles.forEach((ring, i) => {
      const area = ringArea(ring);
      if (area > maxArea) {
        maxArea = area;
        outerIdx = i;
      }
    });
    out.push({
      outer: cycles[outerIdx],
      holes: cycles.filter((_, i) => i !== outerIdx),
      shared,
    });
  }
  return out;
}

/**
 * Gộp toàn bộ polygon soup — trả RepairedFace[] deterministic
 * (nhóm theo thứ tự xuất hiện, region theo index).
 */
export function repairPolygons(polygons: readonly Polygon3[], eps: number): RepairedFace[] {
  const groups = new Map<string, Group>();
  const order: string[] = [];
  polygons.forEach((poly, index) => {
    const key = groupKey(poly, eps);
    if (key === null) return; // suy biến — bỏ
    let group = groups.get(key);
    if (!group) {
      group = { key, faces: [] };
      groups.set(key, group);
      order.push(key);
    }
    group.faces.push({ poly, index });
  });

  const out: RepairedFace[] = [];
  for (const key of order) {
    out.push(...mergeGroup(groups.get(key)!));
  }
  return out;
}

/** RepairedFace[] → Mesh (giữ holes + fill/label). */
export function repairedToMesh(faces: readonly RepairedFace[]): Mesh {
  const vertices: Vec3[] = [];
  const indexOf = new Map<string, number>();
  const key = (v: Vec3) => `${v[0]},${v[1]},${v[2]}`;
  const ringIdx = (ring: readonly Vec3[]) =>
    ring.map((v) => {
      const k = key(v);
      let idx = indexOf.get(k);
      if (idx === undefined) {
        idx = vertices.length;
        vertices.push(v);
        indexOf.set(k, idx);
      }
      return idx;
    });

  const meshFaces: MeshFace[] = faces.map((face) => ({
    vertices: ringIdx(face.outer),
    holes: face.holes.length > 0 ? face.holes.map(ringIdx) : undefined,
    label: face.shared.label,
    fill: face.shared.fill,
  }));
  return { vertices, faces: meshFaces };
}
