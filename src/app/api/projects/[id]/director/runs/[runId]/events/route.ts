import { prisma } from "@/lib/db";
import { AppError } from "@/lib/services/apiError";
import { handleRoute } from "@/lib/services/routeHelpers";
import { enforceRateLimit } from "@/lib/services/rateLimit";
import { demoConfig } from "@/lib/services/demoMode";
import { requireDemoSession } from "@/lib/services/demoGuard";
import { runEventStream, SSE_HEADERS } from "@/lib/services/director/runHub";

interface RouteContext {
  params: Promise<{ id: string; runId: string }>;
}

export const maxDuration = 1800;

/**
 * GET — (re)attach to a run (D26). Replays the persisted trace (run, plan,
 * every step, the frames rendered so far), then tails the live events until
 * `done`. Works for finished runs too (pure replay). Closing it never
 * cancels the run.
 */
export async function GET(req: Request, ctx: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    enforceRateLimit("director:events", 30);
    const { id, runId } = await ctx.params;
    const cfg = demoConfig();
    const sid = requireDemoSession(req, cfg);
    const run = await prisma.directorRun.findUnique({ where: { id: runId }, select: { projectId: true, project: { select: { demoSession: true } } } });
    if (!run || run.projectId !== id) throw new AppError("NOT_FOUND", "Run not found.");
    if (cfg.enabled && run.project.demoSession !== sid) throw new AppError("UNAUTHORIZED", "This demo project belongs to another session.");
    return new Response(runEventStream(runId, { replay: true }), { headers: { ...SSE_HEADERS, "X-Director-Run": runId } });
  });
}
