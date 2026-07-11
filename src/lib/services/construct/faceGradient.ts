import type { ProjectedFace, Vec3 } from "@/lib/services/construct/types";
import { dot3, normalize3, scale3, sub3 } from "@/lib/services/construct/math3d";
import { fmt } from "@/lib/services/construct/geometry2d";
import {
  applyLuminance,
  GRADIENT_ID_PREFIX,
  lambertFactor,
  luminance,
  type GradientDescriptor,
} from "@/lib/services/construct/shading";

/**
 * faceGradient — Layer 4b: light.mode "gradient" — thay fill phẳng lượng tử
 * bằng linearGradient userSpaceOnUse chạy DỌC TRỤC SÁNG chiếu lên từng mặt.
 * Né hẳn giới hạn affine của gradientTransform: linear gradient chỉ cần
 * vector màn hình + stops, không cần map quad.
 */

export interface FaceGradientResult {
  readonly fill: string;
  readonly gradient?: GradientDescriptor;
}

/** Độ chênh lambert giữa hai đầu gradient. */
const RAMP_DELTA = 0.15;

/**
 * Fill gradient cho một mặt. Trả fill phẳng (không gradient) khi:
 * ánh sáng vuông góc mặt (không có trục), mặt suy biến, hoặc hết budget.
 * @param seq số thứ tự gradient (id cg-f<seq> — duy nhất kể cả fragment split)
 */
export function faceGradientFill(
  face: ProjectedFace,
  baseHex: string,
  lightView: Vec3,
  ambient: number,
  seq: number,
  budgetLeft: number,
): FaceGradientResult {
  const n = normalize3(face.normal);
  const f = lambertFactor(face.normal, lightView);
  const flat = applyLuminance(baseHex, luminance(f, ambient));

  if (budgetLeft <= 0) return { fill: flat };

  // Thành phần ánh sáng NẰM TRONG mặt phẳng của mặt
  const lp = sub3(lightView, scale3(n, dot3(lightView, n)));
  const lpLen = Math.hypot(lp[0], lp[1], lp[2]);
  if (lpLen < 1e-6) return { fill: flat }; // sáng vuông góc — không có hướng ramp

  // Trục màn hình (y-down): điểm ở PHÍA nguồn sáng tới là đầu SÁNG
  const axRaw: readonly [number, number] = [-lp[0], lp[1]];
  const axLen = Math.hypot(axRaw[0], axRaw[1]);
  if (axLen < 1e-6) return { fill: flat };
  const ax = [axRaw[0] / axLen, axRaw[1] / axLen] as const;

  // Hai điểm cực trị dọc trục (tie-break index nhỏ)
  let minDot = Infinity;
  let maxDot = -Infinity;
  let p1 = face.points[0];
  let p2 = face.points[0];
  for (const p of face.points) {
    const d = p[0] * ax[0] + p[1] * ax[1];
    if (d < minDot) {
      minDot = d;
      p1 = p;
    }
    if (d > maxDot) {
      maxDot = d;
      p2 = p;
    }
  }
  if (maxDot - minDot < 1e-6) return { fill: flat };

  const bright = applyLuminance(baseHex, luminance(Math.min(1, f + RAMP_DELTA), ambient));
  const dark = applyLuminance(baseHex, luminance(Math.max(0, f - RAMP_DELTA), ambient));

  const gradient: GradientDescriptor = {
    id: `${GRADIENT_ID_PREFIX}f${seq}`,
    kind: "linearGradient",
    attrs: {
      gradientUnits: "userSpaceOnUse",
      // p2 = cực trị theo ax = phía nguồn sáng → SÁNG; gradient x1(sáng)→x2(tối)
      x1: fmt(p2[0], 2),
      y1: fmt(p2[1], 2),
      x2: fmt(p1[0], 2),
      y2: fmt(p1[1], 2),
    },
    stops: [
      { offset: 0, color: bright },
      { offset: 1, color: dark },
    ],
  };
  return { fill: `url(#${gradient.id})`, gradient };
}
