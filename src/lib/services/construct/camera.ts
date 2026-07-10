import type { Mat4, Vec2, Vec3 } from "@/lib/services/construct/types";
import {
  mul4,
  rotationX4,
  rotationY4,
  rotationZ4,
  transformDirection,
  transformPoint,
} from "@/lib/services/construct/math3d";
import { AppError } from "@/lib/services/apiError";

/**
 * camera — orbit quanh gốc toạ độ → view matrix; chiếu orthographic hoặc
 * perspective xuống màn hình SVG (y-down).
 *
 * View = Rz(roll) · Rx(elevation) · Ry(−azimuth): sau biến đổi camera nằm
 * trên trục +z nhìn về −z; z_view càng lớn càng GẦN camera (sort tăng dần
 * = vẽ xa trước — painter's algorithm).
 */

/** Góc elevation isometric chuẩn: arctan(1/√2) ≈ 35.264°. */
export const TRUE_ISO_ELEVATION = Math.atan(1 / Math.SQRT2) * (180 / Math.PI);

export interface Orbit {
  readonly azimuth: number;
  readonly elevation: number;
  readonly roll: number;
}

export const CAMERA_PRESETS: Record<string, Orbit> = {
  isometric: { azimuth: 45, elevation: TRUE_ISO_ELEVATION, roll: 0 },
  "isometric-2:1": { azimuth: 45, elevation: 30, roll: 0 },
  dimetric: { azimuth: 45, elevation: 20, roll: 0 },
  top: { azimuth: 0, elevation: 90, roll: 0 },
  front: { azimuth: 0, elevation: 0, roll: 0 },
  side: { azimuth: 90, elevation: 0, roll: 0 },
};

export function viewMatrix(orbit: Orbit): Mat4 {
  let m = rotationY4(-orbit.azimuth);
  m = mul4(rotationX4(orbit.elevation), m);
  if (orbit.roll) m = mul4(rotationZ4(orbit.roll), m);
  return m;
}

export type Projection =
  | { readonly kind: "orthographic"; readonly zoom: number }
  | {
      readonly kind: "perspective";
      readonly zoom: number;
      /** Khoảng cách camera tới gốc (world units). */
      readonly distance: number;
    };

export interface ProjectedPoint {
  readonly screen: Vec2;
  /** z_view — lớn hơn = gần camera hơn. */
  readonly depth: number;
}

/**
 * Chiếu điểm ĐÃ ở view-space xuống màn hình.
 * Perspective: hệ số k = distance/(distance − z) — mặt phẳng qua gốc (z=0)
 * giữ scale 1, khớp orthographic; điểm sau camera → lỗi.
 */
export function projectViewPoint(p: Vec3, projection: Projection): ProjectedPoint {
  const [x, y, z] = p;
  if (projection.kind === "orthographic") {
    return { screen: [x * projection.zoom, -y * projection.zoom], depth: z };
  }
  const denom = projection.distance - z;
  if (denom < projection.distance * 0.01) {
    throw new AppError(
      "CONSTRUCTION_INVALID",
      "A point is behind or too close to the perspective camera.",
      'Increase camera "distance", reduce scene size, or use "orthographic" projection.',
    );
  }
  const k = (projection.distance / denom) * projection.zoom;
  return { screen: [x * k, -y * k], depth: z };
}

/** Điểm world → view → màn hình (tiện dụng). */
export function projectWorldPoint(
  view: Mat4,
  p: Vec3,
  projection: Projection,
): ProjectedPoint {
  return projectViewPoint(transformPoint(view, p), projection);
}

/** Normal world → view (view là rotation thuần nên không cần inverse-transpose). */
export function viewNormal(view: Mat4, n: Vec3): Vec3 {
  return transformDirection(view, n);
}

/**
 * Auto-fit distance cho perspective: 4× bán kính scene (đo từ gốc) —
 * đủ xa để méo phối cảnh nhẹ nhàng, không cắt điểm nào.
 */
export function autoDistance(sceneRadius: number): number {
  return Math.max(1, sceneRadius * 4);
}
