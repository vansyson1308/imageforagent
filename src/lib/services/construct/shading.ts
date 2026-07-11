import type { Vec3 } from "@/lib/services/construct/types";
import { dot3, normalize3, scale3 } from "@/lib/services/construct/math3d";

/**
 * shading — lambert 1 nguồn sáng định hướng, lượng tử hoá N tông
 * (flat-design: mặt trên sáng nhất, trái vừa, phải tối) hoặc smooth
 * (gradient descriptor cho solid trơn kiểu zdog).
 */

// ---------- Màu hex ----------

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** Parse #rgb / #rrggbb (bỏ qua alpha nếu #rrggbbaa). */
export function parseHex(hex: string): Rgb | null {
  const m3 = hex.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (m3) {
    return {
      r: parseInt(m3[1] + m3[1], 16),
      g: parseInt(m3[2] + m3[2], 16),
      b: parseInt(m3[3] + m3[3], 16),
    };
  }
  const m6 = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i);
  if (m6) {
    return { r: parseInt(m6[1], 16), g: parseInt(m6[2], 16), b: parseInt(m6[3], 16) };
  }
  return null;
}

export function toHex({ r, g, b }: Rgb): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Nhân độ chói — lum ∈ [0, ~1.2] (cho phép over-bright nhẹ cho highlight). */
export function applyLuminance(hex: string, lum: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  return toHex({ r: rgb.r * lum, g: rgb.g * lum, b: rgb.b * lum });
}

// ---------- Lambert + lượng tử ----------

export interface LightParams {
  /** Hướng ánh sáng ĐI TỚI (view-space, đã transform cùng hệ với normal). */
  readonly direction: Vec3;
  readonly tones: number;
  readonly ambient: number;
  readonly mode: "quantized" | "smooth" | "gradient";
}

/**
 * Hướng sáng mặc định — tinh chỉnh để cube isometric ra ĐÚNG 3 tông tách
 * bạch (top≈0.85 → tông 1, trái +z≈0.50 → tông giữa, phải +x≈0.15 → tông
 * thấp nhất với tones=3) — quy ước cổ điển của hoạ sĩ iso.
 */
export const DEFAULT_LIGHT_DIRECTION: Vec3 = [-0.3, -1.7, -1];

/** Hệ số lambert thô ∈ [0,1]: mặt đối diện nguồn sáng = 1. */
export function lambertFactor(normal: Vec3, lightDirection: Vec3): number {
  const toLight = scale3(normalize3(lightDirection), -1);
  return Math.max(0, dot3(normalize3(normal), toLight));
}

/**
 * Lượng tử hoá về N mức đều {0, 1/(n−1), …, 1} — flat-design đúng nghĩa,
 * ranh giới tông sắc nét giữa các mặt.
 */
export function quantizeFactor(factor: number, tones: number): number {
  if (tones <= 1) return 1;
  const step = Math.round(factor * (tones - 1));
  return step / (tones - 1);
}

/** Độ chói cuối = ambient floor + phần chiếu sáng. */
export function luminance(factor: number, ambient: number): number {
  return ambient + (1 - ambient) * factor;
}

/** Fill hex cho một mặt theo chế độ quantized. */
export function shadeFaceHex(baseHex: string, normal: Vec3, light: LightParams): string {
  const raw = lambertFactor(normal, light.direction);
  const factor = light.mode === "quantized" ? quantizeFactor(raw, light.tones) : raw;
  return applyLuminance(baseHex, luminance(factor, light.ambient));
}

// ---------- Gradient descriptor (solid smooth) ----------

export interface GradientStop {
  readonly offset: number;
  readonly color: string;
  readonly opacity?: number;
}

export interface GradientDescriptor {
  readonly id: string;
  readonly kind: "linearGradient" | "radialGradient";
  /** Thuộc tính hình học (fx/fy/cx/cy/r hoặc x1/y1/x2/y2) — objectBoundingBox. */
  readonly attrs: Readonly<Record<string, string>>;
  readonly stops: readonly GradientStop[];
}

/** Prefix id gradient RESERVED của engine — ghi trong contract. */
export const GRADIENT_ID_PREFIX = "cg-";

/**
 * Gradient cầu (sphere smooth): radial, highlight lệch về phía nguồn sáng.
 * lightScreen = hướng sáng chiếu lên màn hình (đã normalize, y-down).
 */
export function sphereGradient(
  id: string,
  baseHex: string,
  light: LightParams,
  lightScreen: readonly [number, number],
): GradientDescriptor {
  const amb = luminance(0, light.ambient);
  // Tâm highlight lệch ngược hướng ánh sáng tới (phía nguồn sáng)
  const fx = 0.5 - lightScreen[0] * 0.25;
  const fy = 0.5 - lightScreen[1] * 0.25;
  return {
    id: `${GRADIENT_ID_PREFIX}${id}`,
    kind: "radialGradient",
    attrs: {
      cx: "0.5",
      cy: "0.5",
      r: "0.5",
      fx: fx.toFixed(3),
      fy: fy.toFixed(3),
    },
    stops: [
      { offset: 0, color: applyLuminance(baseHex, 1.15) },
      { offset: 0.55, color: baseHex },
      { offset: 1, color: applyLuminance(baseHex, amb) },
    ],
  };
}

/**
 * Gradient thân trụ/nón (smooth): linear ngang qua silhouette —
 * sáng phía nguồn sáng, tối phía đối diện.
 */
export function sideGradient(
  id: string,
  baseHex: string,
  light: LightParams,
  lightScreenX: number,
): GradientDescriptor {
  const amb = luminance(0, light.ambient);
  const stops: GradientStop[] = [
    { offset: 0, color: applyLuminance(baseHex, 1.05) },
    { offset: 0.5, color: baseHex },
    { offset: 1, color: applyLuminance(baseHex, amb) },
  ];
  // Ánh sáng từ phải → đảo chiều gradient
  const flip = lightScreenX > 0;
  return {
    id: `${GRADIENT_ID_PREFIX}${id}`,
    kind: "linearGradient",
    attrs: flip
      ? { x1: "1", y1: "0", x2: "0", y2: "0" }
      : { x1: "0", y1: "0", x2: "1", y2: "0" },
    stops,
  };
}
