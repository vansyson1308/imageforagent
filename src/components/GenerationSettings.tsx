"use client";

import { useAppStore } from "@/lib/store/useAppStore";
import { ASPECT_RATIOS, RESOLUTIONS } from "@/lib/validation/schemas";
import { WatermarkSettings } from "@/components/WatermarkSettings";

export function GenerationSettings() {
  const project = useAppStore((s) => s.project);
  const frames = useAppStore((s) => s.frames);
  const meta = useAppStore((s) => s.meta);
  const job = useAppStore((s) => s.job);
  const patchProject = useAppStore((s) => s.patchProject);
  const startGeneration = useAppStore((s) => s.startGeneration);
  const cancelGeneration = useAppStore((s) => s.cancelGeneration);

  if (!project) return null;

  const generatableCount = frames.filter((f) => f.description.trim() !== "").length;
  const running = job !== null;

  return (
    <div className="flex flex-col gap-4">
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
                {r}
              </option>
            ))}
          </select>
        </label>

        <div className="ml-auto flex items-center gap-3">
          {meta && (
            <span className="rounded-xl border border-line bg-card-2 px-3 py-2 text-xs text-muted">
              Provider:{" "}
              <b className={meta.imageProvider === "mock" ? "text-amber-400" : "text-emerald-400"}>
                {meta.imageProvider}
              </b>
              {" · "}
              Hôm nay: <b className="text-ink">{meta.dailyUsed}/{meta.dailyLimit}</b>
            </span>
          )}
          {running ? (
            <button
              onClick={() => void cancelGeneration()}
              className="rounded-xl border border-rose-500 px-6 py-2.5 text-sm font-bold text-rose-400 transition hover:bg-rose-500/10"
            >
              ■ Dừng
            </button>
          ) : (
            <button
              onClick={() => void startGeneration()}
              disabled={generatableCount === 0}
              className="btn-gradient rounded-xl px-6 py-2.5 text-sm font-bold text-white"
            >
              ▶ Bắt đầu tạo Storyboard ({generatableCount} frame)
            </button>
          )}
        </div>
      </div>

      <WatermarkSettings />
    </div>
  );
}
