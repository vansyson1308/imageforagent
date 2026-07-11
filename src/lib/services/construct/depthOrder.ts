import type { Mat4, ProjectedFace, Vec2, Vec3 } from "@/lib/services/construct/types";
import { centroid3, dot3, faceNormal, sub3, transformPoint } from "@/lib/services/construct/math3d";
import { projectViewPoint, type Projection } from "@/lib/services/construct/camera";
import {
  planeFromPolygon,
  signedDistance,
  splitPolygonByPlane,
  type Plane,
  type Polygon3,
} from "@/lib/services/construct/plane3";
import type { SolidSceneItem } from "@/lib/services/construct/painterSort";
import { CONSTRUCT_LIMITS } from "@/lib/config/limits";

/**
 * depthOrder — Layer 2: sắp thứ tự vẽ ĐÚNG kể cả khối xuyên nhau, theo
 * Newell–Newell–Sancha: sort như painter, rồi với từng mặt sắp vẽ chạy
 * chuỗi 5 phép thử rẻ→đắt với các mặt chồng lấn độ sâu; chỉ khi mọi phép
 * thử thất bại (xung đột thật) mới CẮT lazy bằng kernel plane3.
 *
 * Bất biến then chốt: khoá sort khởi đầu = ĐÚNG khoá painter (depth
 * centroid, solidIndex, faceIndex) → cảnh không xung đột cho output
 * byte-identical painter; exact là strict extension.
 */

const EPS = 1e-6;

interface FaceRec {
  /** Đỉnh view-space (z lớn = gần camera). */
  viewPts: readonly Vec3[];
  holesView?: readonly (readonly Vec3[])[];
  screen: readonly Vec2[];
  holesScreen?: readonly (readonly Vec2[])[];
  plane: Plane | null; // view-space
  depth: number; // centroid z — khoá painter
  minZ: number;
  maxZ: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  normal: Vec3;
  solidId: string;
  solidIndex: number;
  faceIndex: number;
  label?: string;
  fill?: string;
  fragSeq: number;
  moved: boolean;
}

function paintCompare(a: FaceRec, b: FaceRec): number {
  if (a.depth !== b.depth) return a.depth - b.depth;
  if (a.solidIndex !== b.solidIndex) return a.solidIndex - b.solidIndex;
  if (a.faceIndex !== b.faceIndex) return a.faceIndex - b.faceIndex;
  return a.fragSeq - b.fragSeq;
}

function buildRec(
  viewPts: readonly Vec3[],
  holesView: readonly (readonly Vec3[])[] | undefined,
  projection: Projection,
  meta: Pick<FaceRec, "solidId" | "solidIndex" | "faceIndex" | "label" | "fill" | "fragSeq">,
): FaceRec {
  const screen = viewPts.map((p) => projectViewPoint(p, projection).screen);
  const holesScreen = holesView?.map((ring) =>
    ring.map((p) => projectViewPoint(p, projection).screen),
  );
  let minZ = Infinity, maxZ = -Infinity;
  for (const p of viewPts) {
    if (p[2] < minZ) minZ = p[2];
    if (p[2] > maxZ) maxZ = p[2];
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of screen) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return {
    viewPts,
    holesView,
    screen,
    holesScreen,
    plane: planeFromPolygon(viewPts),
    depth: centroid3(viewPts)[2],
    minZ, maxZ, minX, maxX, minY, maxY,
    normal: faceNormal(viewPts),
    ...meta,
    moved: false,
  };
}

// ---------- Phép thử 5: chồng lấn đa giác 2D màn hình (SAT) ----------

/**
 * SAT (Separating Axis Theorem): hai đa giác rời nhau ⟺ tồn tại trục
 * pháp tuyến cạnh tách được hai hình. Robust với chạm mép (khác test
 * giao-cắt-cạnh proper — thất bại khi mọi giao điểm rơi đúng đầu mút).
 * Với đa giác lõm SAT bảo thủ (có thể báo chồng khi không) — hướng an
 * toàn: dư một lần split, thứ tự vẫn đúng.
 */
function screenOverlap(a: FaceRec, b: FaceRec): boolean {
  const rings = [a.screen, b.screen];
  for (const ring of rings) {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[(i + 1) % n];
      // Trục pháp tuyến cạnh
      const ax = y1 - y2;
      const ay = x2 - x1;
      const len = Math.hypot(ax, ay);
      if (len < 1e-12) continue;
      let minA = Infinity, maxA = -Infinity;
      for (const [x, y] of a.screen) {
        const d = (x * ax + y * ay) / len;
        if (d < minA) minA = d;
        if (d > maxA) maxA = d;
      }
      let minB = Infinity, maxB = -Infinity;
      for (const [x, y] of b.screen) {
        const d = (x * ax + y * ay) / len;
        if (d < minB) minB = d;
        if (d > maxB) maxB = d;
      }
      if (maxA <= minB + EPS || maxB <= minA + EPS) return false; // trục tách
    }
  }
  return true;
}

// ---------- NNS ----------

export interface DepthOrderResult {
  readonly faces: ProjectedFace[];
  readonly splits: number;
  /** true nếu cạn budget split → phần còn lại rơi về painter order. */
  readonly fallback: boolean;
}

/**
 * Trả danh sách mặt ĐÚNG thứ tự vẽ (xa vẽ trước). Mảnh cắt kế thừa
 * solidId/faceIndex/label/fill của mặt cha (hợp đồng cutout giữ nguyên).
 */
export function depthOrderNNS(
  items: readonly SolidSceneItem[],
  view: Mat4,
  projection: Projection,
  checkClock: (stage: string) => void,
): DepthOrderResult {
  const camPos: Vec3 = [0, 0, projection.kind === "perspective" ? projection.distance : 0];

  // Cull + build (cùng tiêu chí painterSort)
  const list: FaceRec[] = [];
  for (const item of items) {
    const viewVerts = item.mesh.vertices.map((v) => transformPoint(view, v));
    item.mesh.faces.forEach((face, faceIndex) => {
      const pts = face.vertices.map((i) => viewVerts[i]);
      const normal = faceNormal(pts);
      const visible =
        projection.kind === "orthographic"
          ? normal[2] > 1e-9
          : dot3(normal, sub3(camPos, centroid3(pts))) > 1e-9;
      if (!visible) return;
      list.push(
        buildRec(
          pts,
          face.holes?.map((ring) => ring.map((i) => viewVerts[i])),
          projection,
          {
            solidId: item.solidId,
            solidIndex: item.solidIndex,
            faceIndex,
            label: face.label,
            fill: face.fill,
            fragSeq: 0,
          },
        ),
      );
    });
  }
  list.sort(paintCompare);

  /** Phía camera so với plane: >0 = camera bên positive. */
  const viewerSide = (plane: Plane): number =>
    projection.kind === "orthographic" ? plane.normal[2] : signedDistance(plane, camPos);

  /** P vẽ trước Q được không (một trong 5 phép thử pass)? */
  function safeBefore(P: FaceRec, Q: FaceRec): boolean {
    // 1+2: extent màn hình rời nhau
    if (P.maxX <= Q.minX + EPS || Q.maxX <= P.minX + EPS) return true;
    if (P.maxY <= Q.minY + EPS || Q.maxY <= P.minY + EPS) return true;
    // 3: P nằm trọn phía XA camera của plane Q
    if (Q.plane) {
      const side = viewerSide(Q.plane);
      if (Math.abs(side) > EPS) {
        const behind = side > 0
          ? P.viewPts.every((p) => signedDistance(Q.plane!, p) <= EPS)
          : P.viewPts.every((p) => signedDistance(Q.plane!, p) >= -EPS);
        if (behind) return true;
      }
    }
    // 4: Q nằm trọn phía GẦN camera của plane P
    if (P.plane) {
      const side = viewerSide(P.plane);
      if (Math.abs(side) > EPS) {
        const inFront = side > 0
          ? Q.viewPts.every((p) => signedDistance(P.plane!, p) >= -EPS)
          : Q.viewPts.every((p) => signedDistance(P.plane!, p) <= EPS);
        if (inFront) return true;
      }
    }
    // 5: đa giác màn hình rời nhau thật sự
    if (!screenOverlap(P, Q)) return true;
    return false;
  }

  const out: FaceRec[] = [];
  let splits = 0;
  let fragSeqCounter = 1;
  let fallback = false;
  let clockTick = 0;

  while (list.length > 0) {
    if ((clockTick++ & 63) === 0) checkClock("depth-order");
    const P = list[0];
    let conflict: { q: FaceRec; index: number } | null = null;

    for (let j = 1; j < list.length; j++) {
      const Q = list[j];
      // z-range không chồng → thứ tự sẵn đúng
      if (Q.minZ >= P.maxZ - EPS) continue;
      if (!safeBefore(P, Q)) {
        conflict = { q: Q, index: j };
        break;
      }
    }

    if (!conflict) {
      out.push(list.shift()!);
      // Reset mark khi có tiến triển
      if (out.length % 64 === 0) for (const f of list) f.moved = false;
      continue;
    }

    const { q: Q, index } = conflict;
    if (!Q.moved) {
      // Swap-once: thử vẽ Q trước
      Q.moved = true;
      list.splice(index, 1);
      list.unshift(Q);
      continue;
    }

    // Xung đột lặp (chu trình / xuyên nhau) → CẮT P bằng plane Q (Layer 0)
    if (splits >= CONSTRUCT_LIMITS.maxDepthSplits) {
      fallback = true;
      break;
    }
    let pieces: Polygon3[] = [];
    if (Q.plane) {
      const buckets = { coplanarFront: [] as Polygon3[], coplanarBack: [] as Polygon3[], front: [] as Polygon3[], back: [] as Polygon3[] };
      splitPolygonByPlane(
        Q.plane,
        { vertices: P.viewPts, shared: { solidId: P.solidId, solidIndex: P.solidIndex, faceIndex: P.faceIndex, label: P.label, fill: P.fill } },
        EPS,
        buckets,
      );
      pieces = [...buckets.front, ...buckets.back, ...buckets.coplanarFront, ...buckets.coplanarBack];
    }
    if (pieces.length <= 1) {
      // Không cắt được (coplanar/suy biến) — chấp nhận vẽ P trước
      out.push(list.shift()!);
      continue;
    }
    splits += pieces.length - 1;
    list.shift();
    for (const piece of pieces) {
      const rec = buildRec(piece.vertices, undefined, projection, {
        solidId: P.solidId,
        solidIndex: P.solidIndex,
        faceIndex: P.faceIndex,
        label: P.label,
        fill: P.fill,
        fragSeq: fragSeqCounter++,
      });
      // Chèn giữ thứ tự painter (binary insert)
      let lo = 0;
      let hi = list.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (paintCompare(list[mid], rec) < 0) lo = mid + 1;
        else hi = mid;
      }
      list.splice(lo, 0, rec);
    }
  }

  if (fallback) {
    // Budget cạn: phần còn lại theo painter order thuần
    list.sort(paintCompare);
    out.push(...list);
  }

  return {
    faces: out.map((f) => ({
      points: f.screen,
      holes: f.holesScreen,
      depth: f.depth,
      normal: f.normal,
      solidId: f.solidId,
      solidIndex: f.solidIndex,
      faceIndex: f.faceIndex,
      label: f.label,
      fill: f.fill,
    })),
    splits,
    fallback,
  };
}
