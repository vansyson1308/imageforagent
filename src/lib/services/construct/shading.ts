import type { Vec3 } from "@/lib/services/construct/types";
import type { SpecGradient } from "@/lib/validation/constructSchema";
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

// ---------- HSL + blend (Softness layer) ----------

export interface Hsl {
  /** Hue độ [0, 360). */
  readonly h: number;
  /** Saturation [0, 1]. */
  readonly s: number;
  /** Lightness [0, 1]. */
  readonly l: number;
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s, l };
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let rgb: [number, number, number];
  if (hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const m = l - c / 2;
  return { r: (rgb[0] + m) * 255, g: (rgb[1] + m) * 255, b: (rgb[2] + m) * 255 };
}

/** Xoay hue VỀ PHÍA target theo cung ngắn nhất, tối đa maxDegrees. */
export function shiftHueToward(hue: number, target: number, maxDegrees: number): number {
  let delta = (((target - hue) % 360) + 360) % 360;
  if (delta > 180) delta -= 360;
  const step = Math.sign(delta) * Math.min(Math.abs(delta), maxDegrees);
  return (((hue + step) % 360) + 360) % 360;
}

/** Lerp tuyến tính hai màu, t ∈ [0,1] (0 = a, 1 = b). */
export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

/** Giảm bão hoà: s *= (1 − amount), amount ∈ [0,1]. */
export function desaturateRgb(rgb: Rgb, amount: number): Rgb {
  const hsl = rgbToHsl(rgb);
  return hslToRgb({ ...hsl, s: hsl.s * (1 - Math.max(0, Math.min(1, amount))) });
}

/** Blend multiply tự tính trong TS (không dựa librsvg): a·b/255. */
export function multiplyRgb(a: Rgb, b: Rgb): Rgb {
  return { r: (a.r * b.r) / 255, g: (a.g * b.g) / 255, b: (a.b * b.b) / 255 };
}

/** Blend screen: 255 − (255−a)(255−b)/255. */
export function screenRgb(a: Rgb, b: Rgb): Rgb {
  return {
    r: 255 - ((255 - a.r) * (255 - b.r)) / 255,
    g: 255 - ((255 - a.g) * (255 - b.g)) / 255,
    b: 255 - ((255 - a.b) * (255 - b.b)) / 255,
  };
}

/** Hue "lạnh" chuẩn cho bóng (xanh dương đêm) — kỷ luật phong cách. */
export const COOL_SHADOW_HUE = 230;

/**
 * Màu bóng mặc định theo kỷ luật phong cách: KHÔNG BAO GIỜ #000 —
 * lightness −25%, hue xoay 25° về phía lạnh (230°).
 */
export function softShadowColor(baseHex: string): string {
  const rgb = parseHex(baseHex);
  if (!rgb) return "#31425e";
  const hsl = rgbToHsl(rgb);
  return toHex(
    hslToRgb({
      h: shiftHueToward(hsl.s < 0.05 ? COOL_SHADOW_HUE : hsl.h, COOL_SHADOW_HUE, 25),
      s: Math.max(hsl.s, 0.18),
      l: Math.max(0, hsl.l - 0.25),
    }),
  );
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
 * Gradient TÁC GIẢ (spec.gradients) → descriptor objectBoundingBox.
 * Linear: angle độ screen-space (0 = sang phải, 90 = xuống dưới) → trục
 * qua tâm bbox. Radial: focus lệch tâm điểm sáng, radius theo tỉ lệ bbox.
 * Id giữ NGUYÊN VĂN của tác giả (namespace chung, cg- đã bị schema chặn).
 */
export function authorGradient(g: SpecGradient): GradientDescriptor {
  const f = (v: number) => v.toFixed(3);
  if (g.kind === "linear") {
    const a = (g.angle * Math.PI) / 180;
    const dx = Math.cos(a) / 2;
    const dy = Math.sin(a) / 2;
    return {
      id: g.id,
      kind: "linearGradient",
      attrs: { x1: f(0.5 - dx), y1: f(0.5 - dy), x2: f(0.5 + dx), y2: f(0.5 + dy) },
      stops: g.stops,
    };
  }
  return {
    id: g.id,
    kind: "radialGradient",
    attrs: {
      cx: "0.5",
      cy: "0.5",
      r: f(g.radius),
      fx: f(0.5 + g.focus[0]),
      fy: f(0.5 + g.focus[1]),
    },
    stops: g.stops,
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
