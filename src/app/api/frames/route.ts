import { prisma } from "@/lib/db";
import { AppError } from "@/lib/services/apiError";
import { handleRoute, parseBody } from "@/lib/services/routeHelpers";
import { enforceRateLimit } from "@/lib/services/rateLimit";
import { createFrameSchema } from "@/lib/validation/schemas";
import { MAX_FRAMES_PER_PROJECT } from "@/lib/config/limits";
import { withImageUrl } from "@/lib/services/dto";

/** Thêm frame mới — cuối danh sách hoặc chèn sau afterIndex (0 = đầu). */
export async function POST(req: Request): Promise<Response> {
  return handleRoute(async () => {
    enforceRateLimit("frames:create");
    const body = await parseBody(req, createFrameSchema);

    const project = await prisma.project.findUnique({
      where: { id: body.projectId },
      include: { _count: { select: { frames: true } } },
    });
    if (!project) throw new AppError("NOT_FOUND", "Không tìm thấy project.");
    if (project._count.frames >= MAX_FRAMES_PER_PROJECT) {
      throw new AppError("VALIDATION", `Tối đa ${MAX_FRAMES_PER_PROJECT} frame/project.`);
    }

    const total = project._count.frames;
    const insertAt =
      body.afterIndex === undefined
        ? total + 1
        : Math.min(Math.max(body.afterIndex, 0), total) + 1;

    const frame = await prisma.$transaction(async (tx) => {
      // Dồn các frame từ vị trí chèn trở đi lên 1 (đi từ cuối để né unique constraint)
      const toShift = await tx.frame.findMany({
        where: { projectId: body.projectId, index: { gte: insertAt } },
        orderBy: { index: "desc" },
        select: { id: true, index: true },
      });
      for (const f of toShift) {
        await tx.frame.update({ where: { id: f.id }, data: { index: f.index + 1 } });
      }
      return tx.frame.create({
        data: {
          projectId: body.projectId,
          index: insertAt,
          shotType: "Static shot",
          description: "",
        },
      });
    });

    return Response.json(withImageUrl(frame), { status: 201 });
  });
}
