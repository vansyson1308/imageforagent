import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/services/apiError";
import { handleRoute } from "@/lib/services/routeHelpers";
import { enforceRateLimit } from "@/lib/services/rateLimit";
import { motionSpecSchema } from "@/lib/validation/motionSchema";
import { sanitizeSvg } from "@/lib/services/svgRenderer";
import { clearFrameMotion, renderFrameMotion } from "@/lib/services/clipService";
import { withImageUrl } from "@/lib/services/dto";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const putMotionSchema = z.object({ motion: motionSpecSchema });

/**
 * PUT motion spec cho 1 frame → frame trở thành SHOT hoạt hình: render sync
 * chuỗi PNG + WebP; poster frame thành ảnh tĩnh storyboard. Render lỗi: VẪN
 * LƯU motionSpec + status failed (agent không mất WIP), trả lỗi kèm hint.
 */
export async function PUT(req: Request, ctx: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    enforceRateLimit("frames:motion", 6);
    const { id } = await ctx.params;
    // Lưu JSON THÔ agent gửi (round-trip nguyên vẹn), validate bằng schema
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new AppError("VALIDATION", "Body không phải JSON hợp lệ.");
    }
    const body = putMotionSchema.parse(raw);
    const rawMotion = (raw as { motion: unknown }).motion;

    const frame = await prisma.frame.findUnique({ where: { id } });
    if (!frame) throw new AppError("NOT_FOUND", "Không tìm thấy frame.");
    const project = await prisma.project.findUnique({
      where: { id: frame.projectId },
      include: { assets: true },
    });
    if (!project) throw new AppError("NOT_FOUND", "Không tìm thấy project.");

    // Reject layer tĩnh không an toàn TRƯỚC khi lưu
    if (body.motion.backdrop) sanitizeSvg(body.motion.backdrop, "frame");
    if (body.motion.overlay) sanitizeSvg(body.motion.overlay, "frame");

    const saved = await prisma.frame.update({
      where: { id },
      data: { motionSpec: JSON.stringify(rawMotion) },
    });

    let result;
    try {
      result = await renderFrameMotion(project, saved);
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
        .update({ where: { id }, data: { status: "failed", errorMsg: message } })
        .catch(() => {});
      throw err;
    }

    const fresh = await prisma.frame.findUnique({ where: { id } });
    if (!fresh) throw new AppError("NOT_FOUND", "Frame đã bị xoá trong lúc render.");
    return Response.json({ ...withImageUrl(fresh), stats: result.stats, warnings: result.warnings });
  });
}

/** Gỡ motion: frame trở lại ảnh tĩnh (giữ poster), xoá file clip. */
export async function DELETE(_req: Request, ctx: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    enforceRateLimit("frames:motion");
    const { id } = await ctx.params;
    const frame = await prisma.frame.findUnique({ where: { id } });
    if (!frame) throw new AppError("NOT_FOUND", "Không tìm thấy frame.");
    await clearFrameMotion(frame.projectId, id);
    const fresh = await prisma.frame.findUnique({ where: { id } });
    return Response.json(withImageUrl(fresh!));
  });
}
