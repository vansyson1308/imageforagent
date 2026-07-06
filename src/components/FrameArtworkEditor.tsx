"use client";

import { useState } from "react";
import { ApiError, type FrameDto } from "@/lib/api";
import { useAppStore } from "@/lib/store/useAppStore";

interface FrameArtworkEditorProps {
  frame: FrameDto;
}

/** Editor SVG per-frame: dán body SVG (không có root <svg>) → Render. */
export function FrameArtworkEditor({ frame }: FrameArtworkEditorProps) {
  const saveArtwork = useAppStore((s) => s.saveArtwork);

  const [svg, setSvg] = useState(frame.artworkSvg ?? "");
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function render() {
    if (!svg.trim()) return;
    setRendering(true);
    setError(null);
    try {
      await saveArtwork(frame.id, svg);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.hint ? `${err.message} ${err.hint}` : err.message);
      } else {
        setError(err instanceof Error ? err.message : "Render lỗi");
      }
    } finally {
      setRendering(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-line px-3 py-2.5">
      <textarea
        value={svg}
        onChange={(e) => setSvg(e.target.value)}
        rows={5}
        spellCheck={false}
        placeholder={'Body SVG của cảnh (không có <svg> root)…\nVD: <rect width="1920" height="1080" fill="url(#bg)"/>\n    <use href="#mascot" x="800" y="300" width="320" height="480"/>'}
        className="w-full resize-y rounded-lg border border-line bg-bg px-3 py-2 font-mono text-[11px] leading-relaxed outline-none placeholder:text-muted/50 focus:border-accent"
      />
      {error && (
        <p className="rounded-lg border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-xs text-rose-300">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <button
          onClick={() => void render()}
          disabled={rendering || !svg.trim()}
          className="btn-gradient rounded-lg px-4 py-1.5 text-xs font-bold text-white"
        >
          {rendering ? "Đang render…" : "🎨 Render frame"}
        </button>
      </div>
    </div>
  );
}
