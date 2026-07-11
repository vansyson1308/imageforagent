import type { Mat4, Mesh, ProjectedFace, Vec3 } from "@/lib/services/construct/types";
import { centroid3, faceNormal, sub3, dot3, transformPoint } from "@/lib/services/construct/math3d";
import { projectViewPoint, type Projection } from "@/lib/services/construct/camera";

/**
 * painterSort — cull mặt quay lưng + chiếu + sort painter's algorithm.
 * Mọi solid của engine đều là khối kín → luôn backface-cull.
 * Giới hạn ghi trong ADR-011: solids xuyên nhau có thể sort sai (không BSP).
 */

const CULL_EPS = 1e-9;

export interface SolidSceneItem {
  readonly solidId: string;
  readonly solidIndex: number;
  /** Mesh ĐÃ transform sang world space. */
  readonly mesh: Mesh;
}

/**
 * Chiếu toàn scene → danh sách mặt nhìn thấy được, đã sort xa→gần
 * (vẽ tuần tự = painter's algorithm). Tie-break (solidIndex, faceIndex)
 * để deterministic tuyệt đối.
 */
export function projectAndSort(
  items: readonly SolidSceneItem[],
  view: Mat4,
  projection: Projection,
): ProjectedFace[] {
  const out: ProjectedFace[] = [];
  const camPos: Vec3 = [0, 0, projection.kind === "perspective" ? projection.distance : 0];

  for (const item of items) {
    // Transform đỉnh sang view space MỘT lần cho cả mesh
    const viewVerts = item.mesh.vertices.map((v) => transformPoint(view, v));

    item.mesh.faces.forEach((face, faceIndex) => {
      const pts = face.vertices.map((i) => viewVerts[i]);
      const normal = faceNormal(pts);
      const center = centroid3(pts);

      // Backface cull: ortho nhìn dọc −z (visible nếu normal.z > 0);
      // perspective nhìn từ camPos về mặt
      const visible =
        projection.kind === "orthographic"
          ? normal[2] > CULL_EPS
          : dot3(normal, sub3(camPos, center)) > CULL_EPS;
      if (!visible) return;

      out.push({
        points: pts.map((p) => projectViewPoint(p, projection).screen),
        holes: face.holes?.map((ring) =>
          ring.map((i) => projectViewPoint(viewVerts[i], projection).screen),
        ),
        depth: center[2],
        normal,
        solidId: item.solidId,
        solidIndex: item.solidIndex,
        faceIndex,
        label: face.label,
        fill: face.fill,
      });
    });
  }

  // Xa trước (depth nhỏ = xa camera vì z_view lớn = gần)
  out.sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth;
    if (a.solidIndex !== b.solidIndex) return a.solidIndex - b.solidIndex;
    return a.faceIndex - b.faceIndex;
  });
  return out;
}

/**
 * Cảnh báo heuristic solids giao nhau (painter's có thể sai chỗ overlap):
 * so AABB world-space từng cặp.
 */
export function overlapWarnings(items: readonly SolidSceneItem[]): string[] {
  interface Box {
    readonly id: string;
    readonly min: Vec3;
    readonly max: Vec3;
  }
  const boxes: Box[] = items.map((item) => {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const [x, y, z] of item.mesh.vertices) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
    return { id: item.solidId, min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
  });

  const warnings: string[] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const overlaps =
        a.min[0] < b.max[0] && a.max[0] > b.min[0] &&
        a.min[1] < b.max[1] && a.max[1] > b.min[1] &&
        a.min[2] < b.max[2] && a.max[2] > b.min[2];
      if (overlaps) {
        warnings.push(
          `Solids "${a.id}" and "${b.id}" overlap — painter's sort may be wrong where they intersect; offset them or accept the draw order.`,
        );
      }
    }
  }
  return warnings;
}
