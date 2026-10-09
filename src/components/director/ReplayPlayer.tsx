"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import Link from "next/link";
import { emptyRun, reduceRun, type DirectorEventLike, type RunState } from "@/lib/director/runState";
import { dueEvents, traceToEvents, type ReplayAssets, type Trace } from "@/lib/director/traceReplay";
import { LangToggle, useLang } from "@/lib/i18n";
import { RunView } from "@/components/director/RunView";

type Action = { kind: "events"; batch: DirectorEventLike[] } | { kind: "reset" };
const reducer = (s: RunState, a: Action) => (a.kind === "reset" ? emptyRun() : a.batch.reduce(reduceRun, s));

const SPEEDS = [10, 30] as const;

/** Plays a recorded run through the live run view on a virtual clock. */
export function ReplayPlayer({ trace, film, title, assets }: { trace: Trace; film: string; title: string; assets: ReplayAssets }) {
  const [lang, setLang] = useLang();
  const events = useMemo(() => traceToEvents(trace, assets), [trace, assets]);
  const [state, dispatch] = useReducer(reducer, undefined, emptyRun);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(10);
  const [clock, setClock] = useState(0);
  const [playing, setPlaying] = useState(true);
  const cursor = useRef(0);
  const clockRef = useRef(0);
  const total = events.at(-1)?.at ?? 0;

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      clockRef.current = Math.min(total, clockRef.current + (now - last) * speed);
      last = now;
      const { batch, next } = dueEvents(events, cursor.current, clockRef.current);
      cursor.current = next;
      if (batch.length) dispatch({ kind: "events", batch });
      setClock(clockRef.current);
      if (next >= events.length) setPlaying(false);
    }, 100);
    return () => clearInterval(id);
  }, [playing, speed, events, total]);

  function restart() {
    cursor.current = 0;
    clockRef.current = 0;
    setClock(0);
    dispatch({ kind: "reset" });
    setPlaying(true);
  }

  function skip() {
    const { batch } = dueEvents(events, cursor.current, total);
    cursor.current = events.length;
    clockRef.current = total;
    setClock(total);
    dispatch({ kind: "events", batch });
    setPlaying(false);
  }

  const pct = total ? Math.round((clock / total) * 100) : 100;
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-8">
      <header className="flex flex-wrap items-center gap-3">
        <Link href="/showcase" className="rounded-xl border border-line px-3 py-2 text-sm text-muted hover:border-accent hover:text-ink">
          ← Showcase
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold">Replay: {title}</h1>
          <p className="text-sm text-muted">
            A real run of the Nemotron crew, replayed from its stored trace at {speed}× (no models are called). Times, tokens and costs are the recorded ones.
          </p>
        </div>
        <LangToggle lang={lang} setLang={setLang} />
      </header>
      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        <button onClick={() => setPlaying((p) => !p)} disabled={clock >= total && !playing} className="rounded-lg border border-line px-3 py-1.5 hover:border-accent">
          {playing ? "⏸ Pause" : "▶ Play"}
        </button>
        <button onClick={restart} className="rounded-lg border border-line px-3 py-1.5 hover:border-accent">
          ↺ Restart
        </button>
        <button onClick={skip} className="rounded-lg border border-line px-3 py-1.5 hover:border-accent">
          ⏭ Skip to the film
        </button>
        {SPEEDS.map((s) => (
          <button key={s} onClick={() => setSpeed(s)} aria-pressed={speed === s} className={`rounded-lg border px-3 py-1.5 ${speed === s ? "border-accent bg-accent/20" : "border-line"}`}>
            {s}×
          </button>
        ))}
        <div className="ml-auto h-2 w-48 overflow-hidden rounded-full bg-card-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Replay progress">
          <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <RunView state={state} lang={lang} mode="replay" clockMs={clock} filmSrc={film} downloads={false} />
    </main>
  );
}
