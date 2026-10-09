"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { emptyRun, reduceRun, type DirectorEventLike, type RunState } from "@/lib/director/runState";

/**
 * One Director run in the browser (D26). `start` POSTs a new run and reads
 * its stream; if the stream drops before `done` (tab slept, network blip,
 * proxy timeout) the hook re-attaches with `GET …/runs/:runId/events`,
 * which replays the persisted trace and tails the live events. Backoff:
 * 1 s, 2 s, 4 s … capped at 30 s, and an immediate retry when the browser
 * comes back online or the tab becomes visible. Unmounting only stops
 * listening; the run keeps going on the server. On mount the hook restores
 * the project's latest run (live or finished).
 */

export type ConnState = "idle" | "live" | "reconnecting" | "closed";

type Action = { kind: "event"; e: DirectorEventLike } | { kind: "reset" };

function reducer(s: RunState, a: Action): RunState {
  return a.kind === "reset" ? emptyRun() : reduceRun(s, a.e);
}

export async function readSse(res: Response, onEvent: (e: DirectorEventLike) => void, signal?: AbortSignal): Promise<boolean> {
  if (!res.body) return false;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let sawDone = false;
  const abort = () => reader.cancel().catch(() => {});
  signal?.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const data = chunk.match(/^data: (.+)$/m)?.[1];
        if (!data) continue;
        const e = JSON.parse(data) as DirectorEventLike;
        if (e.type === "done") sawDone = true;
        onEvent(e);
      }
    }
  } finally {
    signal?.removeEventListener("abort", abort);
  }
  return sawDone;
}

async function errorText(res: Response): Promise<string> {
  const body = await res.json().catch(() => null);
  return body?.error ? `${body.error.message}${body.error.hint ? ` ${body.error.hint}` : ""}` : `HTTP ${res.status}`;
}

export interface StartBody {
  story: string;
  language: string;
  style: string;
  maxShots: number;
  critic: boolean;
  research: boolean | "auto";
  seriesId?: string | null;
}

export function useDirectorRun(projectId: string | undefined) {
  const [state, dispatch] = useReducer(reducer, undefined, emptyRun);
  const [conn, setConn] = useState<ConnState>("idle");
  const [startError, setStartError] = useState<string | null>(null);
  const streamAbort = useRef<AbortController | null>(null);
  const wake = useRef<(() => void) | null>(null);
  const mounted = useRef(true);

  const onEvent = useCallback((e: DirectorEventLike) => dispatch({ kind: "event", e }), []);

  /** Attach to a run until it is done (replay + tail, reconnecting on drops). */
  const attach = useCallback(
    async (pid: string, runId: string) => {
      streamAbort.current?.abort();
      const ctrl = new AbortController();
      streamAbort.current = ctrl;
      let delay = 1000;
      while (mounted.current && !ctrl.signal.aborted) {
        try {
          setConn("live");
          const res = await fetch(`/api/projects/${pid}/director/runs/${runId}/events`, { signal: ctrl.signal, cache: "no-store" });
          if (res.status === 404 || res.status === 401) {
            setStartError(await errorText(res));
            break;
          }
          if (res.ok && (await readSse(res, onEvent, ctrl.signal))) break;
        } catch {
          if (ctrl.signal.aborted) break;
        }
        if (ctrl.signal.aborted) break;
        setConn("reconnecting");
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, delay);
          wake.current = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        wake.current = null;
        delay = Math.min(delay * 2, 30_000);
      }
      if (streamAbort.current === ctrl) setConn("closed");
    },
    [onEvent],
  );

  const start = useCallback(
    async (body: StartBody): Promise<string | null> => {
      if (!projectId) return null;
      setStartError(null);
      streamAbort.current?.abort();
      dispatch({ kind: "reset" });
      const ctrl = new AbortController();
      streamAbort.current = ctrl;
      setConn("live");
      let runId: string | null = null;
      try {
        const res = await fetch(`/api/projects/${projectId}/director`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(await errorText(res));
        runId = res.headers.get("x-director-run");
        const finished = await readSse(res, onEvent, ctrl.signal);
        if (finished) {
          setConn("closed");
          return runId;
        }
      } catch (e) {
        if (!runId) {
          setStartError(e instanceof Error ? e.message : String(e));
          setConn("idle");
          return null;
        }
      }
      if (runId && mounted.current && !ctrl.signal.aborted) void attach(projectId, runId);
      return runId;
    },
    [projectId, onEvent, attach],
  );

  const cancel = useCallback(async () => {
    if (!projectId || !state.runId) return;
    await fetch(`/api/projects/${projectId}/director/runs/${state.runId}/cancel`, { method: "POST" }).catch(() => {});
  }, [projectId, state.runId]);

  // Restore the latest run of this project on mount (live → attach; finished → replay).
  useEffect(() => {
    mounted.current = true;
    if (!projectId) return;
    let stop = false;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/director`, { cache: "no-store" });
        if (!res.ok || stop) return;
        const { runs } = (await res.json()) as { runs: Array<{ id: string }> };
        if (runs[0] && !stop) void attach(projectId, runs[0].id);
      } catch {
        // no runs → empty panel
      }
    })();
    return () => {
      stop = true;
    };
  }, [projectId, attach]);

  // Retry right away when the network or the tab comes back.
  useEffect(() => {
    const kick = () => {
      if (document.visibilityState === "visible") wake.current?.();
    };
    window.addEventListener("online", kick);
    document.addEventListener("visibilitychange", kick);
    return () => {
      window.removeEventListener("online", kick);
      document.removeEventListener("visibilitychange", kick);
    };
  }, []);

  // Unmount: stop listening (never cancels the run).
  useEffect(
    () => () => {
      mounted.current = false;
      streamAbort.current?.abort();
    },
    [],
  );

  return { state, conn, startError, start, attach, cancel, running: !!state.runId && !state.finished };
}
