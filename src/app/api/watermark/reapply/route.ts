import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/services/apiError";
import { handleRoute, parseBody } from "@/lib/services/routeHelpers";
import { enforceRateLimit } from "@/lib/services/rateLimit";
import { applyWatermark } from "@/lib/services/watermarker";
import { toPosix } from "@/lib/services/storage";

const reapplySchema = z.object({ projectId: z.string().min(10).max(64) });

/**
 * Áp dụng lại watermark trên toàn bộ ảnh gốc (không gọi provider — miễn phí).
 * Không có watermark asset → imagePath trỏ về ảnh gốc.
 */
export async function POST(req: Request): Promise<Response> {
  return handleRoute(async () => {
    enforceRateLimit("watermark:reapply", 5);
    const body = await parseBody(req, reapplySchema);

    const project = await prisma.project.findUnique({
      where: { id: body.projectId },
      include: {
        assets: { where: { kind: "watermark" } },
        frames: { where: { rawImagePath: { not: null } }, orderBy: { index: "asc" } },
      },
    });
    if (!project) throw new AppError("NOT_FOUND", "Không tìm thấy project.");

    const watermark = project.assets[0];
    let updated = 0;

    for (const frame of project.frames) {
      const rawRelPath = frame.rawImagePath!;
      let imageRelPath = rawRelPath;
      if (watermark) {
        imageRelPath = toPosix(`${project.id}/frames/${frame.id}.wm.png`);
        await applyWatermark(rawRelPath, imageRelPath, watermark.filePath, {
          position: project.wmPosition,
          scalePercent: project.wmScale,
          opacity: project.wmOpacity,
        });
      }
      await prisma.frame.update({
        where: { id: frame.id },
        // generatedAt mới để cache-bust ?v= trên imageUrl
        data: { imagePath: imageRelPath, generatedAt: new Date() },
      });
      updated++;
    }

    return Response.json({ ok: true, updated });
  });
}
