import { prisma } from "@/lib/db";
import { AppError } from "@/lib/services/apiError";
import { handleRoute, parseBody } from "@/lib/services/routeHelpers";
import { enforceRateLimit } from "@/lib/services/rateLimit";
import { reorderSchema } from "@/lib/validation/schemas";
import { computeReorder } from "@/lib/services/frameService";
import { applyIndexUpdates } from "@/lib/services/frameDb";
import { withImageUrl } from "@/lib/services/dto";

export async function POST(req: Request): Promise<Response> {
  return handleRoute(async () => {
    enforceRateLimit("frames:reorder");
    const body = await parseBody(req, reorderSchema);

    const frames = await prisma.frame.findMany({
      where: { projectId: body.projectId },
      select: { id: true, index: true },
    });
    if (frames.length === 0) throw new AppError("NOT_FOUND", "Project chưa có frame.");

    const updates = computeReorder(frames, body.frameId, body.targetIndex);
    if (!updates) throw new AppError("NOT_FOUND", "Không tìm thấy frame cần di chuyển.");

    await prisma.$transaction(async (tx) => {
      await applyIndexUpdates(tx, updates);
    });

    const result = await prisma.frame.findMany({
      where: { projectId: body.projectId },
      orderBy: { index: "asc" },
    });
    return Response.json({ frames: result.map(withImageUrl) });
  });
}
