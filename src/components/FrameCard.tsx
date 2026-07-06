"use client";

import { useState } from "react";
import type { FrameDto } from "@/lib/api";
import { formatFrameBadge } from "@/lib/services/frameService";
import { FrameArtworkEditor } from "@/components/FrameArtworkEditor";

/* eslint-disable @next/next/no-img-element */

interface FrameCardProps {
  frame: FrameDto;
  aspectRatio: string;
}

export function FrameCard({ frame, aspectRatio }: FrameCardProps) {
  const [editorOpen, setEditorOpen] = useState(frame.artworkSvg === null);

  const [rw, rh] = aspectRatio.split(":").map(Number);
  const ratioStyle = { aspectRatio: `${rw || 16} / ${rh || 9}` };

  return (
    <div className="group overflow-hidden rounded-xl border border-line bg-card-2 transition hover:border-accent/50">
      <div className="relative w-full overflow-hidden" style={ratioStyle}>
        {frame.imageUrl && frame.status === "done" ? (
          <img
            src={frame.imageUrl}
            alt={`Frame ${frame.index}`}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : frame.status === "failed" ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-rose-950/20 px-4 text-center">
            <span className="text-lg">⚠️</span>
            <span className="line-clamp-3 text-xs text-rose-300">{frame.errorMsg}</span>
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-bg/40">
            <span className="text-xs text-muted/60">Chưa có artwork — dán SVG bên dưới</span>
          </div>
        )}

        <span className="btn-gradient absolute left-2 top-2 rounded-md px-1.5 py-0.5 text-[11px] font-bold text-white">
          {formatFrameBadge(frame.index)}
        </span>
        <button
          onClick={() => setEditorOpen(!editorOpen)}
          className="absolute bottom-2 right-2 rounded-lg bg-black/70 px-2.5 py-1.5 text-[11px] font-semibold text-white opacity-0 backdrop-blur transition hover:bg-black/90 group-hover:opacity-100"
          title="Mở/đóng editor SVG"
        >
          {editorOpen ? "▲ Ẩn SVG" : "✎ Sửa SVG"}
        </button>
      </div>

      <p className="line-clamp-2 px-3 py-2 text-xs text-muted" title={frame.description}>
        {frame.description || "—"}
      </p>

      {editorOpen && <FrameArtworkEditor frame={frame} />}
    </div>
  );
}
