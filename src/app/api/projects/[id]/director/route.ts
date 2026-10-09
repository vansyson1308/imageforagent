import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/services/apiError";
import { handleRoute, parseBody } from "@/lib/services/routeHelpers";
import { enforceRateLimit } from "@/lib/services/rateLimit";
import { demoConfig } from "@/lib/services/demoMode";
import { cleanupDemoProjects, dailyGate, requireDemoSession } from "@/lib/services/demoGuard";
import { directorDeps } from "@/lib/services/director/deps";
import { createRun, isRunLive } from "@/lib/services/director/loop";
import { reapOrphanRuns, runEventStream, SSE_HEADERS, startDetachedRun } from "@/lib/services/director/runHub";
import { STYLE_PRESETS } from "@/lib/services/director/prompts";
import { loadSeries } from "@/lib/services/director/series";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// A film takes minutes: allow long-lived streaming responses where the host honours it.
export const maxDuration = 1800;

const directorRequestSchema = z.object({
  story: z.string().trim().min(20, "Tell a story of at least 20 characters.").max(6000),
  language: z.string().regex(/^[a-z]{2,3}$/).default("en"),
  style: z.enum(Object.keys(STYLE_PRESETS) as [string, ...string[]]).default("storybook"),
  critic: z.boolean().default(true),
  /** true = always, "auto" = Nano decides from the story (both need TAVILY_API_KEY), false = never */
  research: z.union([z.boolean(), z.literal("auto")]).default(false),
  maxShots: z.number().int().min(2).max(24).optional(),
  maxUsd: z.number().positive().max(10).optional(),
  /** Eval baseline: "super-only" runs every role on the Super tier with no critic. */
  profile: z.enum(["crew", "super-only"]).default("crew"),
  /** WP5: make this film an episode of a saved series. */
  seriesId: z.string().regex(/^[a-z0-9]{10,40}$/).nullish(),
});

/**
 * POST — start the Nemotron crew on this project and stream progress as
 * Server-Sent Events (event names: run, status, research, plan, step,
 * frame, error, done). The run executes server-side, detached from this
 * request (D26): closing the stream only stops listening. Reconnect with
 * `GET …/runs/:runId/events`; cancel with `POST …/runs/:runId/cancel`.
 */
export async function POST(req: Request, ctx: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    enforceRateLimit("director:start", 3);
    const { id } = await ctx.params;
    const cfg = demoConfig();
    const sid = requireDemoSession(req, cfg);
    const body = await parseBody(req, directorRequestSchema);
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) throw new AppError("NOT_FOUND", "Không tìm thấy project.");
    if (cfg.enabled && project.demoSession !== sid) throw new AppError("UNAUTHORIZED", "This demo project belongs to another session.");

    await reapOrphanRuns();
    const running = await prisma.directorRun.findMany({ where: { status: "running" }, select: { id: true, projectId: true } });
    const live = running.filter((r) => isRunLive(r.id));
    if (live.some((r) => r.projectId === id)) throw new AppError("CONFLICT", "A Director run is already in progress on this project.", "Wait for it to finish or cancel it.");
    if (cfg.enabled && live.length >= cfg.maxConcurrentRuns) throw new AppError("QUOTA_EXCEEDED", "The demo server is busy with other films.", "Try again in a few minutes, or watch the showcase.");

    const crew = await directorDeps();
    const deps =
      body.profile === "super-only"
        ? { ...crew, models: { strong: crew.models.mid, mid: crew.models.mid, fast: crew.models.mid, vision: "" }, visionAvailable: false }
        : crew;
    let gate: Awaited<ReturnType<typeof dailyGate>> | null = null;
    if (cfg.enabled) {
      await cleanupDemoProjects(cfg);
      gate = await dailyGate(cfg);
    }
    const runDeps = { ...deps, ...(gate && { externalGate: gate.gate, onSpend: gate.spend }) };
    const series = body.seriesId ? await loadSeries(body.seriesId, sid, cfg.enabled) : null;
    const { seriesId: _ignored, ...rest } = body;
    void _ignored;
    const request = { projectId: id, ...rest, series, critic: body.profile === "super-only" ? false : body.critic };
    const { runId, budget } = await createRun(request, runDeps);
    startDetachedRun(runId, request, runDeps, budget);
    return new Response(runEventStream(runId, { replay: true }), { headers: { ...SSE_HEADERS, "X-Director-Run": runId } });
  });
}

/** GET — this project's runs (newest first). */
export async function GET(req: Request, ctx: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    const { id } = await ctx.params;
    requireDemoSession(req);
    await reapOrphanRuns();
    const runs = await prisma.directorRun.findMany({
      where: { projectId: id },
      orderBy: { startedAt: "desc" },
      select: { id: true, status: true, provider: true, language: true, style: true, tokensIn: true, tokensOut: true, costUsd: true, startedAt: true, finishedAt: true, summary: true },
    });
    return Response.json({ runs: runs.map((r) => ({ ...r, summary: r.summary ? JSON.parse(r.summary) : null, live: isRunLive(r.id) })) });
  });
}
