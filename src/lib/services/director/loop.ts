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
import { recognizeHeroProps, type Recognition } from "@/lib/services/director/recognize";
import { castHashes, mergeLibraries, persistRunCast, type CastFromRun, type SeriesData } from "@/lib/services/director/series";
import { actingBrief, airborneProps, holdAirborne, holdCarried, neededVariants, variantDefs } from "@/lib/services/director/acting";
import { variantId } from "@/lib/services/director/dollKit";
import { symbolIds } from "@/lib/services/director/svgTools";
import { renderScoreBed } from "@/lib/services/director/scoreBed";
import { buildTimeline, floorHold, timelineDuration, timelineInputOf } from "@/lib/services/timeline";
import { writeFrameMotion } from "@/lib/services/frameWrites";
import { saveBuffer, toPosix } from "@/lib/services/storage";
import { commitShot, drawShot, padHolds, type Drawing } from "@/lib/services/director/artist";
import { critiqueShot, fixesText } from "@/lib/services/director/critic";
import { shotText, shotVoice, type NarrationShot } from "@/lib/services/director/fixedNarration";
import { actionNote, fidelityBrief, goldenHour, offPlanAxes } from "@/lib/services/director/fidelity";
import { lintProject, runContinuity, runDialogue, runEditor } from "@/lib/services/director/editor";
import type { Critique, Plan } from "@/lib/services/director/schemas";
import { mergeRedo, shotPatterns } from "@/lib/services/director/redo";
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
  /** A narrated episode: one shot per line, in order; each line is that shot's narration. */
  readonly narration?: readonly string[];
  /**
   * Fixed narration (owner packages, D59): one entry per shot, its lines and
   * (when recorded) their WAVs. Supersedes `narration`; never rewritten.
   */
  readonly narrationShots?: readonly NarrationShot[];
  /** "9:16" makes vertical Shorts (the Hidamari pilot); default 16:9 */
  readonly aspectRatio?: "16:9" | "9:16";
  /** "adult": every human doll gets adult proportions (a channel that forbids chibi); default storybook */
  readonly figure?: "storybook" | "adult";
  /** "cast": stop after the cast library and the hero-prop recognition gate (a cheap preview of the props and sets, no shots) */
  readonly stopAfter?: "cast";
  /** reuse an approved cast-only preview's cast verbatim (operator only): no re-plan of the cast, no Cast call, no re-check */
  readonly castFrom?: CastFromRun | null;
  /** the film's floor (the format's minimum length + a margin for transitions): shorter, and every shot holds a little longer (padHolds) */
  readonly minFilmSec?: number;
  /**
   * single-shot redo (D84, operator only): redraw only these shots of a finished take on its own project, with the take's
   * plan and cast (castFrom = the take); no research, plan, script, voices, cast or recognition calls; the summary is the take's
   * with the redone shots swapped in
   */
  readonly redo?: { readonly sourceRunId: string; readonly shots: readonly number[]; readonly plan: Plan; readonly summary: RunSummary; readonly notes?: Readonly<Record<number, string>> } | null;
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
  const budget = clampBudget(deps.ceiling, { maxShots: req.narrationShots?.length ?? req.narration?.length ?? req.maxShots, maxUsd: req.maxUsd });
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
  /** off-plan axes (time/place) the FINAL version still has, per Nano's fidelity verdict */
  offPlan?: string[];
  /** the critic's "action" note on the final version (a by-eye checklist item, not a gate) */
  actionNote?: string | null;
  /** the final version places none of the shot's sets */
  setless?: boolean;
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
  const aspectRatio = req.aspectRatio ?? "16:9";
  const options: DirectorOptions = {
    language: req.language,
    style: req.style,
    critic: req.critic,
    research: researchMode(req.research) !== "off" && !!deps.tavily,
    fps: deps.fps ?? 12,
    minShots: Math.min(6, budget.maxShots),
    acceptScore: 7,
    figure: req.figure ?? "storybook",
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
  let propRecognition: Recognition[] = [];
  let castSetTimes: Record<string, string> | undefined;
  try {
    // a redo keeps the take's still hold (D85); a new film starts at 3 s per still
    await prisma.project.update({ where: { id: req.projectId }, data: { aspectRatio, resolution: "1K", ...(req.redo ? {} : { playbackSpeed: 3 }) } });
    for (const n of deps.modelNotes) await recordStep(ctx, { role: "system", model: "catalog", action: "models", summary: n });
    if (deps.floorRedraw && !deps.floorRedraw.enabled) await recordStep(ctx, { role: "system", model: "policy", action: "stop-rule", summary: `Floor redraw off for this run (${deps.floorRedraw.reason ?? "demo policy"})` });

    // 1 · Research (optional, Tavily)
    let references: string | null = null;
    let referenceNotes: Awaited<ReturnType<typeof runResearch>>["notes"] = [];
    const redo = req.redo ?? null;
    if (options.research && deps.tavily && !redo) {
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
    const narration = req.narrationShots ? req.narrationShots.map((s) => shotText(s, req.language)) : (req.narration ?? null);
    const fixedVoices = req.narrationShots ? new Map<number, NonNullable<ReturnType<typeof shotVoice>>>() : null;
    let plan = redo ? redo.plan : await runPlan(ctx, req.story, references, referenceNotes.length, req.series ?? null, narration, req.castFrom ? { cast: req.castFrom.cast, palette: req.castFrom.palette } : null);
    if (redo) await recordStep(ctx, { role: "system", model: "engine", action: "redo", summary: `Single-shot redo of run ${redo.sourceRunId}: shot(s) ${redo.shots.join(", ")} redrawn with the take's plan and cast; every other shot stays as the take committed it (D84)`, output: JSON.stringify({ sourceRunId: redo.sourceRunId, shots: redo.shots }) });
    if (req.narrationShots && fixedVoices && !redo) {
      // the owner's recordings, one per planned shot (a shorter plan gets the remaining lines on its last shot, like withNarration)
      const n = plan.shots.length;
      req.narrationShots.forEach((_, i) => {
        if (i >= n) return;
        const lines = i < n - 1 ? req.narrationShots![i].lines : req.narrationShots!.slice(i).flatMap((x) => x.lines);
        const v = shotVoice({ lines });
        if (v) fixedVoices.set(i + 1, v);
      });
      // a recorded shot holds exactly its audio (+ lead-in and tail), not the plan's guess
      plan = { ...plan, shots: plan.shots.map((s, i) => (fixedVoices.has(i + 1) ? { ...s, durationSec: 1.5 } : s)) };
      await recordStep(ctx, {
        role: "dialogue",
        model: "owner-narration",
        action: "fixed-narration",
        summary: `Narration fixed before the run: ${req.narrationShots.reduce((k, x) => k + x.lines.length, 0)} line(s) over ${req.narrationShots.length} shot(s); ${fixedVoices.size} shot(s) carry the owner's recordings${fixedVoices.size < plan.shots.length ? `, ${plan.shots.length - fixedVoices.size} use the demo TTS (draft)` : ""}`,
      });
    }
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
    let frames = redo ? await prisma.frame.findMany({ where: { projectId: req.projectId }, orderBy: { index: "asc" } }) : await writeScript(ctx, plan);
    // the redo keeps every other shot's camera pattern as committed (castFromRun below resets the defs to the cast)
    const keptPatterns = redo ? shotPatterns((await prisma.project.findUniqueOrThrow({ where: { id: req.projectId } })).artworkDefs ?? "") : new Map<number, string>();

    // 4 · Dialogue first, so each shot is timed to hold its line (a cast-only preview draws no shot: no voices)
    if (redo) {
      // the take's voices stay; its holds are recomputed (padHolds is a pure function of the plan and the recorded voices)
      if (req.minFilmSec) plan = padHolds(plan, frames, req.minFilmSec).plan;
    } else if (req.stopAfter !== "cast") {
      emit({ type: "status", message: "Recording dialogue (local TTS)…" });
      const voices = await runDialogue(ctx, plan, frames, req.series?.voices ?? {}, fixedVoices ?? undefined);
      frames = voices.frames;
      await persistRunCast(runId, { voices: voices.map });
      if (req.minFilmSec) {
        const padded = padHolds(plan, frames, req.minFilmSec);
        if (padded.added) {
          plan = padded.plan;
          await recordStep(ctx, { role: "editor", model: "engine", action: "pad-holds", summary: `The film would run ${padded.before}s, under its ${req.minFilmSec}s floor: every shot holds ${padded.added}s longer` });
        }
      }
    }

    // 5 · Cast & set library (Super)
    emit({ type: "status", message: "Artist is designing the cast…" });
    let library = req.castFrom ? await castFromRun(ctx, plan, req.castFrom) : await castForEpisode(ctx, plan, aspectRatio, req.series ?? null);
    // D86 (b): an airborne prop up in a shot with nobody posed to hold it: the shot's flyer holds the string
    if (library.kits.size) {
      const flyers = holdAirborne(plan, library.kits, airborneProps(plan.cast));
      if (flyers.posed.length) {
        plan = flyers.plan;
        await recordStep(ctx, { role: "director", model: "engine", action: "hold-airborne", summary: `Up in the air with nobody holding the string: ${flyers.posed.map((p) => `shot ${p.shot} #${p.who} ${p.was ?? "unposed"} → hold`).join(", ")} (D86)` });
      }
      // D88: a walker the shot says carries a prop holds it (a walking pose can't take it into the hands)
      const carriers = holdCarried(plan, library.kits, airborneProps(plan.cast));
      if (carriers.posed.length) {
        plan = carriers.plan;
        await recordStep(ctx, { role: "director", model: "engine", action: "hold-carried", summary: `Carries the shot's prop while walking: ${carriers.posed.map((p) => `shot ${p.shot} #${p.who} walk → hold`).join(", ")} (D88)` });
      }
    }
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
    // A · the story's key object must be recognisable on its own, every state (owner 2026-10-12)
    const recognized = redo
      ? { library, results: [...(redo.summary.propRecognition ?? [])] as Recognition[] }
      : await recognizeHeroProps(ctx, plan, library, aspectRatio, req.castFrom?.recognition, new Set(req.castFrom?.edits?.changed ?? []));
    library = recognized.library;
    propRecognition = recognized.results;
    castSetTimes = library.setTimes ? Object.fromEntries(library.setTimes) : undefined;
    await persistRunCast(runId, { library: library.defs, kits: library.kits });
    if (req.stopAfter === "cast") {
      await recordStep(ctx, { role: "system", model: "engine", action: "stop-after-cast", summary: "Cast-only preview: stopped after the library and the recognition gate (no shots drawn)" });
      throw new StopAfterCast();
    }
    const patterns = new Map<number, string>([...keptPatterns.entries()].filter(([i]) => !redo?.shots.includes(i)));
    // the project's defs hold the other shots' paintings again at once (a redo that draws nothing leaves the take whole)
    if (redo) await prisma.project.update({ where: { id: req.projectId }, data: { artworkDefs: [library.defs, ...[...keptPatterns.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p)].join("\n") } });
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
      // D86 (a): a redo carries QC's by-eye note for the shot: the Artist's first issue in every round, and the critic checks it
      const qcNote = redo?.notes?.[frame.index] ? `QC (by eye, owner + QC) on the take's version of this shot — get this right first: ${redo.notes[frame.index]}` : null;
      const withQc = (fb: string) => (qcNote ? `${qcNote}\n${fb}` : fb);
      const first = await drawShot(ctx, { plan, shot, index: frame.index, castDefs: library.defs, symbols: library.symbols, aspectRatio, round: 0, feedback: qcNote, neighbours: neighbours(frame.index), actingBrief: actingBrief(shot, library.kits), kits: library.kits, setTimes: library.setTimes });
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
      st.setless = !placesASet(first.drawing.svg, plan);
      if (!options.critic) return;
      // D89: a take on an approved preview's cast (a redo carries its take's) shoots on sets the owner and QC approved
      const approvedSet = { approvedSet: !!req.castFrom };
      const planBrief = `${fidelityBrief(plan, shot, library.setTimes ?? new Map(), approvedSet)}${qcNote ? ` ${qcNote}` : ""}`;
      const golden = goldenHour(shot, library.setTimes ?? new Map(), approvedSet);
      const c0 = await critiqueShot(ctx, { shot, index: frame.index, drawing: first.drawing, round: 0, context: planBrief, goldenHour: golden });
      best = { drawing: first.drawing, critique: c0.critique };
      st.before = c0.critique?.score ?? null;
      st.after = st.before;
      for (let round = 1; round <= budget.maxCriticRounds; round++) {
        const c = best.critique;
        if (!c || c.score >= options.acceptScore || c.verdict === "accept") break;
        const rev = await drawShot(ctx, { plan, shot, index: frame.index, castDefs: library.defs, symbols: library.symbols, aspectRatio, round, feedback: withQc(fixesText(c)), previous: best.drawing.svg, neighbours: neighbours(frame.index), actingBrief: actingBrief(shot, library.kits), kits: library.kits, setTimes: library.setTimes });
        st.repairs += Math.max(0, rev.attempts - 1);
        if (!rev.drawing) break;
        const cr = await critiqueShot(ctx, { shot, index: frame.index, drawing: rev.drawing, round, context: planBrief, goldenHour: golden });
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
          feedback: withQc(`START OVER. The best version so far scored ${fb.score}/10 (${fb.issues.slice(0, 3).join("; ") || "weak"}). Draw a NEW composition with a different approach: another camera angle or distance, a different layout of the characters, clearer staging of the action. Do not copy the earlier layout.`),
          neighbours: neighbours(frame.index),
          actingBrief: actingBrief(shot, library.kits),
          kits: library.kits,
          setTimes: library.setTimes,
        });
        st.repairs += Math.max(0, fresh.attempts - 1);
        if (fresh.drawing) {
          const cf = await critiqueShot(ctx, { shot, index: frame.index, drawing: fresh.drawing, round: budget.maxCriticRounds + 1, context: planBrief, goldenHour: golden });
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
      st.offPlan = offPlanAxes(best.critique);
      st.actionNote = actionNote(best.critique);
      st.setless = !placesASet(best.drawing.svg, plan);
      if (st.offPlan.length) await recordStep(ctx, { role: "critic", model: ctx.models.fast, action: "off-plan", shotIndex: frame.index, score: best.critique?.score ?? null, summary: `Shot ${frame.index} still off-plan after revisions (${st.offPlan.join(" + ")})`, error: best.critique?.fidelity?.note || null });
    };
    await runPool(redo ? frames.filter((f) => redo.shots.includes(f.index)) : frames, Math.max(1, Math.min(6, deps.concurrency ?? 1)), doShot);

    // a redo changes only its shots: the take's edit, continuity notes and score stay (the score is redone only when the film's length changes)
    if (!redo) {
      // 7 · Editor (Nano): lint fixes + continuity
      emit({ type: "status", message: "Editor is checking timing and continuity…" });
      // narrated films: the lines are fixed (the Editor may move a voice or a transition, never rewrite a line)
      await runEditor(ctx, plan, req.series?.voices ?? {}, Boolean(narration));
      continuity = await runContinuity(ctx, plan);
    }
    // D85: the film's floor, measured on the real timeline: too short → every shot holds a little longer
    const held = req.minFilmSec ? await holdToFloor(ctx, req.minFilmSec) : false;
    // 8 · Original score bed from the engine's own synth (WP4.6), ducked under dialogue by the film mix
    if (!redo || held) await scoreFilm(ctx, plan);
  } catch (e) {
    if (e instanceof StopAfterCast) {
      // the preview is complete: status stays "done"
    } else if (signal.aborted && signal.reason instanceof BudgetExceededError) {
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

  const own = { ...(await summarize(req.projectId, status, shotStats, tracker, continuity, !ctx.visionAvailable && options.critic, ctx.visionAvailable && options.critic && ctx.models.vision ? `${ctx.models.vision} looks · ${ctx.models.fast} scores` : null)), ...(researchUse && { research: researchUse }), ...(propRecognition.length && { propRecognition }), ...(req.stopAfter && { stopAfter: req.stopAfter }), ...(castSetTimes && { castSetTimes }), ...(req.castFrom && { castFromRun: req.castFrom.sourceRunId }) };
  const summary = req.redo && status === "done" ? mergeRedo(req.redo.summary, own, req.redo.shots, req.redo.sourceRunId) : own;
  await prisma.directorRun.update({
    where: { id: runId },
    data: { status, error, summary: JSON.stringify(summary), finishedAt: new Date(), tokensIn: tracker.tokensIn, tokensOut: tracker.tokensOut, costUsd: tracker.costUsd },
  });
  if (error) emit({ type: "error", message: error });
  emit({ type: "done", status, summary });
  return summary;
}

/** Control flow for a cast-only preview (not an error). */
class StopAfterCast extends Error {}

/** The drawing places one of the film's sets (a shot without a set reads as characters on a void). */
function placesASet(svg: string, plan: { cast: readonly { id: string; kind: string }[] }): boolean {
  // a set's day/night variant (#id--day, #id--night) counts as the set
  return plan.cast.some((c) => c.kind === "set" && new RegExp(`href\\s*=\\s*["']#${c.id}(--(day|night))?["']`).test(svg));
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
    gateFailShots: [...stats.entries()].filter(([, s]) => (s.gateFailures ?? 0) > 0).map(([i]) => i).sort((a, b) => a - b),
    offPlan: [...stats.entries()].filter(([, s]) => s.offPlan?.length).map(([i]) => i).sort((a, b) => a - b),
    actionNotes: Object.fromEntries([...stats.entries()].filter(([, s]) => s.actionNote).map(([i, s]) => [i, s.actionNote as string])),
    setless: [...stats.entries()].filter(([, s]) => s.setless).map(([i]) => i).sort((a, b) => a - b),
    shotScores: Object.fromEntries([...stats.entries()].sort(([a], [b]) => a - b).map(([i, s]) => [i, s.after])),
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

/**
 * D85: the film's floor, measured on the timeline the film is cut from: too short → every clip is
 * re-rendered from its own motion spec a little longer (the camera holds its last key; engine only, no
 * model call) and every still holds as long more.
 */
async function holdToFloor(ctx: DirectorContext, minSec: number): Promise<boolean> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: ctx.projectId }, include: { frames: { orderBy: { index: "asc" } } } });
  const fit = floorHold(project.frames.map((f) => timelineInputOf(f)), project.playbackSpeed, minSec);
  if (!fit) return false;
  let clips = 0;
  for (const f of project.frames) {
    throwIfCancelled(ctx);
    if (!f.motionSpec || !f.clipFrameCount) continue;
    const motion = JSON.parse(f.motionSpec) as { duration: number };
    await writeFrameMotion(f.id, { ...motion, duration: Math.round((motion.duration + fit.extra) * 1000) / 1000 });
    clips++;
  }
  await prisma.project.update({ where: { id: ctx.projectId }, data: { playbackSpeed: Math.round((project.playbackSpeed + fit.extra) * 10) / 10 } });
  const after = await prisma.project.findUniqueOrThrow({ where: { id: ctx.projectId }, include: { frames: { orderBy: { index: "asc" } } } });
  const measured = timelineDuration(buildTimeline(after.frames.map((x) => timelineInputOf(x)), after.playbackSpeed));
  await recordStep(ctx, {
    role: "editor",
    model: "engine",
    action: "hold-to-floor",
    summary: `The film ran ${fit.before.toFixed(1)} s, under its ${minSec} s floor: every shot holds ${fit.extra} s longer (${clips} clip(s) re-rendered from their own motion, stills ${after.playbackSpeed} s) → ${measured.toFixed(1)} s`,
  });
  return true;
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
 * A take on an approved preview's cast (owner 2026-10-12): the preview's library verbatim (every
 * symbol, prop state, set and lighting variant, kit character), its kits and set lighting; no Cast
 * call. The trace lists a short sha256 per reused symbol, the same list the preview sheet prints.
 */
async function castFromRun(ctx: DirectorContext, plan: Parameters<typeof runCast>[1], from: CastFromRun): Promise<CastLibrary> {
  await prisma.project.update({ where: { id: ctx.projectId }, data: { artworkDefs: from.library } });
  const hashes = castHashes(plan.cast, from.library);
  await recordStep(ctx, {
    role: "cast",
    model: "preview",
    action: "cast-from-run",
    summary: `Reused the approved cast of run ${from.sourceRunId}${from.edits ? ", with engine edits" : " verbatim"} (no Cast call): ${hashes.map((h) => `#${h.id} ${h.sha}`).join(" · ")}`,
    output: JSON.stringify({ sourceRunId: from.sourceRunId, hashes, ...(from.edits && { edits: from.edits }) }),
  });
  if (from.edits) await recordStep(ctx, { role: "cast", model: "engine", action: "cast-edits", summary: `Engine edits on the approved cast (D77): ${from.edits.report.join(" · ")}`, output: JSON.stringify(from.edits) });
  return { defs: from.library, symbols: symbolIds(from.library), placeholder: false, kits: new Map(from.kits), setTimes: from.setTimes };
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
  let setTimes: ReadonlyMap<string, string> | undefined;
  if (fresh.length) {
    const guests = await runCast(ctx, { ...plan, cast: fresh, shots: plan.shots.map((s) => ({ ...s, cast: s.cast.filter((id) => !recurring.has(id)) })) }, aspectRatio);
    defs = mergeLibraries(series.library, guests.defs);
    for (const [k, v] of guests.kits) kits.set(k, v);
    setTimes = guests.setTimes;
  }
  await prisma.project.update({ where: { id: ctx.projectId }, data: { artworkDefs: defs } });
  await recordStep(ctx, {
    role: "cast",
    model: "series",
    action: "series-cast",
    summary: `Series "${series.name}": reused ${plan.cast.filter((c) => recurring.has(c.id)).map((c) => c.id).join(", ") || "no"} verbatim (pixel-identical)${fresh.length ? `; drew new: ${fresh.map((c) => c.id).join(", ")}` : ""}`,
  });
  return { defs, symbols: symbolIds(defs), placeholder: false, kits, setTimes };
}
