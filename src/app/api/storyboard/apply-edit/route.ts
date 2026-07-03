import { prisma } from "@/lib/db";
import { AppError } from "@/lib/services/apiError";
import { handleRoute, parseBody } from "@/lib/services/routeHelpers";
import { enforceRateLimit } from "@/lib/services/rateLimit";
import { applyEditSchema } from "@/lib/validation/schemas";
import { withImageUrl } from "@/lib/services/dto";
import { assertNoRunningJob } from "@/lib/services/jobRunner";

/**
 * Ghi bản kịch bản đã duyệt (từ diff-review AI edit) — thay toàn bộ frame
 * trong transaction. Frame giữ nguyên description+shotType cũ sẽ giữ ảnh
 * đã generate; frame đổi nội dung reset về draft.
 */
export async function POST(req: Request): Promise<Response> {
  return handleRoute(async () => {
    enforceRateLimit("storyboard:apply-edit", 10);
    const body = await parseBody(req, applyEditSchema);
    assertNoRunningJob(body.projectId);

    const project = await prisma.project.findUnique({
      where: { id: body.projectId },
      include: { frames: { orderBy: { index: "asc" } } },
    });
    if (!project) throw new AppError("NOT_FOUND", "Không tìm thấy project.");

    // Map nội dung cũ theo index để giữ ảnh cho frame không đổi
    const oldByIndex = new Map(project.frames.map((f) => [f.index, f]));

    const frames = await prisma.$transaction(async (tx) => {
      await tx.frame.deleteMany({ where: { projectId: body.projectId } });
      for (const f of body.frames) {
        const old = oldByIndex.get(f.index);
        const unchanged =
          old !== undefined &&
          old.shotType === f.shotType &&
          old.description === f.description;
        await tx.frame.create({
          data: {
            projectId: body.projectId,
            index: f.index,
            shotType: f.shotType,
            description: f.description,
            status: unchanged ? old.status : "draft",
            imagePath: unchanged ? old.imagePath : null,
            rawImagePath: unchanged ? old.rawImagePath : null,
            generatedAt: unchanged ? old.generatedAt : null,
          },
        });
      }
      return tx.frame.findMany({
        where: { projectId: body.projectId },
        orderBy: { index: "asc" },
      });
    });

    return Response.json({ frames: frames.map(withImageUrl) });
  });
}
