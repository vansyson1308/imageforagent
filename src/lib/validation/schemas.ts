import { z } from "zod";
import {
  CLIP_DURATIONS,
  TRANSITION_TYPES,
  VIDEO_RESOLUTIONS,
  VIDEO_TIERS,
} from "@/lib/config/video";

export const ASPECT_RATIOS = ["16:9", "9:16", "1:1", "4:5"] as const;
export const RESOLUTIONS = ["1K", "2K"] as const;
export const WM_POSITIONS = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
  "center",
] as const;

const id = z.string().min(10).max(64);

export const createProjectSchema = z.object({
  name: z.string().trim().min(1, "Tên project không được trống").max(120),
});

export const patchProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    characterDesc: z.string().max(2000).nullable().optional(),
    aspectRatio: z.enum(ASPECT_RATIOS).optional(),
    resolution: z.enum(RESOLUTIONS).optional(),
    playbackSpeed: z.number().min(0.5).max(5).optional(),
    sheetUrl: z.string().trim().url().nullable().optional(),
    wmPosition: z.enum(WM_POSITIONS).optional(),
    wmScale: z.number().min(2).max(50).optional(),
    wmOpacity: z.number().min(0.05).max(1).optional(),
    // Phase 9: video settings
    videoTier: z.enum(VIDEO_TIERS).optional(),
    clipDurationSec: z
      .number()
      .int()
      .refine((v) => CLIP_DURATIONS.includes(v as 4 | 6 | 8), "Chỉ nhận 4/6/8 giây")
      .optional(),
    videoResolution: z.enum(VIDEO_RESOLUTIONS).optional(),
    transitionType: z.enum(TRANSITION_TYPES).optional(),
    transitionSec: z.number().min(0.2).max(1).optional(),
    captionsBurnIn: z.boolean().optional(),
    colorPolish: z.boolean().optional(),
    bgmEnabled: z.boolean().optional(),
    bgmVolumeDb: z.number().min(-30).max(0).optional(),
    voiceoverEnabled: z.boolean().optional(),
    nativeAudioEnabled: z.boolean().optional(),
  })
  .strict();

export const importScriptSchema = z
  .object({
    projectId: id,
    source: z.enum(["sheet", "tsv"]),
    sheetUrl: z.string().trim().url().optional(),
    tsvText: z.string().max(500_000).optional(),
    confirmOverwrite: z.boolean().optional(),
  })
  .refine((v) => (v.source === "sheet" ? !!v.sheetUrl : !!v.tsvText?.trim()), {
    message: "Thiếu sheetUrl (source=sheet) hoặc tsvText (source=tsv).",
  });

export const createFrameSchema = z.object({
  projectId: id,
  /** Chèn sau index này (0 = đầu danh sách). Bỏ trống = thêm cuối. */
  afterIndex: z.number().int().min(0).optional(),
});

export const patchFrameSchema = z
  .object({
    shotType: z.string().trim().max(120).optional(),
    description: z.string().max(2000).optional(),
    voiceoverText: z.string().max(1000).nullable().optional(),
    interpToNext: z.boolean().optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.shotType !== undefined ||
      v.description !== undefined ||
      v.voiceoverText !== undefined ||
      v.interpToNext !== undefined,
    { message: "Không có trường nào để cập nhật." },
  );

export const reorderSchema = z.object({
  projectId: id,
  frameId: id,
  targetIndex: z.number().int().min(1),
});

export const aiEditSchema = z.object({
  projectId: id,
  instruction: z.string().trim().min(3, "Yêu cầu quá ngắn").max(500),
});

export const applyEditSchema = z.object({
  projectId: id,
  frames: z
    .array(
      z.object({
        index: z.number().int().min(1),
        shotType: z.string().trim().min(1).max(120),
        description: z.string().trim().min(1).max(2000),
      }),
    )
    .min(1)
    .max(100),
});

export const generateSchema = z.object({
  projectId: id,
  frameIds: z.array(id).max(100).optional(),
});

// ---------- Phase 9: video ----------

export const videoClipsSchema = z.object({
  projectId: id,
  tier: z.enum(VIDEO_TIERS),
  /** Rỗng = tất cả frame done. */
  frameIds: z.array(id).max(100).optional(),
  /** true → chỉ trả estimate chi phí, không chạy. */
  dryRun: z.boolean().optional(),
});

export const assembleSchema = z.object({
  projectId: id,
});

export const voiceoverDraftSchema = z.object({
  projectId: id,
  /** Gợi ý phong cách lời thuyết minh (tuỳ chọn). */
  instruction: z.string().trim().max(300).optional(),
});

export const voiceoverPreviewSchema = z.object({
  frameId: id,
});
