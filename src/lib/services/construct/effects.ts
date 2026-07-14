import type { Affine2D, Vec2 } from "@/lib/services/construct/types";
import type { SolidEffects } from "@/lib/validation/constructSchema";
import { fmt, segmentsToPathData, transformSegments } from "@/lib/services/construct/geometry2d";
import { parsePathData } from "@/lib/services/construct/pathParse";
import { runBoolean } from "@/lib/services/construct/pathBoolean";
import {
  GRADIENT_ID_PREFIX,
  softShadowColor,
  type GradientDescriptor,
} from "@/lib/services/construct/shading";
import type { FilterDescriptor, PathItem } from "@/lib/services/construct/svgEmitter";
import type { SolidSilhouette } from "@/lib/services/construct/silhouette";

/**
 * effects — Layer 4c (Softness): các lớp làm mềm per-solid sinh từ MỘT
 * quy tắc boolean duy nhất trên silhouette S và bản shift của S về phía
 * nguồn sáng. Mép mềm KHÔNG cần filter: fill lưỡi liềm bằng linear
 * gradient userSpaceOnUse dọc trục sáng với stop-opacity tắt dần ở
 * terminator (kỹ thuật faceGradient sẵn có). Pure — không I/O.
 *
 * Kiểm chiều 1D: S = [0,10], sáng đi +x (nguồn bên trái) → shift về
 * nguồn = −x: shift(S,5) = [−5,5] → S − shift = [5,10] (phía khuất) TỐI;
 * S ∩ shift = [0,5] (phía nguồn) SÁNG.
 */

/** Trắng ấm default cho highlight (kỷ luật: highlight ấm / bóng lạnh). */
export const HIGHLIGHT_COLOR = "#fff1dd";
/** Lạnh sáng default cho rim (ánh viền ngược). */
export const RIM_COLOR = "#dcecff";

export interface EffectsBuild {
  /** Vẽ ĐÈ lên solid (decals của entry cuối). */
  readonly over: PathItem[];
  /** Vẽ SAU LƯNG solid (preItems của entry đầu — glow S3). */
  readonly behind: PathItem[];
  readonly gradients: GradientDescriptor[];
  readonly filters: FilterDescriptor[];
  readonly warnings: string[];
  /** Giá trị seq sau khi cấp id — truyền cho solid kế tiếp. */
  readonly seqEnd: number;
}

export interface EffectsInput {
  readonly solidId: string;
  readonly silhouette: SolidSilhouette;
  /** Hướng ánh sáng ĐI TỚI trên màn hình (y-down) — chưa chắc đơn vị. */
  readonly lightScreen: Vec2;
  readonly effects: SolidEffects;
  /** Fill gốc của solid (hex) — nguồn suy màu bóng mặc định. */
  readonly baseFill: string;
  readonly precision: number;
  /** Bộ đếm id cg-e toàn cảnh. */
  readonly seq: number;
}

function translateAffine(dx: number, dy: number): Affine2D {
  return { a: 1, b: 0, c: 0, d: 1, e: dx, f: dy };
}

/** Chuẩn hoá toggle boolean|object của schema → params hoặc null. */
function norm<T>(v: boolean | T | undefined, defaults: T): T | null {
  if (v === undefined || v === false) return null;
  return v === true ? defaults : v;
}

export function buildSolidEffects(input: EffectsInput): EffectsBuild {
  const { solidId, silhouette: sil, effects, baseFill, precision } = input;
  const over: PathItem[] = [];
  const behind: PathItem[] = [];
  const gradients: GradientDescriptor[] = [];
  const filters: FilterDescriptor[] = [];
  const warnings: string[] = [];
  let seq = input.seq;

  const lLen = Math.hypot(input.lightScreen[0], input.lightScreen[1]);
  if (lLen < 1e-3) {
    warnings.push(
      `Effects on "${solidId}" skipped: light is head-on to the camera — no screen direction for crescents. Tilt light.direction.`,
    );
    return { over, behind, gradients, filters, warnings, seqEnd: seq };
  }
  // L̂ = hướng sáng đơn vị trên màn hình; shift VỀ NGUỒN = −L̂
  const lx = input.lightScreen[0] / lLen;
  const ly = input.lightScreen[1] / lLen;

  /** Bản sao S dịch về phía nguồn sáng một đoạn dist (px màn hình). */
  const shiftD = (dist: number): string =>
    segmentsToPathData(
      transformSegments(
        parsePathData(sil.d, `effects of "${solidId}"`),
        translateAffine(-lx * dist, -ly * dist),
      ),
      precision,
    );

  // Trục sáng qua tâm: q(t) = điểm có hình chiếu t dọc L̂
  const tc = sil.centroid[0] * lx + sil.centroid[1] * ly;
  const q = (t: number): Vec2 => [
    sil.centroid[0] + lx * (t - tc),
    sil.centroid[1] + ly * (t - tc),
  ];
  // Khoảng chiếu của bbox lên L̂ (4 góc)
  let tMin = Infinity;
  let tMax = -Infinity;
  for (const [x, y] of [
    [sil.minX, sil.minY],
    [sil.maxX, sil.minY],
    [sil.minX, sil.maxY],
    [sil.maxX, sil.maxY],
  ] as const) {
    const t = x * lx + y * ly;
    if (t < tMin) tMin = t;
    if (t > tMax) tMax = t;
  }

  /** Gradient linear userSpaceOnUse từ p1 → p2 tắt dần tại fadeAt. */
  const axisGradient = (
    p1: Vec2,
    p2: Vec2,
    color: string,
    opacity: number,
    fadeAt: number,
  ): GradientDescriptor => ({
    id: `${GRADIENT_ID_PREFIX}e${seq++}`,
    kind: "linearGradient",
    attrs: {
      gradientUnits: "userSpaceOnUse",
      x1: fmt(p1[0], 2),
      y1: fmt(p1[1], 2),
      x2: fmt(p2[0], 2),
      y2: fmt(p2[1], 2),
    },
    stops: [
      { offset: 0, color, opacity },
      { offset: fadeAt, color, opacity: 0 },
    ],
  });

  const crescent = (
    op: "difference" | "intersection",
    dist: number,
    label: string,
  ): string | null => {
    const result = runBoolean(op, [sil.d, shiftD(dist)], precision, `${label} of "${solidId}"`);
    if (result.isEmpty) {
      warnings.push(`Effect ${label} on "${solidId}" produced an empty shape — skipped (shift too large for this silhouette?).`);
      return null;
    }
    return result.d;
  };

  // ---- formShadow: lưỡi liềm TỐI phía khuất ----
  const fs = norm(effects.formShadow, { shift: 0.45, opacity: 0.15, color: undefined as string | undefined });
  if (fs) {
    const d = crescent("difference", fs.shift * sil.r, "formShadow");
    if (d) {
      const g = axisGradient(q(tMax), q(tMin), fs.color ?? softShadowColor(baseFill), fs.opacity, 0.55);
      gradients.push(g);
      over.push({ d, fill: `url(#${g.id})`, fillRule: "nonzero" });
    }
  }

  // ---- highlight: nửa SÁNG phía nguồn ----
  const hl = norm(effects.highlight, { shift: 0.5, opacity: 0.12, color: undefined as string | undefined });
  if (hl) {
    const d = crescent("intersection", hl.shift * sil.r, "highlight");
    if (d) {
      const g = axisGradient(q(tMin), q(tMax), hl.color ?? HIGHLIGHT_COLOR, hl.opacity, 0.55);
      gradients.push(g);
      over.push({ d, fill: `url(#${g.id})`, fillRule: "nonzero" });
    }
  }

  // ---- rim: viền sáng mỏng mép khuất ----
  const rim = norm(effects.rim, { width: 0.03, opacity: 0.6, color: undefined as string | undefined });
  if (rim) {
    const d = crescent("difference", rim.width * sil.r, "rim");
    if (d) {
      // Ramp ngắn VÀO TRONG từ mép khuất — dài 6×width·R
      const span = Math.max(6 * rim.width * sil.r, 1e-3);
      const g = axisGradient(q(tMax), q(tMax - span), rim.color ?? RIM_COLOR, rim.opacity, 1);
      gradients.push(g);
      over.push({ d, fill: `url(#${g.id})`, fillRule: "nonzero" });
    }
  }

  return { over, behind, gradients, filters, warnings, seqEnd: seq };
}
