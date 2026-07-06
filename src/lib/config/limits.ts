export const ASSET_LIMITS = {
  watermark: 1,
} as const;

export type AssetKind = keyof typeof ASSET_LIMITS;

export const ALLOWED_IMAGE_MIME_TYPES: readonly string[] = [
  "image/png",
  "image/jpeg",
  "image/webp",
];

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8MB/file

/** Trần kích thước mỗi phần SVG (defs của project / artwork của frame). */
export const MAX_SVG_BYTES = 512_000;
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
 * Validate một đợt upload. Watermark là kind duy nhất: thay thế cái cũ
 * (existingCount không chặn) nhưng mỗi đợt chỉ được đúng 1 file.
 */
export function validateAssetUpload(
  _kind: AssetKind,
  _existingCount: number,
  files: readonly UploadCandidate[],
): UploadValidation {
  if (files.length === 0) {
    return { ok: false, code: "ASSET_LIMIT", message: "Không có file nào được gửi lên." };
  }

  for (const file of files) {
    if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.mimeType)) {
      return {
        ok: false,
        code: "ASSET_BAD_TYPE",
        message: `Chỉ nhận PNG/JPEG/WebP — file ${file.mimeType} bị từ chối.`,
      };
    }
    if (file.sizeBytes > MAX_UPLOAD_BYTES) {
      return {
        ok: false,
        code: "ASSET_TOO_LARGE",
        message: `File vượt quá 8MB (${(file.sizeBytes / 1024 / 1024).toFixed(1)}MB).`,
      };
    }
  }

  if (files.length > 1) {
    return { ok: false, code: "ASSET_LIMIT", message: "Watermark chỉ nhận đúng 1 file." };
  }

  return { ok: true };
}
