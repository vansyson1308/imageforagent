import type { DirectorEventLike } from "@/lib/director/runState";

/**
 * Turn a stored run trace (`GET …/runs/:runId`, the showcase `trace.json`)
 * back into the timed event stream the live UI consumes, so a judge can
 * watch a REAL run replayed at 10× through the same run view without
 * spending tokens (SPEC v2 WP1.4). Pure: no fetch, no timers.
 *
 * Images: trace snapshot URLs point at `/api/files/…` (demo-gated). The
 * showcase ships public stills per shot (and, for v2 films, the critic
 * snapshots), passed in as `assets`.
 */

export interface TraceStep {
  /** the run that recorded the step: a published film's trace holds every take of its project */
  runId?: string;
  seq: number;
  shotIndex: number | null;
  role: string;
  model: string;
  action: string;
  outputSummary: string | null;
  critiqueScore: number | null;
  attempt: number;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  imagePath?: string | null;
  error: string | null;
  createdAt: string;
}

export interface Trace {
  id: string;
  projectId: string;
  provider: string;
  status: string;
  models: Record<string, string>;
  config?: { modelNotes?: string[]; budget?: unknown } | null;
  bible: { title?: string; logline?: string; shots?: Array<{ shotType: string; description: string; mode: string; dialogue?: string | null; cites?: number[] }>; references?: Array<{ note: string; url: string; title: string; use?: string }> } | null;
  summary: Record<string, unknown> | null;
  error?: string | null;
  startedAt: string;
  finishedAt: string | null;
  steps: TraceStep[];
}

export interface ReplayAssets {
  /** public still per shot index (1-based) */
  readonly shots?: Record<number, string>;
  /** public copy of a step snapshot, keyed by the trace's `imagePath` */
  readonly snapshots?: Record<string, string>;
}

export interface TimedEvent {
  /** ms since the run started, at real speed */
  readonly at: number;
  readonly event: DirectorEventLike;
}

/** Real time between two takes is idle (people looking at a contact sheet); the replay keeps a short pause instead. */
export const TAKE_GAP_MS = 3000;

export interface Take {
  readonly runId: string;
  /** ms since epoch */
  readonly start: number;
  readonly end: number;
  readonly steps: number;
  readonly tokens: number;
  readonly costUsd: number;
}

/**
 * The takes of a film, in the order they ran. A film made in several takes
 * (a first run, then redos of some shots, D77/D81) stores every take's steps
 * in one trace, while `startedAt`/`finishedAt`/`summary` describe only the
 * last one. A take spans its first to last step; the trace's own run uses
 * its recorded start and finish.
 */
export function traceTakes(trace: Trace): Take[] {
  const by = new Map<string, { start: number; end: number; steps: number; tokens: number; costUsd: number }>();
  for (const s of trace.steps) {
    const id = s.runId ?? trace.id;
    const t = Date.parse(s.createdAt);
    const r = by.get(id) ?? { start: t, end: t, steps: 0, tokens: 0, costUsd: 0 };
    r.start = Math.min(r.start, t);
    r.end = Math.max(r.end, t);
    r.steps++;
    r.tokens += s.tokensIn + s.tokensOut;
    r.costUsd = Math.round((r.costUsd + s.costUsd) * 1e8) / 1e8;
    by.set(id, r);
  }
  const own = by.get(trace.id) ?? { start: Date.parse(trace.startedAt), end: Date.parse(trace.startedAt), steps: 0, tokens: 0, costUsd: 0 };
  own.start = Math.min(own.start, Date.parse(trace.startedAt));
  if (trace.finishedAt) own.end = Math.max(own.end, Date.parse(trace.finishedAt));
  by.set(trace.id, own);
  return [...by.entries()].map(([runId, r]) => ({ runId, ...r })).sort((a, b) => a.start - b.start || a.runId.localeCompare(b.runId));
}

/**
 * What making the whole film took: every run's tokens and cost, and the sum of
 * the runs' times (idle time between runs excluded). A run that records a
 * `redo` step is a single-shot redo (D84: only the named shots are redrawn on
 * the take's plan and cast); every other run is a take.
 */
export function filmTotals(trace: Trace): { runs: number; redos: number; tokens: number; costUsd: number; wallMs: number } {
  const takes = traceTakes(trace);
  const redoRuns = new Set(trace.steps.filter((s) => s.role === "system" && s.action === "redo").map((s) => s.runId ?? trace.id));
  return {
    runs: takes.length,
    redos: takes.filter((t) => redoRuns.has(t.runId)).length,
    tokens: takes.reduce((a, t) => a + t.tokens, 0),
    costUsd: Math.round(takes.reduce((a, t) => a + t.costUsd, 0) * 1e8) / 1e8,
    wallMs: takes.reduce((a, t) => a + (t.end - t.start), 0),
  };
}

/** "4 runs (1 take + 3 single-shot redos)" in the viewer's language. */
export function runsLabel(lang: "en" | "vi" | "ja", runs: number, redos: number): string {
  const takes = runs - redos;
  if (lang === "vi") return `${runs} lượt chạy (${takes} lượt quay + ${redos} lượt làm lại từng cảnh)`;
  if (lang === "ja") return `${runs}回の実行（本番${takes}回＋ショット単位のやり直し${redos}回）`;
  return `${runs} runs (${takes} take${takes === 1 ? "" : "s"} + ${redos} single-shot redo${redos === 1 ? "" : "s"})`;
}

export function traceToEvents(trace: Trace, assets: ReplayAssets = {}): TimedEvent[] {
  // one clock over every take, in order, with a short pause between takes
  const takes = traceTakes(trace);
  const offset = new Map<string, { start: number; at: number }>();
  let cursor = 0;
  for (const t of takes) {
    offset.set(t.runId, { start: t.start, at: cursor });
    cursor += t.end - t.start + TAKE_GAP_MS;
  }
  const own = offset.get(trace.id)!;
  const take = (s: TraceStep) => s.runId ?? trace.id;
  const at = (iso: string, runId: string = trace.id) => {
    const o = offset.get(runId) ?? own;
    return o.at + Math.max(0, Date.parse(iso) - o.start);
  };
  const out: TimedEvent[] = [];
  out.push({ at: 0, event: { type: "run", runId: trace.id, projectId: trace.projectId, provider: trace.provider, models: trace.models, notes: trace.config?.modelNotes ?? [], startedAt: trace.startedAt } });

  const planStep = trace.steps.find((s) => s.role === "director" && s.action === "plan");
  const refStep = trace.steps.find((s) => s.role === "researcher" && s.action === "references");
  if (trace.bible?.references?.length) out.push({ at: refStep ? at(refStep.createdAt, take(refStep)) : 0, event: { type: "research", references: trace.bible.references } });
  if (trace.bible?.shots) {
    out.push({
      at: planStep ? at(planStep.createdAt, take(planStep)) + 1 : 0,
      event: {
        type: "plan",
        title: trace.bible.title ?? "",
        logline: trace.bible.logline ?? "",
        shots: trace.bible.shots.map((s, i) => ({ index: i + 1, shotType: s.shotType, description: s.description, mode: s.mode, dialogue: s.dialogue ?? null, cites: s.cites ?? [] })),
      },
    });
  }

  let tokens = 0;
  let costUsd = 0;
  // each take numbers its steps from 0; the replay numbers them across takes (the reducer keys steps by seq)
  const order = new Map(takes.map((t, i) => [t.runId, i]));
  const base = new Map<string, number>();
  let next = 0;
  for (const t of takes) {
    base.set(t.runId, next);
    next += Math.max(-1, ...trace.steps.filter((x) => take(x) === t.runId).map((x) => x.seq)) + 1;
  }
  for (const s of [...trace.steps].sort((a, b) => order.get(take(a))! - order.get(take(b))! || a.seq - b.seq)) {
    tokens += s.tokensIn + s.tokensOut;
    costUsd = Math.round((costUsd + s.costUsd) * 1e8) / 1e8;
    const imageUrl = s.imagePath ? (assets.snapshots?.[s.imagePath] ?? null) : null;
    const when = at(s.createdAt, take(s));
    out.push({
      at: when,
      event: {
        type: "step",
        step: {
          seq: base.get(take(s))! + s.seq,
          role: s.role,
          model: s.model,
          action: s.action,
          shotIndex: s.shotIndex,
          attempt: s.attempt,
          summary: s.outputSummary ?? s.action,
          score: s.critiqueScore,
          tokensIn: s.tokensIn,
          tokensOut: s.tokensOut,
          costUsd: s.costUsd,
          latencyMs: s.latencyMs,
          imageUrl,
          error: s.error,
        },
        totals: { tokens, costUsd },
      },
    });
    if (s.shotIndex && (s.action === "render-clip" || s.action === "render-still")) {
      const still = assets.shots?.[s.shotIndex] ?? null;
      out.push({ at: when + 1, event: { type: "frame", index: s.shotIndex, imageUrl: still, clipUrl: null, score: null, status: "done" } });
    }
  }
  const end = Math.max(trace.finishedAt ? at(trace.finishedAt) : 0, (out.at(-1)?.at ?? 0) + 1);
  if (trace.error) out.push({ at: end, event: { type: "error", message: trace.error } });
  // a film made in several takes: the finished card shows what the whole film took, not the last take
  const summary = takes.length > 1 && trace.summary ? { ...trace.summary, ...filmTotals(trace) } : trace.summary;
  out.push({ at: end + 1, event: { type: "done", status: trace.status, summary } });
  return out.sort((a, b) => a.at - b.at);
}

/** Events due at virtual time `ms` (real-speed ms × speed), from index `from`. */
export function dueEvents(events: readonly TimedEvent[], from: number, clockMs: number): { batch: DirectorEventLike[]; next: number } {
  let i = from;
  const batch: DirectorEventLike[] = [];
  while (i < events.length && events[i].at <= clockMs) batch.push(events[i++].event);
  return { batch, next: i };
}
