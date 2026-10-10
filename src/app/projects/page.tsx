"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, type ProjectListItemDto } from "@/lib/api";
import { DATE_LOCALE, LangToggle, t, useLang } from "@/lib/i18n";

const LOAD_FAILED = "load-failed";

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectListItemDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [lang, setLang] = useLang();

  function load(): void {
    api
      .listProjects()
      .then(setProjects)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : LOAD_FAILED);
      });
  }

  useEffect(() => {
    load();
  }, []);

  async function createProject() {
    setBusy("create");
    try {
      const project = await api.createProject(t(lang, "newProjectName"));
      router.push(`/studio?p=${project.id}`);
    } finally {
      setBusy(null);
    }
  }

  async function duplicate(id: string) {
    setBusy(id);
    try {
      const copy = await api.duplicateProject(id);
      router.push(`/studio?p=${copy.id}`);
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    setBusy(id);
    try {
      await api.deleteProject(id);
      setConfirmDeleteId(null);
      await load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
      <header className="mb-8 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="btn-gradient h-10 w-10 rounded-xl shadow-lg shadow-accent/30" />
          <div>
            <h1 className="text-xl font-bold">Projects</h1>
            <p className="text-sm text-muted">{t(lang, "projectsSub")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
        <LangToggle lang={lang} setLang={setLang} />
        <button
          onClick={() => void createProject()}
          disabled={busy === "create"}
          className="btn-gradient rounded-xl px-5 py-2.5 text-sm font-bold text-white"
        >
          {t(lang, "newProjectBtn")}
        </button>
        </div>
      </header>

      {error && <p className="text-rose-400">{error === LOAD_FAILED ? t(lang, "loadFailed") : error}</p>}

      {projects === null ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-20 rounded-card" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <p className="rounded-card border border-dashed border-line px-4 py-12 text-center text-muted">
          {t(lang, "noProjects")}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {projects.map((p) => (
            <div
              key={p.id}
              className="fade-up group flex items-center gap-4 rounded-card border border-line bg-card p-5 transition hover:border-accent/50"
            >
              <Link href={`/studio?p=${p.id}`} className="min-w-0 flex-1">
                <h2 className="truncate font-semibold transition group-hover:text-accent">
                  {p.name}
                </h2>
                <p className="mt-0.5 text-xs text-muted">
                  {t(lang, "projStats", { frames: p.frameCount, done: p.doneCount, aspect: p.aspectRatio, res: p.resolution, date: new Date(p.updatedAt).toLocaleString(DATE_LOCALE[lang]) })}
                </p>
              </Link>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => void duplicate(p.id)}
                  disabled={busy === p.id}
                  className="rounded-xl border border-line px-3 py-1.5 text-xs text-muted transition hover:border-accent hover:text-ink"
                  title={t(lang, "duplicateTitle")}
                >
                  {t(lang, "duplicate")}
                </button>
                {confirmDeleteId === p.id ? (
                  <>
                    <button
                      onClick={() => void remove(p.id)}
                      disabled={busy === p.id}
                      className="rounded-xl bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white"
                    >
                      {t(lang, "deleteNow")}
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="rounded-xl border border-line px-3 py-1.5 text-xs text-muted"
                    >
                      {t(lang, "cancelAction")}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteId(p.id)}
                    aria-label={t(lang, "deleteProject")}
                    className="rounded-xl border border-line px-3 py-1.5 text-xs text-muted transition hover:border-rose-500 hover:text-rose-400"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
