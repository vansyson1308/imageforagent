import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/services/apiError";
import { handleRoute, parseBody } from "@/lib/services/routeHelpers";
import { enforceRateLimit } from "@/lib/services/rateLimit";
import { demoConfig } from "@/lib/services/demoMode";
import { cleanupDemoProjects, dailyGate, requireDemoSession } from "@/lib/services/demoGuard";
import { directorDeps } from "@/lib/services/director/deps";
import { createRun, executeRun, registerRun, unregisterRun, isRunLive } from "@/lib/services/director/loop";
import { STYLE_PRESETS } from "@/lib/services/director/prompts";
import type { DirectorEvent } from "@/lib/services/director/context";

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
  research: z.boolean().default(false),
  maxShots: z.number().int().min(2).max(24).optional(),
  maxUsd: z.number().positive().max(10).optional(),
});

const enc = new TextEncoder();
const sse = (e: DirectorEvent) => enc.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);

/**
 * POST — run the Nemotron crew on this project and stream progress as
 * Server-Sent Events (event names: run, status, research, plan, step,
 * frame, error, done). The run lives inside this request: no queue, no
 * polling. Closing the stream cancels the run.
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

    const running = await prisma.directorRun.findMany({ where: { status: "running" }, select: { id: true, projectId: true } });
    const live = running.filter((r) => isRunLive(r.id));
    if (live.some((r) => r.projectId === id)) throw new AppError("CONFLICT", "A Director run is already in progress on this project.", "Wait for it to finish or cancel it.");
    if (cfg.enabled && live.length >= cfg.maxConcurrentRuns) throw new AppError("QUOTA_EXCEEDED", "The demo server is busy with other films.", "Try again in a few minutes, or watch the showcase.");

    const deps = await directorDeps();
    let gate: Awaited<ReturnType<typeof dailyGate>> | null = null;
    if (cfg.enabled) {
      await cleanupDemoProjects(cfg);
      gate = await dailyGate(cfg);
    }
    const runDeps = { ...deps, ...(gate && { externalGate: gate.gate, onSpend: gate.spend }) };
    const request = { projectId: id, ...body };
    const { runId, budget } = await createRun(request, runDeps);
    const ctrl = registerRun(runId);
    const onAbort = () => ctrl.abort();
    req.signal.addEventListener("abort", onAbort, { once: true });

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let open = true;
        const send = (e: DirectorEvent) => {
          if (!open) return;
          try {
            controller.enqueue(sse(e));
          } catch {
            open = false;
          }
        };
        const ping = setInterval(() => {
          if (!open) return;
          try {
            controller.enqueue(enc.encode(": keep-alive\n\n"));
          } catch {
            open = false;
          }
        }, 15_000);
        try {
          await executeRun(runId, request, runDeps, budget, send, ctrl.signal);
        } finally {
          clearInterval(ping);
          unregisterRun(runId);
          req.signal.removeEventListener("abort", onAbort);
          if (open) {
            open = false;
            controller.close();
          }
        }
      },
      cancel() {
        ctrl.abort();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        "X-Content-Type-Options": "nosniff",
        "X-Director-Run": runId,
      },
    });
  });
}

/** GET — this project's runs (newest first). */
export async function GET(req: Request, ctx: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    const { id } = await ctx.params;
    requireDemoSession(req);
    const runs = await prisma.directorRun.findMany({
      where: { projectId: id },
      orderBy: { startedAt: "desc" },
      select: { id: true, status: true, provider: true, language: true, style: true, tokensIn: true, tokensOut: true, costUsd: true, startedAt: true, finishedAt: true, summary: true },
    });
    return Response.json({ runs: runs.map((r) => ({ ...r, summary: r.summary ? JSON.parse(r.summary) : null, live: isRunLive(r.id) })) });
  });
}
