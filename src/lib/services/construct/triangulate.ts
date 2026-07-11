import type { Vec2, Vec3 } from "@/lib/services/construct/types";

/**
 * triangulate — ear clipping có lỗ (bridge-cut, Eberly) cho mặt đa giác
 * KHÔNG lồi trước khi vào CSG (kernel plane3 chỉ cắt đúng với đa giác lồi;
 * tam giác thì luôn lồi). Mặt lồi sẵn không cần qua đây.
 *
 * Deterministic: mọi lựa chọn (bridge, ear) đều theo index/khoảng cách với
 * tie-break cố định; có guard vòng lặp → fallback fan + cờ degraded.
 */

/** Chiếu đa giác phẳng 3D → 2D theo trục trội của normal, GIỮ orientation. */
function projectTo2D(vertices: readonly Vec3[], normal: Vec3): Vec2[] {
  const ax = Math.abs(normal[0]);
  const ay = Math.abs(normal[1]);
  const az = Math.abs(normal[2]);
  if (az >= ax && az >= ay) {
    // Bỏ z; normal z âm thì lật x để giữ CCW
    return vertices.map(([x, y]) => (normal[2] >= 0 ? [x, y] : [-x, y]));
  }
  if (ay >= ax) {
    return vertices.map(([x, , z]) => (normal[1] >= 0 ? [z, x] : [-z, x]));
  }
  return vertices.map(([, y, z]) => (normal[0] >= 0 ? [y, z] : [-y, z]));
}

function signedArea2D(ring: readonly Vec2[]): number {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}

function cross2(o: Vec2, a: Vec2, b: Vec2): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

function pointInTriangle(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  const d1 = cross2(a, b, p);
  const d2 = cross2(b, c, p);
  const d3 = cross2(c, a, p);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/** Đoạn ab có cắt cd không (loại trừ chạm đầu mút). */
function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const d1 = cross2(c, d, a);
  const d2 = cross2(c, d, b);
  const d3 = cross2(a, b, c);
  const d4 = cross2(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

interface Ring2D {
  readonly pts2: Vec2[];
  readonly pts3: Vec3[];
}

/**
 * Bridge-cut một hole vào ring ngoài: nối đỉnh phải-nhất của hole với đỉnh
 * outer nhìn thấy được (đoạn nối không cắt cạnh nào) — chọn theo khoảng
 * cách nhỏ nhất, tie-break index. Trả ring gộp (đi outer → bridge → hole
 * → bridge về).
 */
function bridgeHole(outer: Ring2D, hole: Ring2D): Ring2D {
  // Đỉnh phải-nhất của hole (tie-break index nhỏ)
  let hIdx = 0;
  for (let i = 1; i < hole.pts2.length; i++) {
    if (hole.pts2[i][0] > hole.pts2[hIdx][0]) hIdx = i;
  }
  const hp = hole.pts2[hIdx];

  // Ứng viên outer: sắp theo khoảng cách tới hp
  const candidates = outer.pts2
    .map((p, i) => ({ i, d: (p[0] - hp[0]) ** 2 + (p[1] - hp[1]) ** 2 }))
    .sort((a, b) => a.d - b.d || a.i - b.i);

  const allEdges: Array<readonly [Vec2, Vec2]> = [];
  for (let i = 0; i < outer.pts2.length; i++) {
    allEdges.push([outer.pts2[i], outer.pts2[(i + 1) % outer.pts2.length]]);
  }
  for (let i = 0; i < hole.pts2.length; i++) {
    allEdges.push([hole.pts2[i], hole.pts2[(i + 1) % hole.pts2.length]]);
  }

  let oIdx = candidates[0].i;
  for (const cand of candidates) {
    const op = outer.pts2[cand.i];
    let blocked = false;
    for (const [e1, e2] of allEdges) {
      if (segmentsIntersect(hp, op, e1, e2)) {
        blocked = true;
        break;
      }
    }
    if (!blocked) {
      oIdx = cand.i;
      break;
    }
  }

  // Ghép: outer[0..oIdx] + hole[hIdx..] vòng + hole[..hIdx] + outer[oIdx..]
  const pts2: Vec2[] = [];
  const pts3: Vec3[] = [];
  const push = (r: Ring2D, i: number) => {
    pts2.push(r.pts2[i]);
    pts3.push(r.pts3[i]);
  };
  for (let i = 0; i <= oIdx; i++) push(outer, i);
  for (let k = 0; k <= hole.pts2.length; k++) push(hole, (hIdx + k) % hole.pts2.length);
  push(outer, oIdx);
  for (let i = oIdx + 1; i < outer.pts2.length; i++) push(outer, i);
  return { pts2, pts3 };
}

export interface TriangulateResult {
  /** Mỗi phần tử là một tam giác 3 đỉnh 3D. */
  readonly triangles: readonly (readonly [Vec3, Vec3, Vec3])[];
  /** true nếu phải fallback fan (input suy biến) — caller nên warning. */
  readonly degraded: boolean;
}

/**
 * Tam giác hoá mặt phẳng 3D (outer CCW nhìn từ ngoài + holes) bằng ear
 * clipping. Normal dùng để chiếu 2D giữ orientation.
 */
export function triangulateFace(
  outer: readonly Vec3[],
  holes: readonly (readonly Vec3[])[],
  normal: Vec3,
): TriangulateResult {
  let ring: Ring2D = { pts2: projectTo2D(outer, normal), pts3: [...outer] };
  // Bảo đảm outer CCW trong hệ chiếu (area > 0)
  if (signedArea2D(ring.pts2) < 0) {
    ring = { pts2: [...ring.pts2].reverse(), pts3: [...ring.pts3].reverse() };
  }

  // Bridge từng hole (phải-nhất trước — chuẩn Eberly), hole ép CW
  const orderedHoles = holes
    .map((h) => {
      let r: Ring2D = { pts2: projectTo2D(h, normal), pts3: [...h] };
      if (signedArea2D(r.pts2) > 0) {
        r = { pts2: [...r.pts2].reverse(), pts3: [...r.pts3].reverse() };
      }
      return r;
    })
    .sort((a, b) => {
      const ax = Math.max(...a.pts2.map((p) => p[0]));
      const bx = Math.max(...b.pts2.map((p) => p[0]));
      return bx - ax;
    });
  for (const hole of orderedHoles) {
    ring = bridgeHole(ring, hole);
  }

  // Ear clipping
  const n0 = ring.pts2.length;
  const idx = Array.from({ length: n0 }, (_, i) => i);
  const triangles: Array<readonly [Vec3, Vec3, Vec3]> = [];
  let guard = n0 * n0 + 10;
  let degraded = false;

  while (idx.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const iPrev = idx[(k - 1 + idx.length) % idx.length];
      const iCur = idx[k];
      const iNext = idx[(k + 1) % idx.length];
      const a = ring.pts2[iPrev];
      const b = ring.pts2[iCur];
      const c = ring.pts2[iNext];
      if (cross2(a, b, c) <= 0) continue; // reflex — không phải ear
      // Không đỉnh nào khác nằm trong tam giác
      let contains = false;
      for (const j of idx) {
        if (j === iPrev || j === iCur || j === iNext) continue;
        if (pointInTriangle(ring.pts2[j], a, b, c)) {
          contains = true;
          break;
        }
      }
      if (contains) continue;
      triangles.push([ring.pts3[iPrev], ring.pts3[iCur], ring.pts3[iNext]]);
      idx.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) break; // không tìm được ear — thoát sang fallback
  }

  if (idx.length === 3) {
    triangles.push([ring.pts3[idx[0]], ring.pts3[idx[1]], ring.pts3[idx[2]]]);
  } else if (idx.length > 3) {
    // Fallback fan — hình có thể sai nhẹ với đa giác lõm, nhưng không treo
    degraded = true;
    for (let k = 1; k < idx.length - 1; k++) {
      triangles.push([ring.pts3[idx[0]], ring.pts3[idx[k]], ring.pts3[idx[k + 1]]]);
    }
  }

  return { triangles, degraded };
}

/** Đa giác 2D (đã chiếu) có lồi không — mặt lồi né được tam giác hoá. */
export function isConvexFace(vertices: readonly Vec3[], normal: Vec3): boolean {
  const pts = projectTo2D(vertices, normal);
  const n = pts.length;
  if (n <= 3) return true;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const c = cross2(pts[i], pts[(i + 1) % n], pts[(i + 2) % n]);
    if (c !== 0) {
      if (sign === 0) sign = Math.sign(c);
      else if (Math.sign(c) !== sign) return false;
    }
  }
  return true;
}
