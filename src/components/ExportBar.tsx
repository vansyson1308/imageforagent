"use client";

import { useAppStore } from "@/lib/store/useAppStore";

export function ExportBar() {
  const project = useAppStore((s) => s.project);
  const frames = useAppStore((s) => s.frames);

  if (!project) return null;
  const doneCount = frames.filter((f) => f.status === "done").length;

  return (
    <section
      className="fade-up flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-card p-6"
      style={{ animationDelay: "300ms" }}
    >
      <div>
        <h2 className="text-lg font-bold">6. Xuất file</h2>
        <p className="mt-0.5 text-sm text-muted">
          ZIP gồm ảnh F01…F{String(frames.length).padStart(2, "0")} + storyboard.json +
          captions.srt
        </p>
      </div>
      {doneCount > 0 ? (
        <a
          href={`/api/export/zip?projectId=${project.id}`}
          className="btn-gradient rounded-xl px-6 py-2.5 text-sm font-bold text-white"
          download
        >
          ⬇ Tải ZIP ({doneCount} ảnh)
        </a>
      ) : (
        <button
          disabled
          className="cursor-not-allowed rounded-xl bg-line px-6 py-2.5 text-sm font-bold text-muted"
        >
          ⬇ Tải ZIP (chưa có ảnh)
        </button>
      )}
    </section>
  );
}
