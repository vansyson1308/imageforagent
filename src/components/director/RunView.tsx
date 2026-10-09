"use client";

import { useEffect, useMemo, useState } from "react";
import { modelLabel, statusLine, type RunShot, type RunState, type RunStep } from "@/lib/director/runState";
import { t, type Lang } from "@/lib/i18n";

/* eslint-disable @next/next/no-img-element */

/**
 * The run view (SPEC v2 WP6): a big live preview of the latest accepted
 * frame, a filmstrip that fills in as shots land, the critic's before/after
 * shown large when a revision wins, the research card, plain-language status
 * and the crew timeline (role, model, tokens, cost). The same component
 * renders a live run, a reconnected run and a showcase replay.
 */

const ROLE_STYLE: Record<string, { icon: string; label: string; color: string }> = {
  researcher: { icon: "🔎", label: "Researcher", color: "#38bdf8" },
  director: { icon: "🎬", label: "Director", color: "#f59e0b" },
  cast: { icon: "🎭", label: "Cast", color: "#a78bfa" },
  artist: { icon: "🖌️", label: "Artist", color: "#ec4899" },
  critic: { icon: "👁️", label: "Critic", color: "#34d399" },
  editor: { icon: "✂️", label: "Editor", color: "#60a5fa" },
  dialogue: { icon: "🎙️", label: "Voice", color: "#fbbf24" },
  system: { icon: "⚙️", label: "Engine", color: "#9b9bab" },
};

const pad = (n: number) => String(n).padStart(2, "0");
const fmtTime = (sec: number) => `${Math.floor(sec / 60)}:${pad(Math.round(sec % 60))}`;

export interface RunViewProps {
  readonly state: RunState;
  readonly lang: Lang;
  /** "live" shows cancel + elapsed; "replay" is a recorded run */
  readonly mode: "live" | "replay";
  readonly reconnecting?: boolean;
  readonly onCancel?: () => void;
  /** finished-film source (defaults to the project's film.mp4) */
  readonly filmSrc?: string | null;
  readonly downloads?: boolean;
  readonly onSaveSeries?: () => void;
  /** replay: the virtual clock in ms since start */
  readonly clockMs?: number;
}

export function RunView({ state, lang, mode, reconnecting, onCancel, filmSrc, downloads = true, onSaveSeries, clockMs }: RunViewProps) {
  const [now, setNow] = useState(() => Date.now());
  const live = !!state.runId && !state.finished;
  useEffect(() => {
    if (!live || mode !== "live") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live, mode]);

  const elapsedSec =
    mode === "replay"
      ? Math.round((clockMs ?? 0) / 1000)
      : state.summary && state.finished
        ? Math.round(state.summary.wallMs / 1000)
        : state.startedAt
          ? Math.max(0, Math.round((now - Date.parse(state.startedAt)) / 1000))
          : 0;

  const latest = useMemo(() => {
    const byIndex = state.latestShot ? state.shots.find((s) => s.index === state.latestShot) : undefined;
    return byIndex ?? [...state.shots].reverse().find((s) => s.imageUrl);
  }, [state.shots, state.latestShot]);

  if (!state.runId) return null;
  const line = statusLine(state, lang === "ja" ? "ja" : lang === "vi" ? "vi" : "en");
  const rendered = state.shots.filter((s) => s.imageUrl).length;

  return (
    <section className="mt-6 space-y-5" aria-live="polite">
      {/* status bar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-line bg-card-2 px-4 py-3">
        {live ? <span className="live-dot inline-block h-2.5 w-2.5 rounded-full bg-emerald-400" aria-hidden /> : null}
        <p className="min-w-0 flex-1 text-base font-semibold text-ink">
          {state.finished ? `${state.title ?? ""}${state.title ? " · " : ""}${t(lang, statusKey(state.status ?? "done"))}` : line}
        </p>
        <span className="text-sm text-muted">
          {rendered}/{state.shots.length || "…"} {t(lang, "shotsTitle").toLowerCase()} · {state.totals.tokens.toLocaleString("en")} {t(lang, "tokens")} · ${state.totals.costUsd.toFixed(3)} · {fmtTime(elapsedSec)}
        </span>
        {mode === "live" && live && onCancel ? (
          <button
            onClick={() => {
              if (window.confirm(t(lang, "confirmCancel"))) onCancel();
            }}
            className="rounded-xl border border-line px-3 py-1.5 text-sm text-muted transition hover:border-rose-400 hover:text-rose-300"
          >
            {t(lang, "cancel")}
          </button>
        ) : null}
      </div>
      {reconnecting && live ? <p className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-200">{t(lang, "reconnecting")}</p> : null}
      {state.error && <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{state.error}</p>}

      {/* finished film first, otherwise the live preview */}
      {state.finished && state.summary && state.summary.rendered > 0 ? (
        <FinishedFilm state={state} lang={lang} filmSrc={filmSrc ?? (state.projectId ? `/api/projects/${state.projectId}/film.mp4?v=${state.runId}` : null)} downloads={downloads} onSaveSeries={onSaveSeries} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <LivePreview shot={latest} lang={lang} title={state.title} logline={state.logline} />
          <div className="space-y-4">
            <CrewCard state={state} />
            {state.lastUplift ? <UpliftCard state={state} lang={lang} compact /> : null}
          </div>
        </div>
      )}

      {state.lastUplift && state.finished ? <UpliftCard state={state} lang={lang} /> : null}

      {state.shots.length > 0 && <Filmstrip shots={state.shots} lang={lang} refs={state.references.length} />}

      {state.references.length > 0 && <ResearchCard state={state} lang={lang} />}

      {state.steps.length > 0 && <Timeline lang={lang} steps={state.steps} />}
    </section>
  );
}

function statusKey(s: string) {
  return (s === "done" ? "status_done" : s === "cancelled" ? "status_cancelled" : s === "budget_exceeded" ? "status_budget_exceeded" : s === "running" ? "status_done" : "status_failed") as
    | "status_done"
    | "status_cancelled"
    | "status_budget_exceeded"
    | "status_failed";
}

function LivePreview({ shot, lang, title, logline }: { shot: RunShot | undefined; lang: Lang; title: string | null; logline: string | null }) {
  const src = shot?.clipUrl ?? shot?.imageUrl ?? null;
  return (
    <figure className="overflow-hidden rounded-2xl border border-line bg-black">
      <div className="relative aspect-video">
        {src ? (
          <img key={src} src={src} alt={shot ? `Shot ${shot.index}: ${shot.description}` : ""} className="fade-up h-full w-full object-cover" />
        ) : (
          <div className="skeleton grid h-full w-full place-items-center">
            <p className="max-w-sm px-6 text-center text-base text-muted">{t(lang, "waitingFirst")}</p>
          </div>
        )}
        {shot && src ? (
          <span className="absolute left-3 top-3 rounded-lg bg-black/70 px-2 py-1 text-xs font-bold tracking-wide text-white">
            F{pad(shot.index)} · {shot.shotType}
          </span>
        ) : null}
        {shot?.dialogue && src ? (
          <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-6 pb-4 pt-10 text-center text-lg font-semibold text-white">“{shot.dialogue}”</figcaption>
        ) : null}
      </div>
      {(title || shot) && (
        <div className="border-t border-line bg-card px-4 py-3">
          {title ? <h3 className="text-lg font-bold text-ink">{title}</h3> : null}
          {logline ? <p className="text-sm text-muted">{logline}</p> : null}
          {shot && !logline ? <p className="line-clamp-2 text-sm text-muted">{shot.description}</p> : null}
        </div>
      )}
    </figure>
  );
}

const CREW_ORDER = ["researcher", "director", "cast", "artist", "critic", "editor", "dialogue"] as const;

function CrewCard({ state }: { state: RunState }) {
  const byRole = new Map<string, { model: string; calls: number; tokens: number; cost: number }>();
  for (const s of state.steps) {
    if (s.role === "system") continue;
    const r = byRole.get(s.role) ?? { model: s.model, calls: 0, tokens: 0, cost: 0 };
    if (s.tokensIn + s.tokensOut > 0 || s.role === "dialogue" || s.role === "researcher") r.calls++;
    r.tokens += s.tokensIn + s.tokensOut;
    r.cost += s.costUsd;
    if (s.tokensIn + s.tokensOut > 0) r.model = s.model;
    byRole.set(s.role, r);
  }
  const active = state.steps.at(-1)?.role;
  return (
    <div className="rounded-2xl border border-line bg-card p-4">
      <h4 className="text-sm font-bold uppercase tracking-wide text-muted">The crew</h4>
      <ul className="mt-3 space-y-2">
        {CREW_ORDER.filter((r) => byRole.has(r) || (r !== "researcher" && r !== "dialogue")).map((r) => {
          const s = ROLE_STYLE[r];
          const v = byRole.get(r);
          const model = v?.model ?? state.models?.[r === "director" ? "strong" : r === "cast" || r === "artist" ? "mid" : r === "critic" ? state.models?.vision ? "vision" : "fast" : "fast"] ?? "";
          return (
            <li key={r} className={`flex items-center gap-3 rounded-xl px-2 py-1.5 ${active === r && !state.finished ? "bg-card-2 ring-1 ring-accent/50" : ""}`}>
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-base" style={{ background: `${s.color}26`, color: s.color }} aria-hidden>
                {s.icon}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold" style={{ color: s.color }}>
                  {s.label}
                </div>
                <div className="truncate text-xs text-muted">{model ? modelLabel(model) : "—"}</div>
              </div>
              {v && v.tokens > 0 ? (
                <div className="text-right text-xs text-muted">
                  <div>{v.tokens.toLocaleString("en")} tok</div>
                  <div>${v.cost.toFixed(3)}</div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function UpliftCard({ state, lang, compact }: { state: RunState; lang: Lang; compact?: boolean }) {
  const u = state.lastUplift!;
  return (
    <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/5 p-4">
      <h4 className="text-sm font-bold text-emerald-200">
        👁️ {t(lang, "criticWin")} · F{pad(u.shotIndex)}
      </h4>
      <div className={`mt-3 grid gap-3 ${compact ? "grid-cols-2" : "sm:grid-cols-2"}`}>
        {(
          [
            ["before", u.beforeImageUrl, u.before],
            ["after", u.afterImageUrl, u.after],
          ] as const
        ).map(([k, src, score]) => (
          <figure key={k} className="overflow-hidden rounded-xl border border-line bg-black">
            <div className="relative aspect-video">
              {src ? <img src={src} alt={`${k} the revision`} className="h-full w-full object-cover" /> : <div className="skeleton h-full w-full" />}
              <span className={`absolute right-2 top-2 rounded-lg px-2 py-0.5 font-bold ${compact ? "text-sm" : "text-xl"} ${k === "after" ? "bg-emerald-500 text-black" : "bg-black/70 text-white"}`}>{score}/10</span>
            </div>
            <figcaption className="px-2 py-1 text-xs uppercase tracking-wide text-muted">{t(lang, k)}</figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

function Filmstrip({ shots, lang, refs }: { shots: RunShot[]; lang: Lang; refs: number }) {
  return (
    <div>
      <h4 className="text-sm font-bold uppercase tracking-wide text-muted">{t(lang, "shotsTitle")}</h4>
      <ol className="mt-2 flex snap-x gap-3 overflow-x-auto pb-2">
        {shots.map((s) => {
          const src = s.clipUrl ?? s.imageUrl;
          const [before, after] = [s.scores[0], s.scores.at(-1)];
          return (
            <li key={s.index} className="w-56 shrink-0 snap-start overflow-hidden rounded-xl border border-line bg-card-2">
              <div className="relative aspect-video bg-bg">
                {src ? <img src={src} alt={`Shot ${s.index}`} className="h-full w-full object-cover" /> : s.status === "failed" ? <div className="grid h-full place-items-center text-xs text-rose-300">✕</div> : <div className="skeleton h-full w-full" />}
                <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 text-[11px] font-bold text-white">F{pad(s.index)}</span>
                {before !== undefined && (
                  <span className="absolute right-1.5 top-1.5 rounded bg-black/75 px-1.5 text-[11px] font-bold text-emerald-300">
                    {before}
                    {s.scores.length > 1 && after !== before ? ` → ${after}` : ""}
                  </span>
                )}
              </div>
              <div className="space-y-1 p-2 text-xs leading-snug">
                <div className="font-semibold text-ink">{s.shotType}</div>
                <div className="line-clamp-2 text-muted">{s.description}</div>
                {s.dialogue && <div className="line-clamp-2 italic text-amber-200/90">“{s.dialogue}”</div>}
                {s.cites.length > 0 && refs > 0 ? (
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {s.cites.map((c) => (
                      <a key={c} href={`#ref-${c}`} className="rounded-full border border-sky-400/40 px-1.5 text-[10px] text-sky-300 hover:bg-sky-400/10" title="Uses a researched fact">
                        🔎 [{c}]
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function ResearchCard({ state, lang }: { state: RunState; lang: Lang }) {
  return (
    <div className="rounded-2xl border border-sky-400/30 bg-sky-400/5 p-4">
      <h4 className="text-sm font-bold text-sky-200">🔎 {t(lang, "references")}</h4>
      <p className="text-xs text-muted">{t(lang, "referencesSub")}</p>
      <ol className="mt-3 space-y-2 text-sm">
        {state.references.map((r, i) => {
          let domain = "";
          try {
            domain = new URL(r.url).hostname.replace(/^www\./, "");
          } catch {
            domain = r.url;
          }
          return (
            <li key={i} id={`ref-${i + 1}`} className="flex gap-2">
              <span className="shrink-0 font-bold text-sky-300">[{i + 1}]</span>
              <div className="min-w-0">
                <span className="text-ink">{r.note}</span>
                {r.use ? <span className="ml-1 rounded bg-sky-400/15 px-1 text-[11px] text-sky-200">{r.use}</span> : null}
                <div className="truncate text-xs">
                  <a href={r.url} target="_blank" rel="noreferrer noopener" className="text-sky-300 underline">
                    {r.title || domain}
                  </a>{" "}
                  <span className="text-muted">· {domain}</span>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function FinishedFilm({ state, lang, filmSrc, downloads, onSaveSeries }: { state: RunState; lang: Lang; filmSrc: string | null; downloads: boolean; onSaveSeries?: () => void }) {
  const s = state.summary!;
  const models = state.models ? [...new Set(Object.values(state.models).filter(Boolean).map(modelLabel))] : [];
  return (
    <div className="rounded-2xl border border-line bg-card p-4 sm:p-5">
      <h3 className="text-xl font-bold">🎞 {state.title ?? t(lang, "film")}</h3>
      {state.logline && <p className="mt-1 text-sm text-muted">{state.logline}</p>}
      {filmSrc ? <video key={filmSrc} src={filmSrc} poster={state.shots.find((x) => x.imageUrl)?.imageUrl ?? undefined} controls preload="metadata" playsInline className="mt-4 aspect-video w-full rounded-xl bg-black" /> : null}
      {downloads && filmSrc ? <p className="mt-1 text-xs text-muted">{t(lang, "assembling")}</p> : null}
      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        {downloads && filmSrc && (
          <a href={filmSrc} download="film.mp4" className="btn-gradient rounded-xl px-4 py-2 font-semibold text-white">
            {t(lang, "downloadMp4")}
          </a>
        )}
        {downloads && state.projectId && (
          <a href={`/api/export/zip?projectId=${state.projectId}`} className="rounded-xl border border-line px-4 py-2 text-muted hover:text-ink">
            {t(lang, "downloadZip")}
          </a>
        )}
        {onSaveSeries && (
          <button onClick={onSaveSeries} className="rounded-xl border border-accent/60 px-4 py-2 text-ink hover:bg-accent/15">
            ⭐ {t(lang, "saveSeries")}
          </button>
        )}
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-2 text-center text-sm sm:grid-cols-3 lg:grid-cols-6">
        <Stat label={t(lang, "shotsTitle")} value={`${s.rendered}/${s.shots}`} />
        <Stat label={t(lang, "firstPass")} value={`${s.firstPassOk}/${s.shots}`} />
        <Stat label={t(lang, "repairs")} value={String(s.repairs)} />
        <Stat label={t(lang, "uplift")} value={s.criticBefore !== null ? `${s.criticBefore} → ${s.criticAfter}` : "—"} />
        <Stat label={t(lang, "wall")} value={fmtTime(Math.round(s.wallMs / 1000))} />
        <Stat label={t(lang, "cost")} value={`$${s.costUsd.toFixed(3)}`} />
      </dl>
      {models.length > 0 && (
        <p className="mt-3 text-xs text-muted">
          {t(lang, "models")}: {models.join(" · ")}
          {s.criticModel ? ` · critic: ${s.criticModel.split(" · ").map((part) => part.replace(/^(\S+)/, (m) => modelLabel(m))).join(" · ")}` : s.textCritic ? " · critic: text mode (measured render)" : ""}
        </p>
      )}
      {s.continuity?.length > 0 && <p className="mt-2 text-xs text-muted">🧵 {s.continuity.slice(0, 4).join(" · ")}</p>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col-reverse rounded-xl border border-line bg-card-2 px-2 py-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-bold text-ink">{value}</dd>
    </div>
  );
}

function Timeline({ lang, steps }: { lang: Lang; steps: RunStep[] }) {
  const visible = steps.filter((s) => !(s.role === "system" && s.action === "models"));
  return (
    <details className="rounded-2xl border border-line bg-card p-4">
      <summary className="cursor-pointer text-sm font-bold uppercase tracking-wide text-muted">
        {t(lang, "timeline")} ({visible.length}) <span className="ml-2 font-normal normal-case tracking-normal">{t(lang, "timelineHint")}</span>
      </summary>
      <ol className="mt-3 max-h-[480px] space-y-1 overflow-y-auto pr-1">
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
                  <span className="text-muted">{modelLabel(s.model)}</span>
                  <span className="text-muted">· {s.action}</span>
                  {s.shotIndex ? <span className="text-muted">· F{pad(s.shotIndex)}</span> : null}
                  {s.score !== null ? <span className="rounded bg-emerald-500/15 px-1 font-bold text-emerald-300">{s.score}/10</span> : null}
                  {s.tokensIn + s.tokensOut > 0 ? (
                    <span className="ml-auto text-muted">
                      {(s.tokensIn + s.tokensOut).toLocaleString("en")} tok · ${s.costUsd.toFixed(5)} · {(s.latencyMs / 1000).toFixed(1)}s
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
