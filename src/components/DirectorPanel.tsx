"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "@/lib/store/useAppStore";
import { t, useLang, type Lang } from "@/lib/i18n";

/* eslint-disable @next/next/no-img-element */

/**
 * DirectorPanel: story in, film out. POSTs to /api/projects/:id/director
 * and reads the Server-Sent Events stream with fetch (EventSource can't
 * POST). It renders the live crew timeline, per-shot thumbnails with the
 * critic's before → after scores, token/cost counters, and when the run is
 * done, the MP4 player plus downloads.
 */

interface Step {
  seq: number;
  role: string;
  model: string;
  action: string;
  shotIndex: number | null;
  attempt: number;
  summary: string;
  score: number | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
  imageUrl: string | null;
  error: string | null;
}

interface ShotView {
  index: number;
  shotType: string;
  description: string;
  mode: string;
  dialogue: string | null;
  imageUrl: string | null;
  clipUrl: string | null;
  scores: number[];
  status: string;
}

interface Summary {
  status: string;
  shots: number;
  rendered: number;
  firstPassOk: number;
  repairs: number;
  criticBefore: number | null;
  criticAfter: number | null;
  revisions: number;
  lintErrors: number;
  lintWarnings: number;
  durationSec: number;
  wallMs: number;
  tokens: number;
  costUsd: number;
  continuity: string[];
  textCritic: boolean;
}

interface Reference {
  note: string;
  url: string;
  title: string;
}

const ROLE_STYLE: Record<string, { icon: string; label: string; color: string }> = {
  researcher: { icon: "🔎", label: "Researcher", color: "#38bdf8" },
  director: { icon: "🎬", label: "Director", color: "#f59e0b" },
  cast: { icon: "🎭", label: "Cast", color: "#a78bfa" },
  artist: { icon: "🖌️", label: "Artist", color: "#ec4899" },
  critic: { icon: "👁️", label: "Critic", color: "#34d399" },
  editor: { icon: "✂️", label: "Editor", color: "#60a5fa" },
  dialogue: { icon: "🎙️", label: "Voice", color: "#fbbf24" },
  system: { icon: "⚙️", label: "Engine", color: "#8b8b98" },
};

const LANGS: Array<[string, string]> = [
  ["en", "English"],
  ["vi", "Tiếng Việt"],
  ["ja", "日本語"],
  ["zh", "中文"],
  ["ko", "한국어"],
  ["fr", "Français"],
  ["es", "Español"],
  ["id", "Bahasa Indonesia"],
];

const shortModel = (m: string) => m.replace(/^nvidia\//i, "").replace(/^mock-/, "mock:");

const statusKey = (s: string) =>
  (s === "done" ? "status_done" : s === "cancelled" ? "status_cancelled" : s === "budget_exceeded" ? "status_budget_exceeded" : "status_failed") as
    | "status_done"
    | "status_cancelled"
    | "status_budget_exceeded"
    | "status_failed";

export function DirectorPanel() {
  const project = useAppStore((s) => s.project);
  const frames = useAppStore((s) => s.frames);
  const meta = useAppStore((s) => s.meta);
  const hydrate = useAppStore((s) => s.hydrate);
  const [lang] = useLang();

  const [story, setStory] = useState("");
  const [filmLang, setFilmLang] = useState("en");
  const [style, setStyle] = useState("storybook");
  const [maxShots, setMaxShots] = useState(8);
  const [critic, setCritic] = useState(true);
  const [research, setResearch] = useState(false);

  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [shots, setShots] = useState<ShotView[]>([]);
  const [title, setTitle] = useState<string | null>(null);
  const [totals, setTotals] = useState({ tokens: 0, costUsd: 0 });
  const [summary, setSummary] = useState<Summary | null>(null);
  const [references, setReferences] = useState<Reference[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [filmVersion, setFilmVersion] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const director = meta?.director;
  const styles = director?.styles ?? ["storybook", "flat", "ink", "neon", "papercut"];
  const projectId = project?.id;

  // Ticking clock while a run is live (for the elapsed counter)
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  // Rehydrate the latest run of this project (trace survives a reload)
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/director`);
        if (!res.ok) return;
        const { runs } = (await res.json()) as { runs: Array<{ id: string; status: string; live: boolean }> };
        const last = runs[0];
        if (!last || last.live) return;
        const trace = await (await fetch(`/api/projects/${projectId}/director/runs/${last.id}`)).json();
        if (cancelled) return;
        setRunId(trace.id);
        setProvider(trace.provider);
        setStatus(trace.status);
        setSummary(trace.summary);
        setTitle(trace.bible?.title ?? null);
        setReferences(trace.bible?.references ?? []);
        setSteps(
          (trace.steps as Array<Step & { critiqueScore: number | null; outputSummary: string | null }>).map((s) => ({
            ...s,
            score: s.critiqueScore,
            summary: s.outputSummary ?? s.action,
          })),
        );
        setTotals({ tokens: trace.tokensIn + trace.tokensOut, costUsd: trace.costUsd });
      } catch {
        // no trace → empty panel
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Shot cards from the plan + live frame events, falling back to the store's frames after reload
  const shotCards: ShotView[] = useMemo(() => {
    if (shots.length) return shots;
    const scoreByShot = new Map<number, number[]>();
    for (const s of steps) if (s.action === "score" && s.shotIndex && s.score !== null) scoreByShot.set(s.shotIndex, [...(scoreByShot.get(s.shotIndex) ?? []), s.score]);
    if (!runId) return [];
    return frames.map((f) => ({
      index: f.index,
      shotType: f.shotType,
      description: f.description,
      mode: f.clipUrl ? "motion" : "still",
      dialogue: f.dialogue ?? null,
      imageUrl: f.imageUrl,
      clipUrl: f.clipUrl ?? null,
      scores: scoreByShot.get(f.index) ?? [],
      status: f.status,
    }));
  }, [shots, steps, frames, runId]);

  async function start() {
    if (!projectId || running) return;
    if (frames.some((f) => f.status === "done") && !window.confirm(t(lang, "confirmReplace"))) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRunning(true);
    setError(null);
    setSteps([]);
    setShots([]);
    setSummary(null);
    setReferences([]);
    setTitle(null);
    setTotals({ tokens: 0, costUsd: 0 });
    setStartedAt(Date.now());
    setNow(Date.now());
    setStatus("…");
    try {
      const res = await fetch(`/api/projects/${projectId}/director`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ story, language: filmLang, style, maxShots, critic, research }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ? `${body.error.message}${body.error.hint ? ` ${body.error.hint}` : ""}` : `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = chunk.match(/^data: (.+)$/m)?.[1];
          if (data) onEvent(JSON.parse(data));
        }
      }
    } catch (e) {
      if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
      abortRef.current = null;
      await hydrate();
      setFilmVersion((v) => v + 1);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function onEvent(e: any) {
    switch (e.type) {
      case "run":
        setRunId(e.runId);
        setProvider(e.provider);
        break;
      case "status":
        setStatus(e.message);
        break;
      case "plan":
        setTitle(e.title);
        setShots(e.shots.map((s: ShotView) => ({ ...s, imageUrl: null, clipUrl: null, scores: [], status: "draft" })));
        break;
      case "research":
        setReferences(e.references);
        break;
      case "step":
        setSteps((prev) => [...prev, e.step]);
        setTotals(e.totals);
        if (e.step.action === "score" && e.step.shotIndex) {
          setShots((prev) => prev.map((s) => (s.index === e.step.shotIndex ? { ...s, scores: [...s.scores, e.step.score] } : s)));
        }
        break;
      case "frame":
        setShots((prev) => prev.map((s) => (s.index === e.index ? { ...s, imageUrl: e.imageUrl, clipUrl: e.clipUrl, status: e.status } : s)));
        break;
      case "error":
        setError(e.message);
        break;
      case "done":
        setStatus(e.status);
        setSummary(e.summary);
        break;
    }
  }

  async function cancel() {
    if (runId && projectId) await fetch(`/api/projects/${projectId}/director/runs/${runId}/cancel`, { method: "POST" }).catch(() => {});
    abortRef.current?.abort();
  }

  if (!project) return null;

  const elapsed = startedAt && running ? Math.max(0, Math.round((now - startedAt) / 1000)) : summary ? Math.round(summary.wallMs / 1000) : 0;
  const filmReady = !running && summary && summary.rendered > 0;

  return (
    <section className="fade-up rounded-card border border-accent/40 bg-card p-6 shadow-lg shadow-accent/10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-bold">✨ {t(lang, "directorTitle")}</h2>
          <p className="mt-0.5 max-w-3xl text-sm text-muted">{t(lang, "directorSub")}</p>
        </div>
        {director?.models && (
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            {(["strong", "mid", "vision", "fast"] as const).map((k) => (
              <span key={k} className="rounded-full border border-line bg-card-2 px-2 py-0.5 text-muted" title={director.models?.[k] || "auto"}>
                {{ strong: "🎬 Ultra", mid: "🖌️ Super", vision: "👁️ Omni", fast: "✂️ Nano" }[k]}
              </span>
            ))}
          </div>
        )}
      </div>

      {!director?.enabled ? (
        <p className="mt-4 rounded-xl border border-line bg-card-2 p-3 text-sm text-muted">{t(lang, "disabled")}</p>
      ) : (
        <>
          {director.provider === "mock" && <p className="mt-3 text-xs text-amber-300">{t(lang, "mockNote")}</p>}
          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_280px]">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">{t(lang, "storyLabel")}</span>
              <textarea
                value={story}
                onChange={(e) => setStory(e.target.value)}
                placeholder={t(lang, "storyPlaceholder")}
                rows={6}
                maxLength={6000}
                disabled={running}
                className="mt-1 w-full resize-y rounded-xl border border-line bg-bg p-3 text-sm outline-none focus:border-accent"
              />
            </label>
            <div className="flex flex-col gap-3 text-sm">
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted">{t(lang, "filmLanguage")}</span>
                <select value={filmLang} onChange={(e) => setFilmLang(e.target.value)} disabled={running} className="mt-1 w-full rounded-lg border border-line bg-bg px-2 py-1.5">
                  {LANGS.map(([code, name]) => (
                    <option key={code} value={code}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <div>
                <span className="text-xs font-semibold uppercase tracking-wide text-muted">{t(lang, "style")}</span>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {styles.map((s) => (
                    <button
                      key={s}
                      disabled={running}
                      onClick={() => setStyle(s)}
                      className={`rounded-lg border px-2.5 py-1 text-xs transition ${style === s ? "border-accent bg-accent/20 text-ink" : "border-line text-muted hover:text-ink"}`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex items-center justify-between gap-2">
                <span className="text-muted">
                  {t(lang, "shots")}: <b className="text-ink">{maxShots}</b>
                </span>
                <input type="range" min={3} max={12} value={maxShots} disabled={running} onChange={(e) => setMaxShots(Number(e.target.value))} />
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={critic} disabled={running} onChange={(e) => setCritic(e.target.checked)} />
                <span>{t(lang, "critic")}</span>
              </label>
              <label className={`flex items-center gap-2 ${director.research ? "" : "opacity-40"}`}>
                <input type="checkbox" checked={research && !!director.research} disabled={running || !director.research} onChange={(e) => setResearch(e.target.checked)} />
                <span>{t(lang, "research")}</span>
              </label>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button onClick={start} disabled={running || story.trim().length < 20} className="btn-gradient rounded-xl px-5 py-2.5 text-sm font-bold text-white">
              {t(lang, "make")}
            </button>
            {running && (
              <button onClick={cancel} className="rounded-xl border border-line px-4 py-2 text-sm text-muted hover:border-rose-400 hover:text-rose-300">
                {t(lang, "cancel")}
              </button>
            )}
            {(running || steps.length > 0) && (
              <span className="text-xs text-muted">
                {running ? <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400" /> : null}
                {status && !running ? t(lang, statusKey(status)) : status} · {totals.tokens.toLocaleString()} {t(lang, "tokens")} · ${totals.costUsd.toFixed(4)} · {elapsed}s {t(lang, "elapsed")}
                {provider ? ` · ${provider}` : ""}
              </span>
            )}
          </div>
          {error && <p className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-2 text-sm text-rose-300">{error}</p>}
        </>
      )}

      {title && <h3 className="mt-6 text-base font-bold">🎞 {title}</h3>}

      {shotCards.length > 0 && (
        <div className="mt-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">{t(lang, "shotsTitle")}</h4>
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {shotCards.map((s) => (
              <ShotCard key={s.index} shot={s} />
            ))}
          </div>
        </div>
      )}

      {references.length > 0 && (
        <div className="mt-5">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">{t(lang, "references")}</h4>
          <ul className="mt-2 space-y-1 text-sm">
            {references.map((r, i) => (
              <li key={i} className="text-muted">
                <span className="text-ink">{r.note}</span>{" "}
                <a href={r.url} target="_blank" rel="noreferrer noopener" className="text-accent underline">
                  [{r.title || new URL(r.url).hostname}]
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {filmReady && projectId && <FilmBlock lang={lang} projectId={projectId} version={filmVersion} summary={summary!} />}

      {steps.length > 0 && <Timeline lang={lang} steps={steps} />}
    </section>
  );
}

function ShotCard({ shot }: { shot: ShotView }) {
  const [before, after] = [shot.scores[0], shot.scores[shot.scores.length - 1]];
  const src = shot.clipUrl ?? shot.imageUrl;
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-card-2">
      <div className="relative aspect-video bg-bg">
        {src ? <img src={src} alt={`Shot ${shot.index}`} className="h-full w-full object-cover" /> : <div className="skeleton h-full w-full" />}
        <span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 text-[10px] font-bold">F{String(shot.index).padStart(2, "0")}</span>
        {before !== undefined && (
          <span className="absolute right-1.5 top-1.5 rounded bg-black/70 px-1.5 text-[10px] font-bold text-emerald-300">
            👁 {before}
            {shot.scores.length > 1 && after !== before ? ` → ${after}` : ""}
          </span>
        )}
      </div>
      <div className="p-2 text-[11px] leading-snug">
        <div className="font-semibold text-ink">{shot.shotType}</div>
        <div className="line-clamp-2 text-muted">{shot.description}</div>
        {shot.dialogue && <div className="mt-1 line-clamp-2 italic text-amber-200/80">“{shot.dialogue}”</div>}
      </div>
    </div>
  );
}

function FilmBlock({ lang, projectId, version, summary }: { lang: Lang; projectId: string; version: number; summary: Summary }) {
  const src = `/api/projects/${projectId}/film.mp4?v=${version}`;
  return (
    <div className="mt-6 rounded-xl border border-line bg-card-2 p-4">
      <h4 className="text-sm font-bold">{t(lang, "film")}</h4>
      <video key={src} src={src} controls preload="metadata" className="mt-3 w-full rounded-lg bg-black" />
      <p className="mt-1 text-[11px] text-muted">{t(lang, "assembling")}</p>
      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        <a href={src} download="film.mp4" className="btn-gradient rounded-lg px-4 py-2 font-semibold text-white">
          {t(lang, "downloadMp4")}
        </a>
        <a href={`/api/export/zip?projectId=${projectId}`} className="rounded-lg border border-line px-4 py-2 text-muted hover:text-ink">
          {t(lang, "downloadZip")}
        </a>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-5">
        <Stat label={t(lang, "firstPass")} value={`${summary.firstPassOk}/${summary.shots}`} />
        <Stat label={t(lang, "repairs")} value={String(summary.repairs)} />
        <Stat label={t(lang, "uplift")} value={summary.criticBefore !== null ? `${summary.criticBefore} → ${summary.criticAfter}${summary.textCritic ? " (text)" : ""}` : "—"} />
        <Stat label={t(lang, "lint")} value={`${summary.lintErrors}E · ${summary.lintWarnings}W`} />
        <Stat label="USD" value={`$${summary.costUsd.toFixed(4)} · ${Math.round(summary.durationSec)}s`} />
      </div>
      {summary.continuity.length > 0 && <p className="mt-3 text-xs text-muted">🧵 {summary.continuity.join(" · ")}</p>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-bg px-2 py-2">
      <div className="font-bold text-ink">{value}</div>
      <div className="text-muted">{label}</div>
    </div>
  );
}

function Timeline({ lang, steps }: { lang: Lang; steps: Step[] }) {
  const visible = steps.filter((s) => !(s.role === "system" && s.action === "models"));
  return (
    <details className="mt-6" open>
      <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted">
        {t(lang, "timeline")} ({visible.length})
      </summary>
      <ol className="mt-2 max-h-[420px] space-y-1 overflow-y-auto pr-1">
        {visible.map((s) => {
          const r = ROLE_STYLE[s.role] ?? ROLE_STYLE.system;
          return (
            <li key={s.seq} className="flex items-start gap-2 rounded-lg border border-line/60 bg-card-2 px-2 py-1.5 text-xs">
              <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-sm" style={{ background: `${r.color}26`, color: r.color }} title={r.label}>
                {r.icon}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2">
                  <b style={{ color: r.color }}>{r.label}</b>
                  <span className="text-muted">{shortModel(s.model)}</span>
                  <span className="text-muted">· {s.action}</span>
                  {s.shotIndex ? <span className="text-muted">· F{String(s.shotIndex).padStart(2, "0")}</span> : null}
                  {s.score !== null ? <span className="rounded bg-emerald-500/15 px-1 font-bold text-emerald-300">{s.score}/10</span> : null}
                  {s.tokensIn + s.tokensOut > 0 ? (
                    <span className="ml-auto text-muted">
                      {(s.tokensIn + s.tokensOut).toLocaleString()} tok · ${s.costUsd.toFixed(5)} · {(s.latencyMs / 1000).toFixed(1)}s
                    </span>
                  ) : null}
                </div>
                <div className="truncate text-muted">{s.summary}</div>
                {s.error && <div className="truncate text-rose-300">⚠ {s.error}</div>}
              </div>
              {s.imageUrl && <img src={s.imageUrl} alt="" className="h-10 w-16 shrink-0 rounded object-cover" />}
            </li>
          );
        })}
      </ol>
    </details>
  );
}
