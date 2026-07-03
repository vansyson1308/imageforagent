import { prisma } from "@/lib/db";
import { AppError } from "@/lib/services/apiError";
import { handleRoute, parseBody } from "@/lib/services/routeHelpers";
import { enforceRateLimit } from "@/lib/services/rateLimit";
import { reorderSchema } from "@/lib/validation/schemas";
import { computeReorder } from "@/lib/services/frameService";
import { applyIndexUpdates } from "@/lib/services/frameDb";
import { withImageUrl } from "@/lib/services/dto";
import { assertNoRunningJob } from "@/lib/services/jobRunner";

export async function POST(req: Request): Promise<Response> {
  return handleRoute(async () => {
    enforceRateLimit("frames:reorder");
    const body = await parseBody(req, reorderSchema);
    assertNoRunningJob(body.projectId);

    // Đọc + tính + ghi trong CÙNG transaction — hai reorder liên tiếp
    // không được tính toán trên snapshot cũ của nhau
    await prisma.$transaction(async (tx) => {
      const frames = await tx.frame.findMany({
        where: { projectId: body.projectId },
        select: { id: true, index: true },
      });
      if (frames.length === 0) throw new AppError("NOT_FOUND", "Project chưa có frame.");

      const updates = computeReorder(frames, body.frameId, body.targetIndex);
      if (!updates) throw new AppError("NOT_FOUND", "Không tìm thấy frame cần di chuyển.");

      await applyIndexUpdates(tx, updates);
    });

    const result = await prisma.frame.findMany({
      where: { projectId: body.projectId },
      orderBy: { index: "asc" },
    });
    return Response.json({ frames: result.map(withImageUrl) });
  });
}
