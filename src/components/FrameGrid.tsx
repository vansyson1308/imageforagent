"use client";

import { useAppStore } from "@/lib/store/useAppStore";
import { FrameCard } from "@/components/FrameCard";
import { ArtworkPanel } from "@/components/ArtworkPanel";
import { WatermarkSettings } from "@/components/WatermarkSettings";

export function FrameGrid() {
  const frames = useAppStore((s) => s.frames);
  const project = useAppStore((s) => s.project);

  const sorted = frames.slice().sort((a, b) => a.index - b.index);
  const doneCount = sorted.filter((f) => f.status === "done").length;

  return (
    <section
      className="fade-up rounded-card border border-line bg-card p-6"
      style={{ animationDelay: "180ms" }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold">4. Artwork & Render</h2>
        {sorted.length > 0 && (
          <span className="text-sm text-muted">
            {doneCount}/{sorted.length} frame đã render
          </span>
        )}
      </div>

      <div className="mt-4 flex flex-col gap-4">
        <ArtworkPanel />
        <WatermarkSettings />
      </div>

      {sorted.length > 0 && project && (
        <div
          className={`mt-5 grid gap-4 ${
            project.aspectRatio === "9:16"
              ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"
              : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
          }`}
        >
          {sorted.map((frame) => (
            <FrameCard key={frame.id} frame={frame} aspectRatio={project.aspectRatio} />
          ))}
        </div>
      )}
    </section>
  );
}
