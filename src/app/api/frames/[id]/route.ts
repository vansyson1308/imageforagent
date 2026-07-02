import { prisma } from "@/lib/db";
import { AppError } from "@/lib/services/apiError";
import { handleRoute, parseBody } from "@/lib/services/routeHelpers";
import { enforceRateLimit } from "@/lib/services/rateLimit";
import { patchFrameSchema } from "@/lib/validation/schemas";
import { computeReindexAfterDelete } from "@/lib/services/frameService";
import { applyIndexUpdates } from "@/lib/services/frameDb";
import { removeQuiet } from "@/lib/services/storage";
import { withImageUrl } from "@/lib/services/dto";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: Request, ctx: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    enforceRateLimit("frames:patch", 60);
    const { id } = await ctx.params;
    const body = await parseBody(req, patchFrameSchema);
    const existing = await prisma.frame.findUnique({ where: { id } });
    if (!existing) throw new AppError("NOT_FOUND", "Không tìm thấy frame.");
    const frame = await prisma.frame.update({ where: { id }, data: body });
    return Response.json(withImageUrl(frame));
  });
}

export async function DELETE(_req: Request, ctx: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    enforceRateLimit("frames:delete");
    const { id } = await ctx.params;
    const existing = await prisma.frame.findUnique({ where: { id } });
    if (!existing) throw new AppError("NOT_FOUND", "Không tìm thấy frame.");

    await prisma.$transaction(async (tx) => {
      await tx.frame.delete({ where: { id } });
      const remaining = await tx.frame.findMany({
        where: { projectId: existing.projectId },
        select: { id: true, index: true },
      });
      await applyIndexUpdates(tx, computeReindexAfterDelete(remaining));
    });

    // Dọn file ảnh của frame đã xoá
    if (existing.imagePath) await removeQuiet(existing.imagePath);
    if (existing.rawImagePath) await removeQuiet(existing.rawImagePath);

    return Response.json({ ok: true });
  });
}
