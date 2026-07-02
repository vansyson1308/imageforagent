"use client";

import { useState } from "react";
import { useAppStore } from "@/lib/store/useAppStore";
import { WM_POSITIONS } from "@/lib/validation/schemas";

const POSITION_LABELS: Record<string, string> = {
  "top-left": "Góc trái-trên",
  "top-right": "Góc phải-trên",
  "bottom-left": "Góc trái-dưới",
  "bottom-right": "Góc phải-dưới",
  center: "Chính giữa",
};

export function WatermarkSettings() {
  const project = useAppStore((s) => s.project);
  const assets = useAppStore((s) => s.assets);
  const frames = useAppStore((s) => s.frames);
  const patchProject = useAppStore((s) => s.patchProject);
  const reapplyWatermark = useAppStore((s) => s.reapplyWatermark);

  const [open, setOpen] = useState(false);
  const [applying, setApplying] = useState(false);

  if (!project) return null;

  const hasWatermark = assets.some((a) => a.kind === "watermark");
  const hasGenerated = frames.some((f) => f.imageUrl !== null);

  async function reapply() {
    setApplying(true);
    try {
      await reapplyWatermark();
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="rounded-xl border border-line bg-card-2/40">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-sm"
      >
        <span className="font-semibold">
          Watermark{" "}
          <span className="ml-1 text-xs font-normal text-muted">
            {hasWatermark ? `${POSITION_LABELS[project.wmPosition]} · ${project.wmScale}% · ${Math.round(project.wmOpacity * 100)}%` : "chưa upload logo"}
          </span>
        </span>
        <span className={`text-muted transition ${open ? "rotate-180" : ""}`}>▾</span>
      </button>

      {open && (
        <div className="flex flex-wrap items-end gap-4 border-t border-line px-4 py-3">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-xs font-semibold text-muted">Vị trí</span>
            <select
              value={project.wmPosition}
              onChange={(e) => void patchProject({ wmPosition: e.target.value })}
              className="rounded-xl border border-line bg-card-2 px-3 py-2 outline-none focus:border-accent"
            >
              {WM_POSITIONS.map((p) => (
                <option key={p} value={p}>
                  {POSITION_LABELS[p]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-xs font-semibold text-muted">
              Kích thước: {project.wmScale}% chiều rộng
            </span>
            <input
              type="range"
              min={4}
              max={40}
              step={1}
              value={project.wmScale}
              onChange={(e) => void patchProject({ wmScale: Number(e.target.value) })}
              className="w-40 accent-[var(--color-accent)]"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-xs font-semibold text-muted">
              Độ đậm: {Math.round(project.wmOpacity * 100)}%
            </span>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={project.wmOpacity}
              onChange={(e) => void patchProject({ wmOpacity: Number(e.target.value) })}
              className="w-40 accent-[var(--color-accent)]"
            />
          </label>

          <button
            onClick={() => void reapply()}
            disabled={applying || !hasGenerated}
            className="ml-auto rounded-xl border border-accent px-4 py-2 text-sm font-semibold text-accent transition hover:bg-accent/10 disabled:opacity-40"
            title="Chạy lại watermark trên ảnh gốc — không tốn API"
          >
            {applying ? "Đang áp dụng…" : "Áp dụng lại toàn bộ"}
          </button>
        </div>
      )}
    </div>
  );
}
