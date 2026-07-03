/**
 * Cấu hình video Phase 9: tier, giá, ràng buộc duration/resolution, estimator.
 * Giá env-override được (USD/giây, đã gồm audio với fast/standard).
 */

export const VIDEO_TIERS = ["animatic", "lite", "fast", "standard"] as const;
export type VideoTier = (typeof VIDEO_TIERS)[number];

export const VIDEO_RESOLUTIONS = ["720p", "1080p"] as const;
export const TRANSITION_TYPES = ["cut", "crossfade"] as const;
export const CLIP_DURATIONS = [4, 6, 8] as const;

/** Aspect ratio Veo hỗ trợ — project khác chỉ dùng được animatic. */
export const VEO_ASPECT_RATIOS = ["16:9", "9:16"] as const;

function envPrice(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

export function pricePerSecondUsd(tier: VideoTier): number {
  switch (tier) {
    case "animatic":
      return 0;
    case "lite":
      return envPrice("VEO_PRICE_LITE", 0.05);
    case "fast":
      return envPrice("VEO_PRICE_FAST", 0.15);
    case "standard":
      return envPrice("VEO_PRICE_STANDARD", 0.4);
  }
}

export interface TierRules {
  readonly hasNativeAudio: boolean;
  readonly supportsReferenceImages: boolean;
  readonly allowedResolutions: readonly string[];
  readonly paid: boolean;
}

export const TIER_RULES: Record<VideoTier, TierRules> = {
  animatic: {
    hasNativeAudio: false,
    supportsReferenceImages: false,
    allowedResolutions: ["720p", "1080p"],
    paid: false,
  },
  lite: {
    hasNativeAudio: false, // Veo 3.1 Lite: silent only
    supportsReferenceImages: false,
    allowedResolutions: ["720p"],
    paid: true,
  },
  fast: {
    hasNativeAudio: true,
    supportsReferenceImages: true,
    allowedResolutions: ["720p", "1080p"],
    paid: true,
  },
  standard: {
    hasNativeAudio: true,
    supportsReferenceImages: true,
    allowedResolutions: ["720p", "1080p"],
    paid: true,
  },
};

/**
 * Duration hiệu lực theo ràng buộc Veo:
 * - 1080p bắt buộc 8s
 * - referenceImages bắt buộc 8s (fast/standard dùng refs → luôn 8s)
 * - lite: giữ nguyên lựa chọn (4/6/8), mặc định draft rẻ
 */
export function effectiveClipDuration(
  tier: VideoTier,
  requestedSec: number,
  resolution: string,
): number {
  const requested = CLIP_DURATIONS.includes(requestedSec as 4 | 6 | 8)
    ? requestedSec
    : 8;
  if (tier === "animatic") return requestedSec > 0 ? requestedSec : 8;
  if (resolution === "1080p") return 8;
  if (TIER_RULES[tier].supportsReferenceImages) return 8; // dùng refs → 8s
  return requested;
}

export interface CostEstimate {
  readonly clipCount: number;
  readonly totalSeconds: number;
  readonly estUsd: number;
}

export function estimateCost(
  tier: VideoTier,
  clipCount: number,
  secPerClip: number,
): CostEstimate {
  const totalSeconds = tier === "animatic" ? 0 : clipCount * secPerClip;
  return {
    clipCount,
    totalSeconds,
    estUsd: Math.round(totalSeconds * pricePerSecondUsd(tier) * 100) / 100,
  };
}

/** Kích thước pixel theo resolution + aspect. */
export function videoDimensions(
  resolution: string,
  aspectRatio: string,
): { w: number; h: number } {
  const base = resolution === "1080p" ? 1080 : 720;
  const [rw, rh] = aspectRatio.split(":").map(Number);
  if (!rw || !rh) return { w: (base * 16) / 9, h: base };
  if (rh > rw) {
    // dọc: chiều rộng = base
    return { w: base, h: Math.round((base * rh) / rw / 2) * 2 };
  }
  return { w: Math.round((base * rw) / rh / 2) * 2, h: base };
}

export function getDailyVideoSecondsLimit(): number {
  const raw = Number(process.env.DAILY_VIDEO_SECONDS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 120;
}
