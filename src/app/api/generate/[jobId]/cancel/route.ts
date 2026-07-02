import { handleRoute } from "@/lib/services/routeHelpers";
import { enforceRateLimit } from "@/lib/services/rateLimit";
import { AppError } from "@/lib/services/apiError";
import { cancelJob } from "@/lib/services/jobRunner";

interface RouteContext {
  params: Promise<{ jobId: string }>;
}

/** Dừng job: frame chưa bắt đầu quay về draft, frame đang chạy được chạy nốt. */
export async function POST(_req: Request, ctx: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    enforceRateLimit("generate:cancel", 10);
    const { jobId } = await ctx.params;
    const found = cancelJob(jobId);
    if (!found) {
      throw new AppError("NOT_FOUND", "Job không tồn tại hoặc đã kết thúc.");
    }
    return Response.json({ ok: true });
  });
}
