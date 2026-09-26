import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/services/apiError";
import { handleRoute } from "@/lib/services/routeHelpers";
import { enforceRateLimit } from "@/lib/services/rateLimit";
import { motionSpecSchema } from "@/lib/validation/motionSchema";
import { clearFrameMotion } from "@/lib/services/clipService";
import { writeFrameMotion } from "@/lib/services/frameWrites";
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
    putMotionSchema.parse(raw);
    const result = await writeFrameMotion(id, (raw as { motion: unknown }).motion);
    return Response.json({ ...withImageUrl(result.frame), stats: result.stats, warnings: result.warnings });
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
