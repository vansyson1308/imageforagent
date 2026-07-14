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

/**
 * Trần cho construct compiler (POST /api/construct) — compile chạy sync
 * trên event loop nên mọi chiều input/output đều phải chặn cứng.
 * Vi phạm → CONSTRUCTION_INVALID kèm hint nói rõ knob cần giảm.
 */
export const CONSTRUCT_LIMITS = {
  /** Tổng shapes + solids + cutouts trong một spec. */
  maxNodes: 256,
  /** Độ sâu chuỗi ref boolean (boolean của boolean…). */
  maxOpDepth: 16,
  /** Số operand mỗi phép boolean. */
  maxBooleanOperands: 32,
  /** Số segment tối đa mỗi primitive cong (cylinder/sphere/cone…). */
  maxSegments: 64,
  /** Mặc định segment cho primitive cong. */
  defaultSegments: 24,
  /** Tổng số mặt sau tessellation toàn scene. */
  maxTotalFaces: 5_000,
  /** Tổng segment đầu vào mỗi phép boolean (path-bool worst case). */
  maxBooleanInputSegments: 2_500,
  /** Trần byte SVG compile ra — dưới MAX_SVG_BYTES để agent còn ghép thêm. */
  maxOutputBytes: 400_000,
  /** Trần số lệnh path trong output. */
  maxPathCommandsOut: 20_000,
  /** |toạ độ / kích thước| tối đa. */
  maxCoord: 100_000,
  /** Guard wall-clock giữa các stage compile (ms). */
  maxCompileMs: 2_000,
  /** Số node CSG (solid type "csg") mỗi spec. */
  maxCsgOps: 8,
  /** Tổng mặt đầu vào mỗi phép CSG (sau tam giác hoá). */
  maxCsgOperandFaces: 2_000,
  /** Budget cắt của depth sort exact — cạn thì rơi về painter + warning. */
  maxDepthSplits: 2_000,
  /** Tổng gradient mỗi fragment (smooth + shadow + per-face). */
  maxGradients: 128,
  /** Số group (khung FK) mỗi spec. */
  maxGroups: 32,
  /** Độ sâu chuỗi parent group. */
  maxGroupDepth: 8,
  /** Số part macro mỗi spec. */
  maxParts: 16,
  /** Gradient tác giả khai trong spec.gradients (đếm vào maxGradients). */
  maxUserGradients: 32,
  /** Tổng filter blur mỗi fragment (shadow.blur + glow blur) — blur ĐẮT. */
  maxFilters: 6,
  /** Tổng PathItem sinh bởi effects layer (crescents/glow/contact). */
  maxEffectPaths: 96,
} as const;

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
