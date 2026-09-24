import { handleRoute, parseBody } from "@/lib/services/routeHelpers";
import { enforceRateLimit } from "@/lib/services/rateLimit";
import { motionRequestSchema } from "@/lib/validation/motionSchema";
import { encodeAnimatedWebp, encodeContactSheet, renderMotionClip } from "@/lib/services/motionRenderer";

/**
 * POST /api/motion — motion compiler STATELESS: scene construct + tracks +
 * rigs → một shot hoạt hình. Không lưu DB (lưu vào frame qua
 * PUT /api/frames/:id/motion).
 *
 * Mặc định trả `contactSheetPng` (lưới frame lấy mẫu đều + thanh thời gian)
 * — agent NHÌN chuyển động trong một ảnh; `preview.webp` thêm animated
 * WebP; `preview.includeSvg` trả SVG từng frame để tự lắp ráp.
 */
export async function POST(req: Request): Promise<Response> {
  return handleRoute(async () => {
    enforceRateLimit("motion:compile", 6);
    const body = await parseBody(req, motionRequestSchema);
    const preview = body.preview ?? {
      aspectRatio: "16:9" as const,
      resolution: "1K" as const,
      sheet: true,
      sheetFrames: 12,
      webp: false,
      includeSvg: false,
    };

    const result = await renderMotionClip({
      motion: body.motion,
      ctx: { shotType: body.shotType },
      defs: null,
      aspectRatio: preview.aspectRatio,
      resolution: preview.resolution,
    });
    const pngs = result.frames.map((f) => f.png);

    const [sheet, webp] = await Promise.all([
      preview.sheet
        ? encodeContactSheet(pngs, preview.sheetFrames, result.frames.map((f) => f.t), body.motion.duration)
        : Promise.resolve(null),
      preview.webp ? encodeAnimatedWebp(pngs, body.motion.fps) : Promise.resolve(null),
    ]);

    return Response.json({
      stats: result.stats,
      warnings: result.warnings,
      posterPng: `data:image/png;base64,${result.posterPng.toString("base64")}`,
      ...(sheet && { contactSheetPng: `data:image/png;base64,${sheet.toString("base64")}` }),
      ...(webp && { clipWebp: `data:image/webp;base64,${webp.toString("base64")}` }),
      ...(preview.includeSvg && {
        frames: result.frames.map((f) => ({ index: f.index, t: f.t, svg: f.constructSvg })),
      }),
    });
  });
}
