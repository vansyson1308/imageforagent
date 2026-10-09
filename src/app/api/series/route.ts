import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/services/apiError";
import { handleRoute, parseBody } from "@/lib/services/routeHelpers";
import { enforceRateLimit } from "@/lib/services/rateLimit";
import { demoConfig } from "@/lib/services/demoMode";
import { requireDemoSession } from "@/lib/services/demoGuard";
import { listSeries, saveSeries } from "@/lib/services/director/series";

const saveSchema = z.object({ runId: z.string().regex(/^[a-z0-9]{10,40}$/), name: z.string().trim().min(1).max(80) });

/** GET — saved series (in demo mode: this session's only). */
export async function GET(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const cfg = demoConfig();
    const sid = requireDemoSession(req, cfg);
    return Response.json({ series: await listSeries(sid, cfg.enabled) });
  });
}

/** POST {runId, name} — save a finished run's cast library, kits and voices as a series (WP5). */
export async function POST(req: Request): Promise<Response> {
  return handleRoute(async () => {
    enforceRateLimit("series:save", 6);
    const cfg = demoConfig();
    const sid = requireDemoSession(req, cfg);
    const body = await parseBody(req, saveSchema);
    const run = await prisma.directorRun.findUnique({ where: { id: body.runId }, select: { project: { select: { demoSession: true } } } });
    if (!run) throw new AppError("NOT_FOUND", "Run not found.");
    if (cfg.enabled && run.project.demoSession !== sid) throw new AppError("UNAUTHORIZED", "This run belongs to another session.");
    return Response.json(await saveSeries({ runId: body.runId, name: body.name, demoSession: sid }), { status: 201 });
  });
}
