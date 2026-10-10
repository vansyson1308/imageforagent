import { prisma } from "@/lib/db";
import type { CrewModels } from "@/lib/providers";
import type { LlmProvider } from "@/lib/providers/types";
import type { TavilyOptions } from "@/lib/providers/tavily";
import { LOGICAL_CANVAS } from "@/lib/services/svgRenderer";
import { frameClipUrl, frameImageUrl } from "@/lib/services/dto";
import { logger } from "@/lib/services/logger";
import { BudgetExceededError, BudgetTracker, CancelledError, clampBudget, type DirectorBudget } from "@/lib/services/director/budget";
import { recordStep, throwIfCancelled, type DirectorContext, type DirectorEvent, type DirectorOptions, type RunSummary } from "@/lib/services/director/context";
import { decideResearch, measureResearchUse, researchMode, runResearch, type ResearchUse } from "@/lib/services/director/research";
import { runPlan, writeScript } from "@/lib/services/director/plan";
import { runCast, type CastLibrary } from "@/lib/services/director/cast";
import { mergeLibraries, persistRunCast, type SeriesData } from "@/lib/services/director/series";
import { actingBrief, neededVariants, variantDefs } from "@/lib/services/director/acting";
import { variantId } from "@/lib/services/director/dollKit";
import { symbolIds } from "@/lib/services/director/svgTools";
import { renderScoreBed } from "@/lib/services/director/scoreBed";
import { buildTimeline, timelineDuration, timelineInputOf } from "@/lib/services/timeline";
import { saveBuffer, toPosix } from "@/lib/services/storage";
import { commitShot, drawShot, type Drawing } from "@/lib/services/director/artist";
import { critiqueShot, fixesText } from "@/lib/services/director/critic";
import { lintProject, runContinuity, runDialogue, runEditor } from "@/lib/services/director/editor";
import type { Critique } from "@/lib/services/director/schemas";
import type { Frame } from "@/generated/prisma/client";

/**
 * The Director loop — one run per project, streamed as events. No job queue,
 * no polling: `runHub.startDetachedRun` runs it in-process, detached from any
 * request, and SSE routes attach listeners (D26). Cancel = abort its signal
 * (POST …/cancel only; a closed tab never cancels).
 *
 *   research? → plan (Ultra) → script (parseTsv → replaceScript) → dialogue
 *   (TTS) → cast library (Super) → per shot: draw (Super) → validate/repair
 *   ≤ 3 → commit (clip) → critic (Nano + measured render; vision model when served) → revise ≤ 2 → editor (Nano):
 *   lint-fix ≤ 2 → continuity → done
 */

export interface DirectorRequest {
  readonly projectId: string;
  readonly story: string;
  readonly language: string;
  readonly style: string;
  readonly critic: boolean;
  /** true = always research, "auto" = Nano decides (needs a Tavily key either way) */
  readonly research: boolean | "auto";
  readonly maxShots?: number;
  readonly maxUsd?: number;
  /** "super-only": every role on the Super tier, no critic (eval baseline). */
  readonly profile?: "crew" | "super-only";
  /** WP5: make this film an episode of a saved series (recurring cast reused verbatim). */
  readonly series?: SeriesData | null;
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
  /** Shots drawn in parallel (DIRECTOR_CONCURRENCY; default 1 keeps the scripted tests ordered). */
  readonly concurrency?: number;
  /** Demo stop rule (D37): the floor redraw can be switched off; absent = on. */
  readonly floorRedraw?: { readonly enabled: boolean; readonly reason: string | null };
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
      seriesId: req.series?.id ?? null,
      config: JSON.stringify({ budget, profile: req.profile ?? "crew", series: req.series ? { id: req.series.id, name: req.series.name } : null, critic: req.critic, research: deps.tavily ? researchMode(req.research) : "off", fps: deps.fps ?? 12, visionAvailable: deps.visionAvailable, modelNotes: deps.modelNotes }),
    },
  });
  return { runId: run.id, budget };
}

/** A finished shot should score at least this; below it gets one fresh redraw (never blocks). */
export const FLOOR_SCORE = 7;

interface ShotStats {
  belowFloor?: boolean;
  /** gate problems the FINAL version still has (accepted on the lenient last attempt) */
  gateFailures?: number;
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
    research: researchMode(req.research) !== "off" && !!deps.tavily,
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
  emit({ type: "run", runId, projectId: req.projectId, provider: deps.provider.name, models: deps.models, notes: [...deps.modelNotes], budget, startedAt: new Date(tracker.startedAt).toISOString() });

  const shotStats = new Map<number, ShotStats>();
  let status = "done";
  let error: string | null = null;
  let continuity: string[] = [];
  let researchUse: ResearchUse | null = null;
  try {
    await prisma.project.update({ where: { id: req.projectId }, data: { aspectRatio, resolution: "1K", playbackSpeed: 3 } });
    for (const n of deps.modelNotes) await recordStep(ctx, { role: "system", model: "catalog", action: "models", summary: n });
    if (deps.floorRedraw && !deps.floorRedraw.enabled) await recordStep(ctx, { role: "system", model: "policy", action: "stop-rule", summary: `Floor redraw off for this run (${deps.floorRedraw.reason ?? "demo policy"})` });

    // 1 · Research (optional, Tavily)
    let references: string | null = null;
    let referenceNotes: Awaited<ReturnType<typeof runResearch>>["notes"] = [];
    if (options.research && deps.tavily) {
      const mode = researchMode(req.research);
      const go = mode === "on" || (await decideResearch(ctx, req.story)).needed;
      if (go) {
        emit({ type: "status", message: "Researcher is looking for visual references…" });
        const r = await runResearch(ctx, req.story, deps.tavily);
        references = r.text;
        referenceNotes = r.notes;
      }
    }

    // 2 · Plan (Ultra)
    emit({ type: "status", message: "Director is planning the shots…" });
    const plan = await runPlan(ctx, req.story, references, referenceNotes.length, req.series ?? null);
    if (referenceNotes.length) {
      researchUse = measureResearchUse(plan, referenceNotes);
      await recordStep(ctx, {
        role: "researcher",
        model: "engine",
        action: "bible-use",
        summary: `The Bible cites ${researchUse.cited} of ${researchUse.notes} research notes (${researchUse.castCiting} cast designs, ${researchUse.shotsCiting} shots)`,
        output: JSON.stringify(researchUse),
      });
    }
    await prisma.directorRun.update({ where: { id: runId }, data: { bible: JSON.stringify({ ...plan, references: referenceNotes }) } });
    emit({
      type: "plan",
      title: plan.title,
      logline: plan.logline,
      shots: plan.shots.map((s, i) => ({ index: i + 1, shotType: s.shotType, description: s.description, mode: s.mode, dialogue: s.dialogue, cites: s.cites })),
    });

    // 3 · Script (same path as a human TSV import)
    let frames = await writeScript(ctx, plan);

    // 4 · Dialogue first, so each shot is timed to hold its line
    emit({ type: "status", message: "Recording dialogue (local TTS)…" });
    const voices = await runDialogue(ctx, plan, frames, req.series?.voices ?? {});
    frames = voices.frames;
    await persistRunCast(runId, { voices: voices.map });

    // 5 · Cast & set library (Super)
    emit({ type: "status", message: "Artist is designing the cast…" });
    let library = await castForEpisode(ctx, plan, aspectRatio, req.series ?? null);
    // Acting variants (WP4.1): the posed/expressive symbols the plan asks for, built from the same kit specs
    if (library.kits.size) {
      const extra = variantDefs(plan, library.kits, library.defs);
      if (extra) {
        const defs = `${library.defs}\n${extra}`;
        library = { ...library, defs, symbols: symbolIds(defs) };
        await prisma.project.update({ where: { id: req.projectId }, data: { artworkDefs: defs } });
        const v = neededVariants(plan, library.kits).filter((x) => extra.includes(`id="${variantId(x.who, x.pose, x.expression)}"`));
        await recordStep(ctx, { role: "cast", model: "engine", action: "acting-variants", summary: `Posed ${v.length} variant(s) from the kit: ${v.map((x) => `${x.who} ${x.pose}/${x.expression}`).join(", ")}` });
      }
    }
    await persistRunCast(runId, { library: library.defs, kits: library.kits });
    const patterns = new Map<number, string>();
    // accepted paintings' thumbnails: the near-duplicate gate compares each shot with its neighbours
    const thumbs = new Map<number, Buffer>();
    const neighbours = (index: number) => () => [index - 1, index + 1].filter((i) => thumbs.has(i)).map((i) => ({ index: i, thumb: thumbs.get(i)! }));
    const background = plan.palette[0] ?? "#1a1a2e";

    // 6 · Per shot: draw → commit → critic → revise (a small pool of shots in parallel)
    const doShot = async (frame: Frame) => {
      throwIfCancelled(ctx);
      const shot = plan.shots[frame.index - 1];
      const st: ShotStats = { firstPassOk: false, repairs: 0, before: null, after: null, revisions: 0 };
      shotStats.set(frame.index, st);
      emit({ type: "status", message: `Artist is drawing shot ${frame.index}/${frames.length}…` });
      const first = await drawShot(ctx, { plan, shot, index: frame.index, castDefs: library.defs, symbols: library.symbols, aspectRatio, round: 0, neighbours: neighbours(frame.index), actingBrief: actingBrief(shot, library.kits) });
      st.repairs += first.attempts - 1;
      st.firstPassOk = first.drawing !== null && first.attempts === 1;
      if (!first.drawing) {
        await recordStep(ctx, { role: "artist", model: ctx.models.mid, action: "give-up", shotIndex: frame.index, summary: `Shot ${frame.index} left undrawn after ${first.attempts} attempts`, error: first.lastError });
        emit({ type: "frame", index: frame.index, imageUrl: null, clipUrl: null, score: null, status: "failed" });
        return;
      }
      if (first.drawing.thumb) thumbs.set(frame.index, first.drawing.thumb);
      if (first.drawing.checks?.problems.length) st.gateFailures = first.drawing.checks.problems.length;
      let committed: Frame = await commitAndAnnounce(ctx, { frame, shot, index: frame.index, drawing: first.drawing, castDefs: library.defs, patterns, background, acting: { kits: library.kits, plan } }, null);
      let best: { drawing: Drawing; critique: Critique | null } = { drawing: first.drawing, critique: null };
      if (!options.critic) return;
      const c0 = await critiqueShot(ctx, { shot, index: frame.index, drawing: first.drawing, round: 0 });
      best = { drawing: first.drawing, critique: c0.critique };
      st.before = c0.critique?.score ?? null;
      st.after = st.before;
      for (let round = 1; round <= budget.maxCriticRounds; round++) {
        const c = best.critique;
        if (!c || c.score >= options.acceptScore || c.verdict === "accept") break;
        const rev = await drawShot(ctx, { plan, shot, index: frame.index, castDefs: library.defs, symbols: library.symbols, aspectRatio, round, feedback: fixesText(c), previous: best.drawing.svg, neighbours: neighbours(frame.index), actingBrief: actingBrief(shot, library.kits) });
        st.repairs += Math.max(0, rev.attempts - 1);
        if (!rev.drawing) break;
        const cr = await critiqueShot(ctx, { shot, index: frame.index, drawing: rev.drawing, round });
        st.revisions++;
        if (cr.critique && cr.critique.score > c.score) {
          best = { drawing: rev.drawing, critique: cr.critique };
          st.after = cr.critique.score;
          if (rev.drawing.thumb) thumbs.set(frame.index, rev.drawing.thumb);
          st.gateFailures = rev.drawing.checks?.problems.length ?? 0;
          committed = await commitAndAnnounce(ctx, { frame: committed, shot, index: frame.index, drawing: rev.drawing, castDefs: library.defs, patterns, background, acting: { kits: library.kits, plan } }, cr.critique.score);
          await recordStep(ctx, { role: "critic", model: ctx.models.vision || ctx.models.fast, action: "uplift", shotIndex: frame.index, score: cr.critique.score, summary: `Revision accepted: ${c.score} → ${cr.critique.score}` });
        } else {
          await recordStep(ctx, { role: "critic", model: ctx.models.vision || ctx.models.fast, action: "keep", shotIndex: frame.index, score: c.score, summary: `Revision scored ${cr.critique?.score ?? "n/a"} ≤ ${c.score}: kept the previous version` });
          break;
        }
      }
      // FLOOR (WP4.4): still below the bar → one fresh redraw with a different approach; kept only if it scores higher
      const fb = best.critique;
      if (fb && fb.score < FLOOR_SCORE && deps.floorRedraw?.enabled === false) st.belowFloor = true;
      else if (fb && fb.score < FLOOR_SCORE) {
        const fresh = await drawShot(ctx, {
          plan,
          shot,
          index: frame.index,
          castDefs: library.defs,
          symbols: library.symbols,
          aspectRatio,
          round: budget.maxCriticRounds + 1,
          feedback: `START OVER. The best version so far scored ${fb.score}/10 (${fb.issues.slice(0, 3).join("; ") || "weak"}). Draw a NEW composition with a different approach: another camera angle or distance, a different layout of the characters, clearer staging of the action. Do not copy the earlier layout.`,
          neighbours: neighbours(frame.index),
          actingBrief: actingBrief(shot, library.kits),
        });
        st.repairs += Math.max(0, fresh.attempts - 1);
        if (fresh.drawing) {
          const cf = await critiqueShot(ctx, { shot, index: frame.index, drawing: fresh.drawing, round: budget.maxCriticRounds + 1 });
          st.revisions++;
          if (cf.critique && cf.critique.score > fb.score) {
            best = { drawing: fresh.drawing, critique: cf.critique };
            st.after = cf.critique.score;
            if (fresh.drawing.thumb) thumbs.set(frame.index, fresh.drawing.thumb);
            st.gateFailures = fresh.drawing.checks?.problems.length ?? 0;
            committed = await commitAndAnnounce(ctx, { frame: committed, shot, index: frame.index, drawing: fresh.drawing, castDefs: library.defs, patterns, background, acting: { kits: library.kits, plan } }, cf.critique.score);
            await recordStep(ctx, { role: "critic", model: ctx.models.vision || ctx.models.fast, action: "uplift", shotIndex: frame.index, score: cf.critique.score, summary: `Fresh redraw accepted: ${fb.score} → ${cf.critique.score}` });
          } else {
            await recordStep(ctx, { role: "critic", model: ctx.models.vision || ctx.models.fast, action: "keep", shotIndex: frame.index, score: fb.score, summary: `Fresh redraw scored ${cf.critique?.score ?? "n/a"} ≤ ${fb.score}: kept the previous version` });
          }
        }
        if ((best.critique?.score ?? 0) < FLOOR_SCORE) st.belowFloor = true;
      }
    };
    await runPool(frames, Math.max(1, Math.min(6, deps.concurrency ?? 1)), doShot);

    // 7 · Editor (Nano): lint fixes + continuity
    emit({ type: "status", message: "Editor is checking timing and continuity…" });
    await runEditor(ctx, plan, req.series?.voices ?? {});
    continuity = await runContinuity(ctx, plan);

    // 8 · Original score bed from the engine's own synth (WP4.6), ducked under dialogue by the film mix
    await scoreFilm(ctx, plan);
  } catch (e) {
    if (signal.aborted && signal.reason instanceof BudgetExceededError) {
      // the wall-time watchdog (runHub) aborted a call that was stuck
      status = "budget_exceeded";
      error = signal.reason.message;
    } else if (e instanceof CancelledError || signal.aborted) {
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

  const summary = { ...(await summarize(req.projectId, status, shotStats, tracker, continuity, !ctx.visionAvailable && options.critic, ctx.visionAvailable && options.critic && ctx.models.vision ? `${ctx.models.vision} looks · ${ctx.models.fast} scores` : null)), ...(researchUse && { research: researchUse }) };
  await prisma.directorRun.update({
    where: { id: runId },
    data: { status, error, summary: JSON.stringify(summary), finishedAt: new Date(), tokensIn: tracker.tokensIn, tokensOut: tracker.tokensOut, costUsd: tracker.costUsd },
  });
  if (error) emit({ type: "error", message: error });
  emit({ type: "done", status, summary });
  return summary;
}

/**
 * Run `work` over `items` with at most `limit` in flight. The first failure
 * stops scheduling new items; in-flight ones finish (they hit the same budget
 * or cancel checkpoint) and the first error is rethrown.
 */
export async function runPool<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  let failure: { error: unknown } | null = null;
  const lane = async () => {
    while (!failure && next < items.length) {
      const item = items[next++];
      try {
        await work(item);
      } catch (e) {
        failure ??= { error: e };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  if (failure) throw (failure as { error: unknown }).error;
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
    summary: `${r.kind === "clip" ? `Clip ${r.frame.clipFrameCount} frames @ ${r.frame.clipFps} fps` : "Still"} rendered${r.acting?.length ? `; acting: ${r.acting.join(", ")}` : ""}${r.note ? ` (${r.note})` : ""}`,
  });
  ctx.emit({ type: "frame", index: opts.index, imageUrl: frameImageUrl(r.frame), clipUrl: frameClipUrl(r.frame), score, status: r.frame.status });
  return r.frame;
}

const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);

async function summarize(projectId: string, status: string, stats: Map<number, ShotStats>, tracker: BudgetTracker, continuity: string[], textCritic: boolean, criticEyes: string | null = null): Promise<RunSummary> {
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
    gateFailures: all.filter((s) => (s.gateFailures ?? 0) > 0).length,
    belowFloor: [...stats.entries()].filter(([, s]) => s.belowFloor).map(([i]) => i).sort((a, b) => a - b),
    criticModel: criticEyes,
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

/** Compose and attach the film's score (a failure only costs the music, never the film). */
async function scoreFilm(ctx: DirectorContext, plan: Parameters<typeof renderScoreBed>[0]): Promise<void> {
  throwIfCancelled(ctx);
  const t0 = Date.now();
  try {
    const project = await prisma.project.findUniqueOrThrow({ where: { id: ctx.projectId }, include: { frames: { orderBy: { index: "asc" } } } });
    const timeline = buildTimeline(project.frames.map((f) => timelineInputOf(f)), project.playbackSpeed);
    const total = timelineDuration(timeline);
    if (total <= 0) return;
    const { wav, cues } = renderScoreBed(plan, timeline, total);
    const musicPath = toPosix(`${ctx.projectId}/audio/music.wav`);
    await saveBuffer(musicPath, wav);
    await prisma.project.update({ where: { id: ctx.projectId }, data: { musicPath } });
    await recordStep(ctx, {
      role: "system",
      model: "engine:score",
      action: "music",
      latencyMs: Date.now() - t0,
      summary: `Original score ${Math.round(total)} s: ${cues.map((c) => `${c.mood} ${Math.round(c.start)}–${Math.round(c.end)} s`).join(", ")} (ducked under dialogue in the mix)`,
    });
  } catch (e) {
    await recordStep(ctx, { role: "system", model: "engine:score", action: "music", summary: "Score skipped", error: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * The cast library of a film. In a series episode the recurring members come
 * verbatim from the series library (pixel-identical) and the Cast draws ONLY
 * the new guests and sets; otherwise the Cast draws everyone.
 */
async function castForEpisode(ctx: DirectorContext, plan: Parameters<typeof runCast>[1], aspectRatio: string, series: SeriesData | null): Promise<CastLibrary> {
  if (!series) return runCast(ctx, plan, aspectRatio);
  const recurring = new Set(series.cast.map((c) => c.id));
  const fresh = plan.cast.filter((c) => !recurring.has(c.id));
  const kits = new Map(series.kits);
  let defs = series.library;
  if (fresh.length) {
    const guests = await runCast(ctx, { ...plan, cast: fresh, shots: plan.shots.map((s) => ({ ...s, cast: s.cast.filter((id) => !recurring.has(id)) })) }, aspectRatio);
    defs = mergeLibraries(series.library, guests.defs);
    for (const [k, v] of guests.kits) kits.set(k, v);
  }
  await prisma.project.update({ where: { id: ctx.projectId }, data: { artworkDefs: defs } });
  await recordStep(ctx, {
    role: "cast",
    model: "series",
    action: "series-cast",
    summary: `Series "${series.name}": reused ${plan.cast.filter((c) => recurring.has(c.id)).map((c) => c.id).join(", ") || "no"} verbatim (pixel-identical)${fresh.length ? `; drew new: ${fresh.map((c) => c.id).join(", ")}` : ""}`,
  });
  return { defs, symbols: symbolIds(defs), placeholder: false, kits };
}
