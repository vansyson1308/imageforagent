"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, type ProjectListItemDto } from "@/lib/api";

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectListItemDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  function load(): void {
    api
      .listProjects()
      .then(setProjects)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Không tải được danh sách");
      });
  }

  useEffect(() => {
    load();
  }, []);

  async function createProject() {
    setBusy("create");
    try {
      const project = await api.createProject("Storyboard mới");
      router.push(`/?p=${project.id}`);
    } finally {
      setBusy(null);
    }
  }

  async function duplicate(id: string) {
    setBusy(id);
    try {
      const copy = await api.duplicateProject(id);
      router.push(`/?p=${copy.id}`);
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
            <p className="text-sm text-muted">Mỗi project = 1 video storyboard</p>
          </div>
        </div>
        <button
          onClick={() => void createProject()}
          disabled={busy === "create"}
          className="btn-gradient rounded-xl px-5 py-2.5 text-sm font-bold text-white"
        >
          + Project mới
        </button>
      </header>

      {error && <p className="text-rose-400">{error}</p>}

      {projects === null ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-20 rounded-card" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <p className="rounded-card border border-dashed border-line px-4 py-12 text-center text-muted">
          Chưa có project nào — tạo project đầu tiên để bắt đầu.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {projects.map((p) => (
            <div
              key={p.id}
              className="fade-up group flex items-center gap-4 rounded-card border border-line bg-card p-5 transition hover:border-accent/50"
            >
              <Link href={`/?p=${p.id}`} className="min-w-0 flex-1">
                <h2 className="truncate font-semibold transition group-hover:text-accent">
                  {p.name}
                </h2>
                <p className="mt-0.5 text-xs text-muted">
                  {p.frameCount} frame · {p.doneCount} đã generate · {p.aspectRatio} ·{" "}
                  {p.resolution} · cập nhật{" "}
                  {new Date(p.updatedAt).toLocaleString("vi-VN")}
                </p>
              </Link>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => void duplicate(p.id)}
                  disabled={busy === p.id}
                  className="rounded-xl border border-line px-3 py-1.5 text-xs text-muted transition hover:border-accent hover:text-ink"
                  title="Nhân bản — giữ kịch bản + asset cho video series"
                >
                  ⧉ Nhân bản
                </button>
                {confirmDeleteId === p.id ? (
                  <>
                    <button
                      onClick={() => void remove(p.id)}
                      disabled={busy === p.id}
                      className="rounded-xl bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white"
                    >
                      Xoá luôn
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="rounded-xl border border-line px-3 py-1.5 text-xs text-muted"
                    >
                      Huỷ
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteId(p.id)}
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
