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
      <a
        href={doneCount > 0 ? `/api/export/zip?projectId=${project.id}` : undefined}
        aria-disabled={doneCount === 0}
        className={`rounded-xl px-6 py-2.5 text-sm font-bold text-white ${
          doneCount > 0 ? "btn-gradient" : "cursor-not-allowed bg-line text-muted"
        }`}
        download
      >
        ⬇ Tải ZIP ({doneCount} ảnh)
      </a>
    </section>
  );
}
