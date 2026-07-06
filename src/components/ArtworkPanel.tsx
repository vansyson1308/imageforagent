"use client";

import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/lib/store/useAppStore";
import { ASPECT_RATIOS, RESOLUTIONS } from "@/lib/validation/schemas";

/**
 * Panel Artwork: thư viện SVG defs của project (mascot <symbol>, gradient…)
 * + cấu hình canvas (ratio/resolution) + nút re-render toàn bộ sau khi đổi defs.
 */
export function ArtworkPanel() {
  const project = useAppStore((s) => s.project);
  const frames = useAppStore((s) => s.frames);
  const patchProject = useAppStore((s) => s.patchProject);
  const renderAll = useAppStore((s) => s.renderAll);

  const [defs, setDefs] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Đổi project → bỏ draft cũ (adjust state during render)
  const [lastProjectId, setLastProjectId] = useState(project?.id);
  if (project?.id !== lastProjectId) {
    setLastProjectId(project?.id);
    setDefs(null);
  }

  if (!project) return null;

  const value = defs ?? project.artworkDefs ?? "";
  const withArtwork = frames.filter((f) => f.artworkSvg !== null).length;

  function onDefsChange(next: string) {
    setDefs(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void patchProject({ artworkDefs: next.trim() === "" ? null : next });
    }, 800);
  }

  async function onRenderAll() {
    setRendering(true);
    try {
      await renderAll();
    } finally {
      setRendering(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-xs font-semibold text-muted">Tỷ lệ khung hình</span>
          <select
            value={project.aspectRatio}
            onChange={(e) => void patchProject({ aspectRatio: e.target.value })}
            className="rounded-xl border border-line bg-card-2 px-3 py-2 outline-none focus:border-accent"
          >
            {ASPECT_RATIOS.map((r) => (
              <option key={r} value={r}>
                {r} {r === "16:9" ? "(YouTube)" : r === "9:16" ? "(TikTok/Reels)" : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-xs font-semibold text-muted">Độ phân giải</span>
          <select
            value={project.resolution}
            onChange={(e) => void patchProject({ resolution: e.target.value })}
            className="rounded-xl border border-line bg-card-2 px-3 py-2 outline-none focus:border-accent"
          >
            {RESOLUTIONS.map((r) => (
              <option key={r} value={r}>
                {r} (cạnh dài {r === "2K" ? 2048 : 1024}px)
              </option>
            ))}
          </select>
        </label>

        <button
          onClick={() => void onRenderAll()}
          disabled={rendering || withArtwork === 0}
          className="btn-gradient ml-auto rounded-xl px-6 py-2.5 text-sm font-bold text-white"
          title="Render lại toàn bộ frame có artwork — dùng sau khi đổi defs"
        >
          {rendering ? "Đang render…" : `🎬 Render lại tất cả (${withArtwork} frame)`}
        </button>
      </div>

      <div>
        <label className="text-sm font-semibold">
          Thư viện SVG (defs){" "}
          <span className="text-xs font-normal text-muted">
            — định nghĩa nhân vật MỘT LẦN là {"<symbol>"}, mọi frame {"<use>"} lại → đồng
            nhất 100%
          </span>
        </label>
        <textarea
          value={value}
          onChange={(e) => onDefsChange(e.target.value)}
          rows={6}
          spellCheck={false}
          placeholder={'<symbol id="mascot" viewBox="0 0 200 300">\n  <path d="…" fill="#f97316"/>\n</symbol>\n<linearGradient id="bg">…</linearGradient>'}
          className="mt-1.5 w-full resize-y rounded-xl border border-line bg-card-2 px-4 py-3 font-mono text-[11px] leading-relaxed outline-none placeholder:text-muted/50 focus:border-accent"
        />
      </div>
    </div>
  );
}
