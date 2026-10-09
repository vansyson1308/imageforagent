"use client";

import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/lib/store/useAppStore";
import { t, useLang } from "@/lib/i18n";
import { SAMPLE_STORIES, type SampleStory } from "@/lib/director/sampleStories";
import { useDirectorRun } from "@/components/director/useDirectorRun";
import { RunView } from "@/components/director/RunView";

/**
 * DirectorPanel: story in, film out. The form starts a run; the run view
 * (live preview, filmstrip, critic before/after, crew timeline, film) comes
 * from `useDirectorRun`, which survives reloads and dropped connections:
 * the run executes on the server (D26).
 */

const FILM_LANGS: Array<[string, string]> = [
  ["en", "English"],
  ["vi", "Tiếng Việt"],
  ["ja", "日本語"],
  ["zh", "中文"],
  ["ko", "한국어"],
  ["fr", "Français"],
  ["es", "Español"],
  ["id", "Bahasa Indonesia"],
];

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
  const [research, setResearch] = useState(true);

  const projectId = project?.id;
  const { state, conn, startError, start, cancel, running } = useDirectorRun(projectId);
  const director = meta?.director;
  const styles = director?.styles ?? ["storybook", "flat", "ink", "neon", "papercut"];

  // Refresh the engine panels (frames, clips) whenever a run finishes.
  const lastFinished = useRef<string | null>(null);
  useEffect(() => {
    if (state.finished && state.runId && lastFinished.current !== state.runId) {
      lastFinished.current = state.runId;
      void hydrate();
    }
  }, [state.finished, state.runId, hydrate]);

  if (!project) return null;

  function pickSample(s: SampleStory) {
    setStory(s.story);
    setFilmLang(s.language);
    setStyle(s.style);
    setMaxShots(s.maxShots);
  }

  async function make() {
    if (running) return;
    if (frames.some((f) => f.status === "done") && !window.confirm(t(lang, "confirmReplace"))) return;
    await start({ story, language: filmLang, style, maxShots, critic, research: director?.research ? (research ? "auto" : false) : false });
  }

  return (
    <section className="fade-up rounded-card border border-accent/40 bg-card p-5 shadow-lg shadow-accent/10 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-bold">✨ {t(lang, "directorTitle")}</h2>
          <p className="mt-1 max-w-3xl text-base text-muted">{t(lang, "directorSub")}</p>
        </div>
      </div>

      {!director?.enabled ? (
        <p className="mt-4 rounded-xl border border-line bg-card-2 p-3 text-sm text-muted">{t(lang, "disabled")}</p>
      ) : (
        <>
          {director.provider === "mock" && <p className="mt-3 text-sm text-amber-300">{t(lang, "mockNote")}</p>}
          {!running && (
            <>
              <div className="mt-4 flex flex-wrap gap-2" aria-label={t(lang, "samplesTitle")}>
                {SAMPLE_STORIES.map((s) => (
                  <button key={s.key} onClick={() => pickSample(s)} className="rounded-full border border-line bg-card-2 px-3 py-1.5 text-sm text-muted transition hover:border-accent hover:text-ink">
                    {s.language.toUpperCase()} · {s.title}
                  </button>
                ))}
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_300px]">
                <label className="block">
                  <span className="text-sm font-semibold text-muted">{t(lang, "storyLabel")}</span>
                  <textarea
                    value={story}
                    onChange={(e) => setStory(e.target.value)}
                    placeholder={t(lang, "storyPlaceholder")}
                    rows={7}
                    maxLength={6000}
                    className="mt-1 w-full resize-y rounded-xl border border-line bg-bg p-3 text-base outline-none focus:border-accent"
                  />
                </label>
                <div className="flex flex-col gap-3 text-sm">
                  <label className="block">
                    <span className="font-semibold text-muted">{t(lang, "filmLanguage")}</span>
                    <select value={filmLang} onChange={(e) => setFilmLang(e.target.value)} className="mt-1 w-full rounded-lg border border-line bg-bg px-2 py-2">
                      {FILM_LANGS.map(([code, name]) => (
                        <option key={code} value={code}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div>
                    <span className="font-semibold text-muted">{t(lang, "style")}</span>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {styles.map((s) => (
                        <button
                          key={s}
                          onClick={() => setStyle(s)}
                          aria-pressed={style === s}
                          className={`rounded-lg border px-2.5 py-1 transition ${style === s ? "border-accent bg-accent/20 text-ink" : "border-line text-muted hover:text-ink"}`}
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
                    <input type="range" min={3} max={12} value={maxShots} aria-label={t(lang, "shots")} onChange={(e) => setMaxShots(Number(e.target.value))} />
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={critic} onChange={(e) => setCritic(e.target.checked)} />
                    <span>{t(lang, "critic")}</span>
                  </label>
                  {director.research ? (
                    <label className="flex items-start gap-2" title={t(lang, "researchAuto")}>
                      <input type="checkbox" className="mt-1" checked={research} onChange={(e) => setResearch(e.target.checked)} />
                      <span>
                        {t(lang, "research")}
                        <span className="block text-xs text-muted">{t(lang, "researchAuto")}</span>
                      </span>
                    </label>
                  ) : (
                    <p className="text-xs text-muted">{t(lang, "researchOff")}</p>
                  )}
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button onClick={make} disabled={story.trim().length < 20} className="btn-gradient rounded-xl px-6 py-3 text-base font-bold text-white">
                  {t(lang, "make")}
                </button>
                <p className="max-w-xl text-sm text-muted">{t(lang, "keepsRendering")}</p>
              </div>
            </>
          )}
          {startError && <p className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-2 text-sm text-rose-200">{startError}</p>}
        </>
      )}

      <RunView state={state} lang={lang} mode="live" reconnecting={conn === "reconnecting"} onCancel={cancel} />
    </section>
  );
}
