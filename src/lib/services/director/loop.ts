import { prisma } from "@/lib/db";
import type { CrewModels } from "@/lib/providers";
import type { LlmProvider } from "@/lib/providers/types";
import type { TavilyOptions } from "@/lib/providers/tavily";
import { LOGICAL_CANVAS } from "@/lib/services/svgRenderer";
import { frameClipUrl, frameImageUrl } from "@/lib/services/dto";
import { logger } from "@/lib/services/logger";
import { BudgetExceededError, BudgetTracker, CancelledError, clampBudget, type DirectorBudget } from "@/lib/services/director/budget";
import { recordStep, throwIfCancelled, type DirectorContext, type DirectorEvent, type DirectorOptions, type RunSummary } from "@/lib/services/director/context";
import { runResearch } from "@/lib/services/director/research";
import { runPlan, writeScript } from "@/lib/services/director/plan";
import { runCast } from "@/lib/services/director/cast";
import { commitShot, drawShot, type Drawing } from "@/lib/services/director/artist";
import { critiqueShot, fixesText } from "@/lib/services/director/critic";
import { lintProject, runContinuity, runDialogue, runEditor } from "@/lib/services/director/editor";
import type { Critique } from "@/lib/services/director/schemas";
import type { Frame } from "@/generated/prisma/client";

/**
 * The Director loop — one run per project, streamed as events (the SSE route
 * forwards them). No job queue, no polling: the loop runs inside the request
 * that started it; cancel = abort its signal (POST …/cancel or the client
 * disconnecting).
 *
 *   research? → plan (Ultra) → script (parseTsv → replaceScript) → dialogue
 *   (TTS) → cast library (Super) → per shot: draw (Super) → validate/repair
 *   ≤ 3 → commit (clip) → critic (Nano Omni) → revise ≤ 2 → editor (Nano):
 *   lint-fix ≤ 2 → continuity → done
 */

export interface DirectorRequest {
  readonly projectId: string;
  readonly story: string;
  readonly language: string;
  readonly style: string;
  readonly critic: boolean;
  readonly research: boolean;
  readonly maxShots?: number;
  readonly maxUsd?: number;
}

export interface DirectorDeps {
  readonly provider: LlmProvider;
  readonly models: CrewModels;
  readonly visionAvailable: boolean;
  readonly modelNotes: readonly string[];
  readonly tavily: TavilyOptions | null;
  readonly ceiling: DirectorBudget;
  readonly fps?: number;
  /** Demo mode's global daily token gate (throws BudgetExceededError). */
  readonly externalGate?: () => void;
  /** Called after every model call with the tokens spent (demo daily counter). */
  readonly onSpend?: (tokens: number) => void;
  readonly now?: () => number;
}

// ---------- in-memory registry of live runs (cancel) ----------

const g = globalThis as unknown as { __directorRuns?: Map<string, AbortController> };
const live = (g.__directorRuns ??= new Map<string, AbortController>());

export function registerRun(runId: string): AbortController {
  const ctrl = new AbortController();
  live.set(runId, ctrl);
  return ctrl;
}

export function unregisterRun(runId: string): void {
  live.delete(runId);
}

/** true when a live run was signalled. */
export function cancelRun(runId: string): boolean {
  const ctrl = live.get(runId);
  if (!ctrl) return false;
  ctrl.abort();
  return true;
}

export function isRunLive(runId: string): boolean {
  return live.has(runId);
}

// ---------- run lifecycle ----------

export async function createRun(req: DirectorRequest, deps: DirectorDeps): Promise<{ runId: string; budget: DirectorBudget }> {
  const budget = clampBudget(deps.ceiling, { maxShots: req.maxShots, maxUsd: req.maxUsd });
  const run = await prisma.directorRun.create({
    data: {
      projectId: req.projectId,
      story: req.story,
      language: req.language,
      style: req.style,
      provider: deps.provider.name,
      models: JSON.stringify(deps.models),
      config: JSON.stringify({ budget, critic: req.critic, research: req.research && !!deps.tavily, fps: deps.fps ?? 12, visionAvailable: deps.visionAvailable, modelNotes: deps.modelNotes }),
    },
  });
  return { runId: run.id, budget };
}

interface ShotStats {
  firstPassOk: boolean;
  repairs: number;
  before: number | null;
  after: number | null;
  revisions: number;
}

export async function executeRun(
  runId: string,
  req: DirectorRequest,
  deps: DirectorDeps,
  budget: DirectorBudget,
  emit: (e: DirectorEvent) => void,
  signal: AbortSignal,
): Promise<RunSummary> {
  const tracker = new BudgetTracker(budget, deps.now, deps.externalGate);
  const aspectRatio = "16:9";
  const options: DirectorOptions = {
    language: req.language,
    style: req.style,
    critic: req.critic,
    research: req.research && !!deps.tavily,
    fps: deps.fps ?? 12,
    minShots: Math.min(6, budget.maxShots),
    acceptScore: 7,
  };
  const provider: LlmProvider = deps.onSpend
    ? {
        name: deps.provider.name,
        chat: async (m, o) => {
          const r = await deps.provider.chat(m, o);
          deps.onSpend!(r.usage.promptTokens + r.usage.completionTokens);
          return r;
        },
      }
    : deps.provider;
  const ctx: DirectorContext = {
    runId,
    projectId: req.projectId,
    provider,
    models: deps.models,
    visionAvailable: deps.visionAvailable,
    budget: tracker,
    options,
    canvas: LOGICAL_CANVAS[aspectRatio],
    signal,
    emit,
    seq: 0,
  };
  emit({ type: "run", runId, projectId: req.projectId, provider: deps.provider.name, models: deps.models, notes: [...deps.modelNotes], budget });

  const shotStats = new Map<number, ShotStats>();
  let status = "done";
  let error: string | null = null;
  let continuity: string[] = [];
  try {
    await prisma.project.update({ where: { id: req.projectId }, data: { aspectRatio, resolution: "1K", playbackSpeed: 3 } });
    for (const n of deps.modelNotes) await recordStep(ctx, { role: "system", model: "catalog", action: "models", summary: n });

    // 1 · Research (optional, Tavily)
    let references: string | null = null;
    let referenceNotes: unknown[] = [];
    if (options.research && deps.tavily) {
      emit({ type: "status", message: "Researcher is looking for visual references…" });
      const r = await runResearch(ctx, req.story, deps.tavily);
      references = r.text;
      referenceNotes = r.notes;
    }

    // 2 · Plan (Ultra)
    emit({ type: "status", message: "Director is planning the shots…" });
    const plan = await runPlan(ctx, req.story, references);
    await prisma.directorRun.update({ where: { id: runId }, data: { bible: JSON.stringify({ ...plan, references: referenceNotes }) } });
    emit({
      type: "plan",
      title: plan.title,
      logline: plan.logline,
      shots: plan.shots.map((s, i) => ({ index: i + 1, shotType: s.shotType, description: s.description, mode: s.mode, dialogue: s.dialogue })),
    });

    // 3 · Script (same path as a human TSV import)
    let frames = await writeScript(ctx, plan);

    // 4 · Dialogue first, so each shot is timed to hold its line
    emit({ type: "status", message: "Recording dialogue (local TTS)…" });
    frames = await runDialogue(ctx, plan, frames);

    // 5 · Cast & set library (Super)
    emit({ type: "status", message: "Artist is designing the cast…" });
    const library = await runCast(ctx, plan, aspectRatio);
    const patterns = new Map<number, string>();
    const background = plan.palette[0] ?? "#1a1a2e";

    // 6 · Per shot: draw → commit → critic → revise
    for (const frame of frames) {
      throwIfCancelled(ctx);
      const shot = plan.shots[frame.index - 1];
      const st: ShotStats = { firstPassOk: false, repairs: 0, before: null, after: null, revisions: 0 };
      shotStats.set(frame.index, st);
      emit({ type: "status", message: `Artist is drawing shot ${frame.index}/${frames.length}…` });
      const first = await drawShot(ctx, { plan, shot, index: frame.index, castDefs: library.defs, symbols: library.symbols, aspectRatio, round: 0 });
      st.repairs += first.attempts - 1;
      st.firstPassOk = first.drawing !== null && first.attempts === 1;
      if (!first.drawing) {
        await recordStep(ctx, { role: "artist", model: ctx.models.mid, action: "give-up", shotIndex: frame.index, summary: `Shot ${frame.index} left undrawn after ${first.attempts} attempts`, error: first.lastError });
        emit({ type: "frame", index: frame.index, imageUrl: null, clipUrl: null, score: null, status: "failed" });
        continue;
      }
      let committed: Frame = await commitAndAnnounce(ctx, { frame, shot, index: frame.index, drawing: first.drawing, castDefs: library.defs, patterns, background }, null);
      let best: { drawing: Drawing; critique: Critique | null } = { drawing: first.drawing, critique: null };
      if (options.critic) {
        const c0 = await critiqueShot(ctx, { shot, index: frame.index, drawing: first.drawing, round: 0 });
        best = { drawing: first.drawing, critique: c0.critique };
        st.before = c0.critique?.score ?? null;
        st.after = st.before;
        for (let round = 1; round <= budget.maxCriticRounds; round++) {
          const c = best.critique;
          if (!c || c.score >= options.acceptScore || c.verdict === "accept") break;
          const rev = await drawShot(ctx, { plan, shot, index: frame.index, castDefs: library.defs, symbols: library.symbols, aspectRatio, round, feedback: fixesText(c), previous: best.drawing.svg });
          st.repairs += Math.max(0, rev.attempts - 1);
          if (!rev.drawing) break;
          const cr = await critiqueShot(ctx, { shot, index: frame.index, drawing: rev.drawing, round });
          st.revisions++;
          if (cr.critique && cr.critique.score > c.score) {
            best = { drawing: rev.drawing, critique: cr.critique };
            st.after = cr.critique.score;
            committed = await commitAndAnnounce(ctx, { frame: committed, shot, index: frame.index, drawing: rev.drawing, castDefs: library.defs, patterns, background }, cr.critique.score);
            await recordStep(ctx, { role: "critic", model: ctx.models.vision || ctx.models.fast, action: "uplift", shotIndex: frame.index, score: cr.critique.score, summary: `Revision accepted: ${c.score} → ${cr.critique.score}` });
          } else {
            await recordStep(ctx, { role: "critic", model: ctx.models.vision || ctx.models.fast, action: "keep", shotIndex: frame.index, score: c.score, summary: `Revision scored ${cr.critique?.score ?? "n/a"} ≤ ${c.score}: kept the previous version` });
            break;
          }
        }
      }
    }

    // 7 · Editor (Nano): lint fixes + continuity
    emit({ type: "status", message: "Editor is checking timing and continuity…" });
    await runEditor(ctx);
    continuity = await runContinuity(ctx, plan);
  } catch (e) {
    if (e instanceof CancelledError || signal.aborted) {
      status = "cancelled";
    } else if (e instanceof BudgetExceededError) {
      status = "budget_exceeded";
      error = e.message;
    } else {
      status = "failed";
      error = e instanceof Error ? e.message : String(e);
      logger.error({ err: e, runId }, "director run failed");
    }
  }

  const summary = await summarize(req.projectId, status, shotStats, tracker, continuity, !ctx.visionAvailable && options.critic);
  await prisma.directorRun.update({
    where: { id: runId },
    data: { status, error, summary: JSON.stringify(summary), finishedAt: new Date(), tokensIn: tracker.tokensIn, tokensOut: tracker.tokensOut, costUsd: tracker.costUsd },
  });
  if (error) emit({ type: "error", message: error });
  emit({ type: "done", status, summary });
  return summary;
}

async function commitAndAnnounce(ctx: DirectorContext, opts: Parameters<typeof commitShot>[1], score: number | null): Promise<Frame> {
  const t0 = Date.now();
  const r = await commitShot(ctx, opts);
  await recordStep(ctx, {
    role: "system",
    model: "engine",
    action: r.kind === "clip" ? "render-clip" : "render-still",
    shotIndex: opts.index,
    latencyMs: Date.now() - t0,
    summary: `${r.kind === "clip" ? `Clip ${r.frame.clipFrameCount} frames @ ${r.frame.clipFps} fps` : "Still"} rendered${r.note ? ` (${r.note})` : ""}`,
  });
  ctx.emit({ type: "frame", index: opts.index, imageUrl: frameImageUrl(r.frame), clipUrl: frameClipUrl(r.frame), score, status: r.frame.status });
  return r.frame;
}

const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);

async function summarize(projectId: string, status: string, stats: Map<number, ShotStats>, tracker: BudgetTracker, continuity: string[], textCritic: boolean): Promise<RunSummary> {
  const frames = await prisma.frame.findMany({ where: { projectId } });
  const lint = frames.length ? await lintProject(projectId) : { findings: [], durationSec: 0 };
  const all = [...stats.values()];
  const scored = all.filter((s) => s.before !== null);
  return {
    status,
    shots: frames.length,
    rendered: frames.filter((f) => f.status === "done").length,
    firstPassOk: all.filter((s) => s.firstPassOk).length,
    repairs: all.reduce((n, s) => n + s.repairs, 0),
    criticBefore: mean(scored.map((s) => s.before!)),
    criticAfter: mean(scored.map((s) => s.after!)),
    revisions: all.reduce((n, s) => n + s.revisions, 0),
    lintErrors: lint.findings.filter((f) => f.severity === "error").length,
    lintWarnings: lint.findings.filter((f) => f.severity === "warning").length,
    durationSec: lint.durationSec,
    wallMs: tracker.elapsedMs(),
    tokens: tracker.tokens,
    costUsd: tracker.costUsd,
    continuity,
    textCritic,
  };
}
