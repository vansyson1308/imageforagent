import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/services/apiError";
import { handleRoute, parseBody } from "@/lib/services/routeHelpers";
import { enforceRateLimit } from "@/lib/services/rateLimit";
import { demoConfig, isOperatorRequest } from "@/lib/services/demoMode";
import { runCeiling } from "@/lib/services/director/budget";
import { cleanupDemoProjects, dailyGate, requireDemoSession } from "@/lib/services/demoGuard";
import { directorDeps } from "@/lib/services/director/deps";
import { createRun, isRunLive } from "@/lib/services/director/loop";
import { demoFloorPolicy } from "@/lib/services/director/demoPolicy";
import { reapOrphanRuns, runEventStream, SSE_HEADERS, startDetachedRun } from "@/lib/services/director/runHub";
import { STYLE_PRESETS } from "@/lib/services/director/prompts";
import { editCastFromRun, loadCastFromRun, loadSeries } from "@/lib/services/director/series";
import { STATE_OPS } from "@/lib/services/director/stateTransforms";
import { decodeWav } from "@/lib/services/audio/wav";
import type { NarrationShot } from "@/lib/services/director/fixedNarration";

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
  /** A narrated episode (Hidamari): one shot per line, in order, each line the shot's narration (owner QC 2026-10-10). */
  narration: z.array(z.string().min(1).max(220)).min(2).max(24).optional(),
  /**
   * Fixed narration from the owner's package (D59): one entry per shot, its lines in order, each with the owner's
   * recording (WAV base64) when it exists. Never rewritten; each shot holds its real audio + pause_after.
   */
  /** "9:16" = vertical Shorts (the Hidamari pilot) */
  aspectRatio: z.enum(["16:9", "9:16"]).optional(),
  /** "adult" = adult proportions for every human doll (a channel that forbids chibi) */
  figure: z.enum(["storybook", "adult"]).optional(),
  /** "cast" = an operator's cast-only preview (plan + library + recognition gate, no shots; owner 2026-10-12) */
  stopAfter: z.literal("cast").optional(),
  /** an operator's full take on an APPROVED preview's cast: that run's Bible and library, verbatim (owner 2026-10-12) */
  castFromRun: z.string().regex(/^[a-z0-9]{10,40}$/).optional(),
  /** engine edits on that reused cast (D77, operator only): tear/patch a key-object state on the approved base, or keep one look */
  castEdits: z
    .array(
      z.union([
        z.object({ prop: z.string().regex(/^[a-z][a-z0-9-]{1,31}$/), state: z.string().regex(/^[a-z][a-z0-9]{1,15}$/), op: z.enum(STATE_OPS) }),
        z.object({ prop: z.string().regex(/^[a-z][a-z0-9-]{1,31}$/), op: z.literal("single") }),
      ]),
    )
    .max(6)
    .optional(),
  narrationShots: z
    .array(
      z.object({
        lines: z
          .array(z.object({ id: z.string().regex(/^S\d{2}_L\d{2}$/), text: z.string().trim().min(1).max(400), pauseAfter: z.number().min(0).max(5).default(0.5), wav: z.string().max(12_000_000).optional() }))
          .min(1)
          .max(4),
      }),
    )
    .min(2)
    .max(24)
    .optional(),
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
    if ((body.stopAfter || body.castFromRun) && cfg.enabled && !isOperatorRequest(req, cfg)) throw new AppError("UNAUTHORIZED", "Cast-only previews and cast reuse are operator tools.");
    // a cast-only preview MAY start from an approved cast (with engine edits, D77): the edited preview is the one approved next
    if (body.castFromRun && body.seriesId) throw new AppError("VALIDATION", "castFromRun can't be combined with seriesId.");
    if (body.castEdits?.length && !body.castFromRun) throw new AppError("VALIDATION", "castEdits need castFromRun (they edit an approved cast).");
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
    const floor = cfg.enabled ? await demoFloorPolicy() : null;
    // operator runs (showcase, pilot, bench) may use the operator's per-run token cap (O10); judges keep the public one
    const ceiling = runCeiling(deps.ceiling, isOperatorRequest(req, cfg));
    const runDeps = { ...deps, ceiling, ...(gate && { externalGate: gate.gate, onSpend: gate.spend }), ...(floor && { floorRedraw: { enabled: floor.enabled, reason: floor.reason } }) };
    const series = body.seriesId ? await loadSeries(body.seriesId, sid, cfg.enabled) : null;
    const loaded = body.castFromRun ? await loadCastFromRun(body.castFromRun) : null;
    const castFrom = loaded && body.castEdits?.length ? await editCastFromRun(loaded, body.castEdits).catch((e: unknown) => {
      throw new AppError("VALIDATION", `castEdits: ${e instanceof Error ? e.message : String(e)}`);
    }) : loaded;
    const { seriesId: _ignored, castFromRun: _from, castEdits: _edits, narrationShots, ...rest } = body;
    void _edits;
    void _ignored;
    void _from;
    if (narrationShots && body.narration) throw new AppError("VALIDATION", "Send either narration or narrationShots, not both.");
    const request = { projectId: id, ...rest, ...(narrationShots && { narrationShots: decodeNarration(narrationShots) }), series, castFrom, critic: body.profile === "super-only" ? false : body.critic };
    const { runId, budget } = await createRun(request, runDeps);
    startDetachedRun(runId, request, runDeps, budget);
    return new Response(runEventStream(runId, { replay: true }), { headers: { ...SSE_HEADERS, "X-Director-Run": runId } });
  });
}

/** The owner's recordings as bytes, each checked to be a readable WAV before any model call. */
function decodeNarration(shots: ReadonlyArray<{ lines: ReadonlyArray<{ id: string; text: string; pauseAfter: number; wav?: string }> }>): NarrationShot[] {
  return shots.map((s) => ({
    lines: s.lines.map((l) => {
      if (!l.wav) return { id: l.id, text: l.text, pauseAfter: l.pauseAfter };
      const wav = Buffer.from(l.wav, "base64");
      try {
        decodeWav(wav);
      } catch (e) {
        throw new AppError("VALIDATION", `Line ${l.id}: the recording is not a readable WAV (${e instanceof Error ? e.message : String(e)}).`);
      }
      return { id: l.id, text: l.text, pauseAfter: l.pauseAfter, wav };
    }),
  }));
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
