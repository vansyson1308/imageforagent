import { prisma } from "@/lib/db";
import { handleRoute } from "@/lib/services/routeHelpers";
import { getJob } from "@/lib/services/jobRunner";
import { withImageUrl } from "@/lib/services/dto";

interface RouteContext {
  params: Promise<{ jobId: string }>;
}

/**
 * Poll trạng thái job (2s/lần từ FE). Nếu job mất khỏi bộ nhớ (server restart)
 * → done=true + lost=true, FE hydrate lại project.
 */
export async function GET(_req: Request, ctx: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    const { jobId } = await ctx.params;
    const job = getJob(jobId);

    if (!job) {
      return Response.json({ jobId, frames: [], done: true, lost: true });
    }

    const frames = await prisma.frame.findMany({
      where: { id: { in: [...job.frameIds] } },
      orderBy: { index: "asc" },
      select: {
        id: true,
        index: true,
        status: true,
        imagePath: true,
        errorMsg: true,
        generatedAt: true,
      },
    });

    return Response.json({
      jobId,
      frames: frames.map((f) => {
        const dto = withImageUrl(f);
        return {
          id: dto.id,
          index: dto.index,
          status: dto.status,
          imageUrl: dto.imageUrl,
          errorMsg: dto.errorMsg,
        };
      }),
      done: !job.running,
      cancelled: job.cancelled,
    });
  });
}
