"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAppStore } from "@/lib/store/useAppStore";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ScriptImportPanel } from "@/components/ScriptImportPanel";
import { StoryboardTable } from "@/components/StoryboardTable";
import { AssetPanel } from "@/components/AssetPanel";
import { FrameGrid } from "@/components/FrameGrid";
import { PreviewPlayer } from "@/components/PreviewPlayer";
import { ExportBar } from "@/components/ExportBar";

export function Workspace() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get("p") ?? undefined;

  const project = useAppStore((s) => s.project);
  const bootstrap = useAppStore((s) => s.bootstrap);
  const patchProject = useAppStore((s) => s.patchProject);
  const toast = useAppStore((s) => s.toast);
  const setToast = useAppStore((s) => s.setToast);

  const [bootError, setBootError] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const bootedFor = useRef<string | undefined>("__none__");

  useEffect(() => {
    if (bootedFor.current === projectId) return;
    bootedFor.current = projectId;
    bootstrap(projectId).catch((err: unknown) => {
      setBootError(err instanceof Error ? err.message : "Không tải được dữ liệu");
    });
  }, [projectId, bootstrap]);

  // Toast tự ẩn sau 4s
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast, setToast]);

  function commitName() {
    setEditingName(false);
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== project?.name) {
      void patchProject({ name: trimmed });
    }
  }

  if (bootError) {
    return (
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-16 text-center">
        <p className="text-rose-400">{bootError}</p>
      </main>
    );
  }

  if (!project) {
    return (
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-16">
        <div className="skeleton mx-auto h-8 w-64 rounded-xl" />
        <div className="skeleton mx-auto mt-8 h-40 w-full rounded-card" />
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
      <header className="mb-8 flex flex-wrap items-center gap-3">
        <div className="btn-gradient h-10 w-10 shrink-0 rounded-xl shadow-lg shadow-accent/30" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold">Storyboard Studio</h1>
            <span className="text-muted">/</span>
            {editingName ? (
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={commitName}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitName();
                  if (e.key === "Escape") setEditingName(false);
                }}
                className="rounded-lg border border-accent bg-bg px-2 py-0.5 text-lg font-semibold outline-none"
              />
            ) : (
              <button
                onClick={() => {
                  setNameDraft(project.name);
                  setEditingName(true);
                }}
                className="truncate text-lg font-semibold text-accent transition hover:opacity-80"
                title="Bấm để đổi tên"
              >
                {project.name}
              </button>
            )}
          </div>
          <p className="text-sm text-muted">
            Chuỗi ảnh storyboard với mascot nhất quán cho video animation
          </p>
        </div>
        <Link
          href="/projects"
          className="rounded-xl border border-line px-4 py-2 text-sm text-muted transition hover:border-accent hover:text-ink"
        >
          📁 Projects
        </Link>
      </header>

      <div className="flex flex-col gap-6">
        <ErrorBoundary>
          <ScriptImportPanel />
        </ErrorBoundary>
        <ErrorBoundary>
          <StoryboardTable />
        </ErrorBoundary>
        <ErrorBoundary>
          <AssetPanel />
        </ErrorBoundary>
        <ErrorBoundary>
          <FrameGrid />
        </ErrorBoundary>
        <ErrorBoundary>
          <PreviewPlayer />
        </ErrorBoundary>
        <ErrorBoundary>
          <ExportBar />
        </ErrorBoundary>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-line bg-card-2 px-5 py-3 text-sm shadow-2xl">
          {toast}
        </div>
      )}
    </main>
  );
}
