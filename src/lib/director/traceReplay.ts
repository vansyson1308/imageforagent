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

export function traceToEvents(trace: Trace, assets: ReplayAssets = {}): TimedEvent[] {
  const t0 = Date.parse(trace.startedAt);
  const at = (iso: string) => Math.max(0, Date.parse(iso) - t0);
  const out: TimedEvent[] = [];
  out.push({ at: 0, event: { type: "run", runId: trace.id, projectId: trace.projectId, provider: trace.provider, models: trace.models, notes: trace.config?.modelNotes ?? [], startedAt: trace.startedAt } });

  const planStep = trace.steps.find((s) => s.role === "director" && s.action === "plan");
  const refStep = trace.steps.find((s) => s.role === "researcher" && s.action === "references");
  if (trace.bible?.references?.length) out.push({ at: refStep ? at(refStep.createdAt) : 0, event: { type: "research", references: trace.bible.references } });
  if (trace.bible?.shots) {
    out.push({
      at: planStep ? at(planStep.createdAt) + 1 : 0,
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
  for (const s of [...trace.steps].sort((a, b) => a.seq - b.seq)) {
    tokens += s.tokensIn + s.tokensOut;
    costUsd = Math.round((costUsd + s.costUsd) * 1e8) / 1e8;
    const imageUrl = s.imagePath ? (assets.snapshots?.[s.imagePath] ?? null) : null;
    out.push({
      at: at(s.createdAt),
      event: {
        type: "step",
        step: {
          seq: s.seq,
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
      out.push({ at: at(s.createdAt) + 1, event: { type: "frame", index: s.shotIndex, imageUrl: still, clipUrl: null, score: null, status: "done" } });
    }
  }
  const end = trace.finishedAt ? at(trace.finishedAt) : (out.at(-1)?.at ?? 0) + 1;
  if (trace.error) out.push({ at: end, event: { type: "error", message: trace.error } });
  out.push({ at: end + 1, event: { type: "done", status: trace.status, summary: trace.summary } });
  return out.sort((a, b) => a.at - b.at);
}

/** Events due at virtual time `ms` (real-speed ms × speed), from index `from`. */
export function dueEvents(events: readonly TimedEvent[], from: number, clockMs: number): { batch: DirectorEventLike[]; next: number } {
  let i = from;
  const batch: DirectorEventLike[] = [];
  while (i < events.length && events[i].at <= clockMs) batch.push(events[i++].event);
  return { batch, next: i };
}
