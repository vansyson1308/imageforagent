import type { Vec2 } from "@/lib/services/construct/types";
import {
  applyAffine,
  fmt,
  invertAffine,
  placementToAffine,
} from "@/lib/services/construct/geometry2d";
import {
  desaturateRgb,
  GRADIENT_ID_PREFIX,
  mixRgb,
  parseHex,
  toHex,
  type GradientDescriptor,
  type GradientStop,
} from "@/lib/services/construct/shading";
import type { PathItem } from "@/lib/services/construct/svgEmitter";

/**
 * atmosphere — Layer 6 (Softness scene-wide): depth fade (viễn cận không
 * khí — vật xa ngả về màu trời + bớt bão hoà) và vignette (tối 4 góc,
 * phủ đúng canvas bất kể place transform nhờ inverse affine). Pure.
 */

export interface DepthFadeParams {
  readonly color: string;
  readonly strength: number;
  readonly desaturate: number;
}

export interface VignetteParams {
  readonly color: string;
  readonly strength: number;
  readonly start: number;
  readonly size: readonly [number, number];
}

export interface PlaceParams {
  readonly at: Vec2;
  readonly scale: number;
  readonly rotate: number;
}

/**
 * Fade một màu hex theo t ∈ [0,1] (0 = gần, 1 = xa nhất):
 * mix về params.color rồi giảm bão hoà — cả hai tỉ lệ theo strength·t.
 */
export function fadeHex(hex: string, t: number, params: DepthFadeParams): string {
  if (t <= 0) return hex;
  const rgb = parseHex(hex);
  const target = parseHex(params.color);
  if (!rgb || !target) return hex;
  const k = params.strength * Math.min(1, t);
  return toHex(desaturateRgb(mixRgb(rgb, target, k), params.desaturate * k));
}

/** Fade toàn bộ stop của một gradient (giữ offset/opacity). */
export function fadeStops(
  stops: readonly GradientStop[],
  t: number,
  params: DepthFadeParams,
): GradientStop[] {
  return stops.map((s) => ({ ...s, color: fadeHex(s.color, t, params) }));
}

export interface VignetteBuild {
  readonly path: PathItem;
  readonly gradient: GradientDescriptor;
}

/**
 * Vignette phủ ĐÚNG canvas [0,0,size] trong hệ toạ độ CUỐI: fragment nằm
 * trong <g transform="place"> nên rect canvas phải map NGƯỢC place vào
 * không gian vẽ (place = translate·rotate·scale đều → luôn khả nghịch).
 * Radial gradient userSpaceOnUse tâm canvas, r = ½ đường chéo / scale.
 */
export function buildVignette(v: VignetteParams, place: PlaceParams, precision: number): VignetteBuild {
  const inv = invertAffine(
    placementToAffine({ at: place.at, rotate: place.rotate, scale: place.scale }),
  );
  const [w, h] = v.size;
  const corners: Vec2[] = [
    applyAffine(inv, [0, 0]),
    applyAffine(inv, [w, 0]),
    applyAffine(inv, [w, h]),
    applyAffine(inv, [0, h]),
  ];
  const center = applyAffine(inv, [w / 2, h / 2]);
  const radius = Math.hypot(w, h) / 2 / place.scale;

  const gradient: GradientDescriptor = {
    id: `${GRADIENT_ID_PREFIX}vignette`,
    kind: "radialGradient",
    attrs: {
      gradientUnits: "userSpaceOnUse",
      cx: fmt(center[0], 2),
      cy: fmt(center[1], 2),
      r: fmt(radius, 2),
    },
    stops: [
      { offset: 0, color: v.color, opacity: 0 },
      { offset: v.start, color: v.color, opacity: 0 },
      { offset: 1, color: v.color, opacity: v.strength },
    ],
  };
  const d =
    corners
      .map(([x, y], i) => `${i === 0 ? "M" : "L"} ${fmt(x, precision)} ${fmt(y, precision)}`)
      .join(" ") + " Z";
  return {
    path: { d, fill: `url(#${gradient.id})`, fillRule: "nonzero" },
    gradient,
  };
}
