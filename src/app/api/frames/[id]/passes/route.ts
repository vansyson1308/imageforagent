import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/services/apiError";
import { handleRoute, parseBody } from "@/lib/services/routeHelpers";
import { enforceRateLimit } from "@/lib/services/rateLimit";
import { renderFramePasses } from "@/lib/services/clipService";
import { CONTROL_PASSES } from "@/lib/services/motionRenderer";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const passesSchema = z.object({ passes: z.array(z.enum(CONTROL_PASSES)).min(1).max(4) });

/**
 * POST control passes cho shot motion của frame → chuỗi PNG depth /
 * segmentation / normal / pose (+ pose.json OpenPose) trong storage; export
 * ZIP gom vào passes/FNN/. Dùng làm điều kiện cho AI video (tuỳ chọn).
 */
export async function POST(req: Request, ctx: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    enforceRateLimit("frames:passes", 4);
    const { id } = await ctx.params;
    const body = await parseBody(req, passesSchema);
    const frame = await prisma.frame.findUnique({ where: { id } });
    if (!frame) throw new AppError("NOT_FOUND", "Không tìm thấy frame.");
    const project = await prisma.project.findUnique({ where: { id: frame.projectId }, include: { assets: true } });
    if (!project) throw new AppError("NOT_FOUND", "Không tìm thấy project.");
    const frames = await renderFramePasses(project, frame, body.passes);
    return Response.json({ ok: true, frames });
  });
}
