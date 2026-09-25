import { prisma } from "@/lib/db";
import { AppError } from "@/lib/services/apiError";
import { handleRoute } from "@/lib/services/routeHelpers";
import { requireDemoSession } from "@/lib/services/demoGuard";
import { isRunLive } from "@/lib/services/director/loop";

interface RouteContext {
  params: Promise<{ id: string; runId: string }>;
}

/** GET — the persisted trace of a run: config, Bible, every step (with snapshot URLs), summary. */
export async function GET(req: Request, ctx: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    const { id, runId } = await ctx.params;
    requireDemoSession(req);
    const run = await prisma.directorRun.findUnique({ where: { id: runId }, include: { steps: { orderBy: { seq: "asc" } } } });
    if (!run || run.projectId !== id) throw new AppError("NOT_FOUND", "Run not found.");
    const parse = (s: string | null) => (s ? (JSON.parse(s) as unknown) : null);
    return Response.json({
      ...run,
      models: parse(run.models),
      config: parse(run.config),
      bible: parse(run.bible),
      summary: parse(run.summary),
      live: isRunLive(run.id),
      steps: run.steps.map((s) => ({ ...s, imageUrl: s.imagePath ? `/api/files/${s.imagePath}` : null })),
    });
  });
}
