import type { Mat4, Vec2, Vec3 } from "@/lib/services/construct/types";
import { dot3, faceNormal, sub3, transformPoint } from "@/lib/services/construct/math3d";
import { projectViewPoint, type Projection } from "@/lib/services/construct/camera";
import { convexHull2D, fmt } from "@/lib/services/construct/geometry2d";
import { unionPaths } from "@/lib/services/construct/pathBoolean";
import type { SolidSceneItem } from "@/lib/services/construct/painterSort";

/**
 * silhouette — outline MÀN HÌNH của một solid, nguyên liệu cho effects
 * layer (One Boolean Rule: mọi lưỡi liềm sáng/tối đều sinh từ S và bản
 * shift của S). Khối lồi (mọi primitive + smooth) = convex hull các đỉnh
 * chiếu — chính xác và rẻ. Khối lõm/CSG = union footprint các mặt HƯỚNG
 * CAMERA (cull đúng như painterSort) — giữ lỗ xuyên thấu (evenodd).
 */

const CULL_EPS = 1e-9;

export interface SolidSilhouette {
  /** Path data screen-space (đã quantize theo precision). */
  readonly d: string;
  /** Bbox screen của silhouette. */
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  /** R = ½ cạnh ngắn bbox — thước đo shift của các effect. */
  readonly r: number;
  /** Tâm bbox. */
  readonly centroid: Vec2;
}

function ringToPathD(ring: readonly Vec2[], precision: number): string {
  return (
    ring
      .map(([x, y], i) => `${i === 0 ? "M" : "L"} ${fmt(x, precision)} ${fmt(y, precision)}`)
      .join(" ") + " Z"
  );
}

/**
 * Dựng silhouette một solid; null nếu suy biến (edge-on toàn bộ / quá nhỏ).
 * Pure + deterministic — memo theo solidId ở phía compile.
 */
export function buildSilhouette(
  item: SolidSceneItem,
  view: Mat4,
  projection: Projection,
  precision: number,
): SolidSilhouette | null {
  const viewVerts = item.mesh.vertices.map((v) => transformPoint(view, v));
  const screen = viewVerts.map((v) => projectViewPoint(v, projection).screen);

  let d: string;
  let boundPts: readonly Vec2[];

  if (item.convex) {
    const hull = convexHull2D(screen);
    if (hull.length < 3) return null;
    d = ringToPathD(hull, precision);
    boundPts = hull;
  } else {
    // Union footprint mặt hướng camera — cull y hệt painterSort
    const camPos: Vec3 = [0, 0, projection.kind === "perspective" ? projection.distance : 0];
    const faceDs: string[] = [];
    const pts: Vec2[] = [];
    for (const face of item.mesh.faces) {
      const viewPts = face.vertices.map((i) => viewVerts[i]);
      const normal = faceNormal(viewPts);
      const visible =
        projection.kind === "orthographic"
          ? normal[2] > CULL_EPS
          : dot3(normal, sub3(camPos, viewPts[0])) > CULL_EPS;
      if (!visible) continue;
      const ring = face.vertices.map((i) => screen[i]);
      if (ring.length < 3) continue;
      let faceD = ringToPathD(ring, precision);
      if (face.holes) {
        for (const holeRing of face.holes) {
          const hole = holeRing.map((i) => screen[i]);
          if (hole.length >= 3) faceD += " " + ringToPathD(hole, precision);
        }
      }
      faceDs.push(faceD);
      pts.push(...ring);
    }
    if (faceDs.length === 0) return null;
    d = unionPaths(faceDs, precision, `silhouette of "${item.solidId}"`);
    if (d.length === 0) return null;
    boundPts = pts;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of boundPts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const r = Math.min(maxX - minX, maxY - minY) / 2;
  if (r < 1e-6) return null;
  return { d, minX, minY, maxX, maxY, r, centroid: [(minX + maxX) / 2, (minY + maxY) / 2] };
}
