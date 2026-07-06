import { prisma } from "@/lib/db";
import { AppError } from "@/lib/services/apiError";
import { handleRoute, parseBody } from "@/lib/services/routeHelpers";
import { enforceRateLimit } from "@/lib/services/rateLimit";
import { renderSchema } from "@/lib/validation/schemas";
import { renderFrameArtwork } from "@/lib/services/artworkService";
import { logger } from "@/lib/services/logger";

/**
 * Re-render sync toàn bộ frame có artwork (dùng sau khi đổi artworkDefs
 * hoặc ratio/resolution). ~20–50ms/frame, trần 100 frame/project → ≤15s.
 * Lỗi per-frame không chặn các frame còn lại.
 */
export async function POST(req: Request): Promise<Response> {
  return handleRoute(async () => {
    enforceRateLimit("render:batch", 5);
    const body = await parseBody(req, renderSchema);

    const project = await prisma.project.findUnique({
      where: { id: body.projectId },
      include: { assets: true, frames: { orderBy: { index: "asc" } } },
    });
    if (!project) throw new AppError("NOT_FOUND", "Không tìm thấy project.");

    const targets = project.frames.filter(
      (f) =>
        f.artworkSvg !== null &&
        (!body.frameIds || body.frameIds.length === 0 || body.frameIds.includes(f.id)),
    );
    if (targets.length === 0) {
      throw new AppError(
        "VALIDATION",
        "Chưa có frame nào có artwork để render.",
        "PUT /api/frames/:id/artwork với body {svg} trước.",
      );
    }

    let rendered = 0;
    const failed: Array<{ frameId: string; index: number; message: string }> = [];

    for (const frame of targets) {
      try {
        await renderFrameArtwork(project, frame);
        rendered++;
      } catch (err: unknown) {
        const message =
          err instanceof AppError
            ? err.hint
              ? `${err.message} — ${err.hint}`
              : err.message
            : err instanceof Error
              ? err.message
              : "Render lỗi.";
        await prisma.frame
          .update({
            where: { id: frame.id },
            data: { status: "failed", errorMsg: message },
          })
          .catch(() => {});
        failed.push({ frameId: frame.id, index: frame.index, message });
        logger.warn({ frameId: frame.id, message }, "batch render: frame failed");
      }
    }

    return Response.json({ ok: failed.length === 0, rendered, failed });
  });
}
