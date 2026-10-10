"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { LangToggle, t, useLang } from "@/lib/i18n";
import { SAMPLE_STORIES, type SampleStory } from "@/lib/director/sampleStories";

/**
 * Landing (SPEC v2 WP6.1): a real showcase film playing muted, two buttons
 * (Make a film / Watch the showcase), the three sample stories and one line
 * on how it works. "Make this film" is ONE click from here to watching the
 * crew work: it reuses an empty project of this session (or creates one),
 * starts the run, and opens the studio, which re-attaches to the run.
 */

interface HeroFilm {
  slug: string;
  title: string;
  film: string;
  poster: string;
  captions?: string;
  language: string;
}

async function emptyProjectId(name: string): Promise<string> {
  const projects = await api.listProjects();
  const empty = projects.find((p) => p.frameCount === 0);
  if (empty) return empty.id;
  return (await api.createProject(name)).id;
}

export function Landing() {
  const router = useRouter();
  const [lang, setLang] = useLang();
  const [hero, setHero] = useState<HeroFilm | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/showcase/index.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { hero?: string; films: HeroFilm[] } | null) => {
        if (!d?.films?.length) return;
        setHero(d.films.find((f) => f.slug === d.hero) ?? d.films[0]);
      })
      .catch(() => {});
  }, []);

  async function makeFilm() {
    setBusy("new");
    setError(null);
    try {
      router.push(`/studio?p=${await emptyProjectId("My film")}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  async function makeSample(s: SampleStory) {
    setBusy(s.key);
    setError(null);
    try {
      const pid = await emptyProjectId(s.title);
      const ctrl = new AbortController();
      const res = await fetch(`/api/projects/${pid}/director`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ story: s.story, language: s.language, style: s.style, maxShots: s.maxShots, critic: true, research: "auto" }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ? `${body.error.message}${body.error.hint ? ` ${body.error.hint}` : ""}` : `HTTP ${res.status}`);
      }
      // The run lives on the server (D26): stop reading here, the studio re-attaches.
      ctrl.abort();
      router.push(`/studio?p=${pid}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-10">
      <header className="flex flex-wrap items-center gap-3">
        <div className="btn-gradient h-10 w-10 shrink-0 rounded-xl shadow-lg shadow-accent/30" aria-hidden />
        <span className="flex-1 text-lg font-bold">Storyboard Studio Director</span>
        <LangToggle lang={lang} setLang={setLang} />
        <Link href="/projects" className="rounded-xl border border-line px-3 py-2 text-sm text-muted hover:border-accent hover:text-ink">
          📁 Projects
        </Link>
      </header>

      <section className="mt-8 grid items-center gap-8 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <h1 className="text-4xl font-bold leading-tight sm:text-5xl">{t(lang, "tagline")}</h1>
          <p className="mt-4 text-lg text-muted">{t(lang, "howItWorks")}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button onClick={makeFilm} disabled={busy !== null} className="btn-gradient rounded-xl px-6 py-3 text-lg font-bold text-white">
              🎬 {t(lang, "makeAFilm")}
            </button>
            <Link href="/showcase" className="rounded-xl border border-line px-6 py-3 text-lg font-semibold text-ink hover:border-accent">
              🎞 {t(lang, "watchShowcase")}
            </Link>
          </div>
        </div>
        <figure className="overflow-hidden rounded-2xl border border-line bg-black shadow-2xl shadow-accent/10">
          {hero ? (
            <video src={hero.film} poster={hero.poster} autoPlay muted loop playsInline className="aspect-video w-full" aria-label={hero.title}>
              {hero.captions ? <track kind="captions" src={hero.captions} srcLang={hero.language} label={hero.language} default /> : null}
            </video>
          ) : (
            <div className="skeleton aspect-video w-full" />
          )}
          <figcaption className="flex items-center justify-between gap-2 bg-card px-4 py-2 text-sm text-muted">
            <span>
              {t(lang, "heroCaption")}
              {hero ? `: ${hero.title}` : ""}
            </span>
            {hero ? (
              <Link href={`/showcase/replay/${hero.slug}`} className="shrink-0 text-violet-300 underline hover:text-ink">
                {t(lang, "replayRun")} →
              </Link>
            ) : null}
          </figcaption>
        </figure>
      </section>

      <section className="mt-12">
        <h2 className="text-xl font-bold">{t(lang, "samplesTitle")}</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {SAMPLE_STORIES.map((s) => (
            <article key={s.key} className="flex flex-col rounded-2xl border border-line bg-card p-5">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted">{{ en: "English", vi: "Tiếng Việt", ja: "日本語" }[s.language]}</div>
              <h3 className="mt-1 text-lg font-bold" lang={s.language}>
                {s.title}
              </h3>
              <p className="mt-1 flex-1 text-sm text-muted" lang={s.language}>
                {s.teaser}
              </p>
              <button onClick={() => makeSample(s)} disabled={busy !== null} className="btn-gradient mt-4 rounded-xl px-4 py-2.5 font-bold text-white">
                {busy === s.key ? t(lang, "starting") : `▶ ${t(lang, "makeThis")}`}
              </button>
              <p className="mt-2 text-xs text-muted">⏱ {t(lang, "estTime", { a: s.estMinutes[0], b: s.estMinutes[1] })}</p>
              {s.language === "ja" ? <p className="mt-1 text-xs text-amber-300">{t(lang, "jaDemoVoice")}</p> : null}
            </article>
          ))}
        </div>
        <p className="mt-3 text-sm text-muted">{t(lang, "keepsRendering")}</p>
        {error && <p className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</p>}
      </section>
    </main>
  );
}
