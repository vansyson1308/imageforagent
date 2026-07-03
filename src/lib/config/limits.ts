export const ASSET_LIMITS = {
  mascot_ref: 3,
  style_ref: 3,
  watermark: 1,
  bgm: 1, // nhạc nền — Phase 9
} as const;

export type AssetKind = keyof typeof ASSET_LIMITS;

export const ALLOWED_IMAGE_MIME_TYPES: readonly string[] = [
  "image/png",
  "image/jpeg",
  "image/webp",
];

export const ALLOWED_AUDIO_MIME_TYPES: readonly string[] = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/x-m4a",
];

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8MB/file ảnh
export const MAX_AUDIO_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB nhạc nền

/** Kind nào nhận mime nào + trần dung lượng. */
export function uploadRulesFor(kind: AssetKind): {
  mimes: readonly string[];
  maxBytes: number;
} {
  if (kind === "bgm") {
    return { mimes: ALLOWED_AUDIO_MIME_TYPES, maxBytes: MAX_AUDIO_UPLOAD_BYTES };
  }
  return { mimes: ALLOWED_IMAGE_MIME_TYPES, maxBytes: MAX_UPLOAD_BYTES };
}
export const MAX_FRAMES_PER_PROJECT = 100;
export const MAX_DESCRIPTION_LENGTH = 2000;

export function isAssetKind(value: string): value is AssetKind {
  return value in ASSET_LIMITS;
}

export interface UploadCandidate {
  readonly mimeType: string;
  readonly sizeBytes: number;
}

export type UploadValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: "ASSET_LIMIT" | "ASSET_BAD_TYPE" | "ASSET_TOO_LARGE"; readonly message: string };

/**
 * Validate một đợt upload theo kind. Watermark là trường hợp thay thế
 * (existingCount không chặn) nhưng mỗi đợt chỉ được 1 file.
 */
export function validateAssetUpload(
  kind: AssetKind,
  existingCount: number,
  files: readonly UploadCandidate[],
): UploadValidation {
  if (files.length === 0) {
    return { ok: false, code: "ASSET_LIMIT", message: "Không có file nào được gửi lên." };
  }

  const rules = uploadRulesFor(kind);
  const maxMb = Math.round(rules.maxBytes / 1024 / 1024);
  const typeLabel = kind === "bgm" ? "MP3/WAV/M4A" : "PNG/JPEG/WebP";

  for (const file of files) {
    if (!rules.mimes.includes(file.mimeType)) {
      return {
        ok: false,
        code: "ASSET_BAD_TYPE",
        message: `Chỉ nhận ${typeLabel} — file ${file.mimeType} bị từ chối.`,
      };
    }
    if (file.sizeBytes > rules.maxBytes) {
      return {
        ok: false,
        code: "ASSET_TOO_LARGE",
        message: `File vượt quá ${maxMb}MB (${(file.sizeBytes / 1024 / 1024).toFixed(1)}MB).`,
      };
    }
  }

  const limit = ASSET_LIMITS[kind];
  // watermark & bgm: 1 file, upload mới thay thế cũ
  if (kind === "watermark" || kind === "bgm") {
    if (files.length > 1) {
      return {
        ok: false,
        code: "ASSET_LIMIT",
        message: `${kind === "bgm" ? "Nhạc nền" : "Watermark"} chỉ nhận đúng 1 file.`,
      };
    }
    return { ok: true };
  }

  if (existingCount + files.length > limit) {
    const remaining = Math.max(0, limit - existingCount);
    return {
      ok: false,
      code: "ASSET_LIMIT",
      message: `Tối đa ${limit} ảnh cho mục này — còn ${remaining} slot trống.`,
    };
  }

  return { ok: true };
}
