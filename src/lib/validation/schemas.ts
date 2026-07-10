import { z } from "zod";

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
    artworkDefs: z.string().max(512_000).nullable().optional(),
    aspectRatio: z.enum(ASPECT_RATIOS).optional(),
    resolution: z.enum(RESOLUTIONS).optional(),
    playbackSpeed: z.number().min(0.5).max(5).optional(),
    sheetUrl: z.string().trim().url().nullable().optional(),
    wmPosition: z.enum(WM_POSITIONS).optional(),
    wmScale: z.number().min(2).max(50).optional(),
    wmOpacity: z.number().min(0.05).max(1).optional(),
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
  })
  .strict()
  .refine((v) => v.shotType !== undefined || v.description !== undefined, {
    message: "Không có trường nào để cập nhật.",
  });

export const reorderSchema = z.object({
  projectId: id,
  frameId: id,
  targetIndex: z.number().int().min(1),
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

export const artworkSchema = z.object({
  svg: z.string().min(1, "SVG trống").max(512_000),
});

export const renderSchema = z.object({
  projectId: id,
  frameIds: z.array(id).max(100).optional(),
});

// Construct engine (POST /api/construct): schema ở constructSchema.ts —
// import TRỰC TIẾP từ đó, KHÔNG re-export tại đây (re-export tạo vòng
// import schemas ↔ constructSchema → TDZ crash dưới Turbopack).
