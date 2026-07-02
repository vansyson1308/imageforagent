"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "@/lib/store/useAppStore";

/* eslint-disable @next/next/no-img-element */

/**
 * PreviewPlayer — slideshow các frame done, đúng aspect ratio project,
 * crossfade 200ms, phím tắt Space/←/→, tốc độ 0.5–5 s/frame (persist).
 */
export function PreviewPlayer() {
  const project = useAppStore((s) => s.project);
  const frames = useAppStore((s) => s.frames);
  const patchProject = useAppStore((s) => s.patchProject);

  const playlist = useMemo(
    () =>
      frames
        .filter((f) => f.status === "done" && f.imageUrl)
        .sort((a, b) => a.index - b.index),
    [frames],
  );

  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [speed, setSpeed] = useState(project?.playbackSpeed ?? 1.5);

  const speedRef = useRef(speed);
  speedRef.current = speed;
  const speedDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clampedCursor = Math.min(cursor, Math.max(0, playlist.length - 1));
  const current = playlist[clampedCursor];

  const next = useCallback(() => {
    setCursor((c) => {
      if (c + 1 < playlist.length) return c + 1;
      if (loop) return 0;
      setPlaying(false);
      return c;
    });
  }, [playlist.length, loop]);

  const prev = useCallback(() => {
    setCursor((c) => (c - 1 >= 0 ? c - 1 : loop ? Math.max(0, playlist.length - 1) : 0));
  }, [playlist.length, loop]);

  // Timer phát
  useEffect(() => {
    if (!playing || playlist.length === 0) return;
    const timer = setInterval(() => next(), speed * 1000);
    return () => clearInterval(timer);
  }, [playing, speed, next, playlist.length]);

  // Preload ảnh kế tiếp
  useEffect(() => {
    const upcoming = playlist[clampedCursor + 1] ?? playlist[0];
    if (upcoming?.imageUrl) {
      const img = new Image();
      img.src = upcoming.imageUrl;
    }
  }, [clampedCursor, playlist]);

  // Phím tắt — bỏ qua khi đang gõ trong input/textarea
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (e.code === "Space") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === "ArrowRight") {
        next();
      } else if (e.key === "ArrowLeft") {
        prev();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev]);

  function onSpeedChange(value: number) {
    setSpeed(value);
    if (speedDebounce.current) clearTimeout(speedDebounce.current);
    speedDebounce.current = setTimeout(() => {
      void patchProject({ playbackSpeed: value });
    }, 600);
  }

  if (!project) return null;

  const [rw, rh] = project.aspectRatio.split(":").map(Number);

  return (
    <section
      className="fade-up rounded-card border border-line bg-card p-6"
      style={{ animationDelay: "240ms" }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">5. Preview</h2>
        <span className="flex items-center gap-2 rounded-lg border border-line bg-card-2 px-2.5 py-1 text-[11px] font-bold tracking-wider text-rose-400">
          <span className="live-dot h-2 w-2 rounded-full bg-rose-500" />
          LIVE PREVIEW
        </span>
      </div>

      {playlist.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">
          Chưa có frame nào hoàn thành — generate ảnh ở mục 4 trước.
        </p>
      ) : (
        <>
          {/* Màn chiếu */}
          <div
            className="relative mx-auto mt-4 w-full max-w-3xl overflow-hidden rounded-xl bg-black"
            style={{ aspectRatio: `${rw || 16} / ${rh || 9}` }}
          >
            {playlist.map((frame, i) => (
              <img
                key={frame.id}
                src={frame.imageUrl!}
                alt={`Frame ${frame.index}`}
                className="absolute inset-0 h-full w-full object-contain transition-opacity duration-200"
                style={{ opacity: i === clampedCursor ? 1 : 0 }}
              />
            ))}

            <span className="absolute right-3 top-3 rounded-lg bg-black/60 px-2 py-1 text-xs font-semibold text-white backdrop-blur">
              Frame {clampedCursor + 1}/{playlist.length}
            </span>

            {current && (
              <p className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-4 pb-3 pt-8 text-center text-sm text-white">
                {current.description}
              </p>
            )}
          </div>

          {/* Progress bar — click để seek */}
          <div className="mx-auto mt-3 flex max-w-3xl gap-1">
            {playlist.map((frame, i) => (
              <button
                key={frame.id}
                onClick={() => setCursor(i)}
                className={`h-1.5 flex-1 rounded-full transition ${
                  i === clampedCursor
                    ? "btn-gradient"
                    : i < clampedCursor
                      ? "bg-accent/40"
                      : "bg-line hover:bg-muted/40"
                }`}
                title={`Frame ${frame.index}`}
              />
            ))}
          </div>

          {/* Điều khiển */}
          <div className="mx-auto mt-4 flex max-w-3xl flex-wrap items-center justify-center gap-3">
            <button
              onClick={prev}
              className="rounded-xl border border-line px-4 py-2 text-sm transition hover:border-accent"
              title="Frame trước (←)"
            >
              ⏮
            </button>
            <button
              onClick={() => setPlaying(!playing)}
              className="btn-gradient rounded-xl px-8 py-2 text-sm font-bold text-white"
              title="Phát / Dừng (Space)"
            >
              {playing ? "⏸ Dừng" : "▶ Phát"}
            </button>
            <button
              onClick={next}
              className="rounded-xl border border-line px-4 py-2 text-sm transition hover:border-accent"
              title="Frame sau (→)"
            >
              ⏭
            </button>
            <button
              onClick={() => setLoop(!loop)}
              className={`rounded-xl border px-4 py-2 text-sm transition ${
                loop ? "border-accent text-accent" : "border-line text-muted hover:text-ink"
              }`}
              title="Lặp lại"
            >
              🔁
            </button>

            <label className="ml-2 flex items-center gap-2 text-sm text-muted">
              Tốc độ
              <input
                type="range"
                min={0.5}
                max={5}
                step={0.1}
                value={speed}
                onChange={(e) => onSpeedChange(Number(e.target.value))}
                className="w-32 accent-[var(--color-accent)]"
              />
              <span className="w-12 text-xs text-ink">{speed.toFixed(1)}s/f</span>
            </label>
          </div>
        </>
      )}
    </section>
  );
}
