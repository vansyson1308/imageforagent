import { prisma } from "@/lib/db";
import { frameClipUrl, frameImageUrl } from "@/lib/services/dto";
import { logger } from "@/lib/services/logger";
import { BudgetExceededError, type DirectorBudget } from "@/lib/services/director/budget";
import type { DirectorEvent, RunSummary, StepEvent } from "@/lib/services/director/context";
import { executeRun, isRunLive, registerRun, unregisterRun, type DirectorDeps, type DirectorRequest } from "@/lib/services/director/loop";

/**
 * Runs that survive the browser (DECISIONS D26, replaces D9).
 *
 * A run executes server-side, detached from the request that started it, and
 * keeps persisting DirectorSteps. Any number of listeners can attach and
 * detach; closing a tab never cancels. Cancel is only `POST …/cancel`.
 * A wall-time watchdog aborts a run that is stuck inside a model call
 * (BudgetTracker only checks between calls).
 *
 * Still no queue and no polling: one in-process promise per run, one
 * listener set per run, and a reconnecting client replays the persisted
 * trace, then tails the live events (`GET …/runs/:runId/events`).
 */

type Listener = (e: DirectorEvent) => void;

interface HubEntry {
  readonly listeners: Set<Listener>;
  readonly done: Promise<RunSummary>;
}

const g = globalThis as unknown as { __directorHub?: Map<string, HubEntry> };
const hub = (g.__directorHub ??= new Map<string, HubEntry>());

/** Grace after maxWallMs before the watchdog aborts a run stuck inside a call. */
export const WATCHDOG_GRACE_MS = 60_000;

/**
 * Start a run detached from any request. Returns at once; `done` resolves
 * with the summary when the run finishes (tests and scripts await it).
 */
export function startDetachedRun(
  runId: string,
  req: DirectorRequest,
  deps: DirectorDeps,
  budget: DirectorBudget,
  /** Tests only: abort after this many ms instead of maxWallMs + grace. */
  opts: { watchdogMs?: number } = {},
): { done: Promise<RunSummary> } {
  const ctrl = registerRun(runId);
  const listeners = new Set<Listener>();
  const emit = (e: DirectorEvent) => {
    for (const l of listeners) {
      try {
        l(e);
      } catch {
        listeners.delete(l);
      }
    }
  };
  const watchdog = setTimeout(() => {
    logger.warn({ runId }, "director watchdog: wall time exceeded, aborting");
    ctrl.abort(new BudgetExceededError("wall", `Wall-time watchdog: the run passed ${Math.round(budget.maxWallMs / 1000)} s and was stopped.`));
  }, opts.watchdogMs ?? budget.maxWallMs + WATCHDOG_GRACE_MS);
  watchdog.unref?.();
  const done = executeRun(runId, req, deps, budget, emit, ctrl.signal)
    .catch(async (err: unknown) => {
      // executeRun records its own failures; this only guards a crash in its bookkeeping
      logger.error({ err, runId }, "director run crashed");
      await prisma.directorRun.update({ where: { id: runId }, data: { status: "failed", error: err instanceof Error ? err.message : String(err), finishedAt: new Date() } }).catch(() => {});
      const summary = await prisma.directorRun.findUnique({ where: { id: runId }, select: { summary: true } }).catch(() => null);
      const s = (summary?.summary ? JSON.parse(summary.summary) : { status: "failed" }) as RunSummary;
      emit({ type: "done", status: "failed", summary: s });
      return s;
    })
    .finally(() => {
      clearTimeout(watchdog);
      unregisterRun(runId);
      hub.delete(runId);
      listeners.clear();
    });
  hub.set(runId, { listeners, done });
  return { done };
}

/** Attach a listener to a live run. Returns null when the run is not live in this process. */
export function subscribeRun(runId: string, listener: Listener): (() => void) | null {
  const entry = hub.get(runId);
  if (!entry) return null;
  entry.listeners.add(listener);
  return () => entry.listeners.delete(listener);
}

/** Resolves when a live run finishes (null when it isn't live). */
export function runDone(runId: string): Promise<RunSummary> | null {
  return hub.get(runId)?.done ?? null;
}

/** When this server process started: runs older than this cannot be live here. */
const PROCESS_STARTED_AT = new Date(Date.now() - Math.round(process.uptime() * 1000));

/**
 * A run row that says "running", started before this process booted and has
 * no live promise here was orphaned by a restart. Mark it so the UI stops
 * waiting for it. (Runs started after boot are never reaped: another worker
 * process, e.g. a parallel test file, may own them.)
 */
export async function reapOrphanRuns(): Promise<number> {
  const rows = await prisma.directorRun.findMany({ where: { status: "running", startedAt: { lt: PROCESS_STARTED_AT } }, select: { id: true } });
  const orphans = rows.filter((r) => !isRunLive(r.id)).map((r) => r.id);
  if (!orphans.length) return 0;
  await prisma.directorRun.updateMany({
    where: { id: { in: orphans }, status: "running" },
    data: { status: "failed", error: "The server restarted before this run finished. Everything rendered so far is kept.", finishedAt: new Date() },
  });
  return orphans.length;
}

const parse = <T>(s: string | null): T | null => {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/**
 * Rebuild a run's event stream from the database: run → research → plan →
 * every persisted step → the current state of every frame → done (when
 * finished). This is what a reconnecting client sees first.
 */
export async function replayEvents(runId: string): Promise<{ events: DirectorEvent[]; lastSeq: number; finished: boolean } | null> {
  const run = await prisma.directorRun.findUnique({ where: { id: runId }, include: { steps: { orderBy: { seq: "asc" } } } });
  if (!run) return null;
  const events: DirectorEvent[] = [];
  const config = parse<{ budget: DirectorBudget; modelNotes?: string[] }>(run.config);
  const models = parse<DirectorEvent extends { type: "run"; models: infer M } ? M : never>(run.models);
  events.push({ type: "run", runId: run.id, projectId: run.projectId, provider: run.provider, models: models!, notes: config?.modelNotes ?? [], budget: config!.budget, startedAt: run.startedAt.toISOString() });
  const bible = parse<{ title?: string; logline?: string; shots?: Array<{ shotType: string; description: string; mode: string; dialogue?: string | null; cites?: number[] }>; references?: Array<{ note: string; url: string; title: string; use?: string }> }>(run.bible);
  if (bible?.references?.length) events.push({ type: "research", references: bible.references });
  if (bible?.shots) {
    events.push({
      type: "plan",
      title: bible.title ?? "",
      logline: bible.logline ?? "",
      shots: bible.shots.map((s, i) => ({ index: i + 1, shotType: s.shotType, description: s.description, mode: s.mode, dialogue: s.dialogue ?? null, cites: s.cites ?? [] })),
    });
  }
  let tokens = 0;
  let costUsd = 0;
  let lastSeq = -1;
  for (const s of run.steps) {
    tokens += s.tokensIn + s.tokensOut;
    costUsd = Math.round((costUsd + s.costUsd) * 1e8) / 1e8;
    lastSeq = s.seq;
    const step: StepEvent = {
      seq: s.seq,
      role: s.role as StepEvent["role"],
      model: s.model,
      action: s.action,
      shotIndex: s.shotIndex,
      attempt: s.attempt,
      summary: clip(s.outputSummary ?? s.action, 300),
      score: s.critiqueScore,
      tokensIn: s.tokensIn,
      tokensOut: s.tokensOut,
      costUsd: s.costUsd,
      latencyMs: s.latencyMs,
      imageUrl: s.imagePath ? `/api/files/${s.imagePath}` : null,
      error: s.error ? clip(s.error, 400) : null,
    };
    events.push({ type: "step", step, totals: { tokens, costUsd } });
  }
  if (bible?.shots) {
    const frames = await prisma.frame.findMany({ where: { projectId: run.projectId }, orderBy: { index: "asc" } });
    for (const f of frames) {
      // only frames rendered by THIS run (a re-run replaces the script; older renders are stale)
      if (!f.generatedAt || f.generatedAt < run.startedAt) continue;
      events.push({ type: "frame", index: f.index, imageUrl: frameImageUrl(f), clipUrl: frameClipUrl(f), score: null, status: f.status });
    }
  }
  const finished = run.status !== "running";
  if (finished) {
    if (run.error) events.push({ type: "error", message: run.error });
    const summary = parse<RunSummary>(run.summary);
    events.push({ type: "done", status: run.status, summary: summary ?? ({ status: run.status } as RunSummary) });
  }
  return { events, lastSeq, finished };
}

const enc = new TextEncoder();
export const sseChunk = (e: DirectorEvent) => enc.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
  "X-Content-Type-Options": "nosniff",
} as const;

/**
 * An SSE stream over a run: optional replay of the persisted trace, then the
 * live tail. Closing the stream only detaches this listener; the run goes on.
 */
export function runEventStream(runId: string, opts: { replay: boolean }): ReadableStream<Uint8Array> {
  let unsubscribe: (() => void) | null = null;
  let ping: ReturnType<typeof setInterval> | null = null;
  let open = true;
  const close = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (!open) return;
    open = false;
    unsubscribe?.();
    if (ping) clearInterval(ping);
    try {
      controller.close();
    } catch {
      // already closed
    }
  };
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: DirectorEvent) => {
        if (!open) return;
        try {
          controller.enqueue(sseChunk(e));
        } catch {
          open = false;
        }
      };
      // Subscribe BEFORE reading the DB, buffer live events, then drop the ones the replay already covered.
      const buffered: DirectorEvent[] = [];
      let replaying = opts.replay;
      let lastSeq = -1;
      const onLive = (e: DirectorEvent) => {
        if (replaying) {
          buffered.push(e);
          return;
        }
        if (e.type === "step" && e.step.seq <= lastSeq) return;
        send(e);
        if (e.type === "done") close(controller);
      };
      unsubscribe = subscribeRun(runId, onLive);
      const live = unsubscribe !== null;
      if (opts.replay) {
        const r = await replayEvents(runId);
        if (!r) {
          send({ type: "error", message: "Run not found." });
          close(controller);
          return;
        }
        lastSeq = r.lastSeq;
        const finishedNow = r.finished || !live;
        for (const e of r.events) {
          if (!finishedNow && (e.type === "done" || e.type === "error")) continue;
          send(e);
        }
        replaying = false;
        if (finishedNow) {
          // A run that is "running" in the DB but not live here was orphaned; say so once.
          if (!r.finished) {
            send({ type: "error", message: "This run is no longer active on the server (it may have restarted). Everything rendered so far is kept." });
            send({ type: "done", status: "failed", summary: null });
          }
          close(controller);
          return;
        }
        for (const e of buffered.splice(0)) onLive(e);
      } else if (!live) {
        close(controller);
        return;
      }
      ping = setInterval(() => {
        if (!open) return;
        try {
          controller.enqueue(enc.encode(": keep-alive\n\n"));
        } catch {
          open = false;
        }
      }, 15_000);
    },
    cancel() {
      open = false;
      unsubscribe?.();
      if (ping) clearInterval(ping);
    },
  });
}
