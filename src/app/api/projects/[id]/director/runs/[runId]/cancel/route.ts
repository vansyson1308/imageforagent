import { prisma } from "@/lib/db";
import { AppError } from "@/lib/services/apiError";
import { handleRoute } from "@/lib/services/routeHelpers";
import { enforceRateLimit } from "@/lib/services/rateLimit";
import { requireDemoSession } from "@/lib/services/demoGuard";
import { cancelRun } from "@/lib/services/director/loop";

interface RouteContext {
  params: Promise<{ id: string; runId: string }>;
}

/**
 * POST — cancel a live run. The loop stops at its next checkpoint and
 * records status "cancelled". A run whose process died (not live) is marked
 * cancelled directly.
 */
export async function POST(req: Request, ctx: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    enforceRateLimit("director:cancel", 10);
    const { id, runId } = await ctx.params;
    requireDemoSession(req);
    const run = await prisma.directorRun.findUnique({ where: { id: runId } });
    if (!run || run.projectId !== id) throw new AppError("NOT_FOUND", "Run not found.");
    if (run.status !== "running") return Response.json({ ok: true, status: run.status });
    const signalled = cancelRun(runId);
    if (!signalled) await prisma.directorRun.update({ where: { id: runId }, data: { status: "cancelled", finishedAt: new Date(), error: "process ended before the run finished" } });
    return Response.json({ ok: true, status: signalled ? "cancelling" : "cancelled" });
  });
}
