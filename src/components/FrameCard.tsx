"use client";

import type { FrameDto } from "@/lib/api";
import { useAppStore } from "@/lib/store/useAppStore";
import { formatFrameBadge } from "@/lib/services/frameService";

/* eslint-disable @next/next/no-img-element */

const STATUS_LABELS: Record<string, string> = {
  pending: "Đang chờ…",
  generating: "Đang tạo ảnh…",
  watermarking: "Đang đóng watermark…",
};

interface FrameCardProps {
  frame: FrameDto;
  aspectRatio: string;
}

export function FrameCard({ frame, aspectRatio }: FrameCardProps) {
  const startGeneration = useAppStore((s) => s.startGeneration);
  const job = useAppStore((s) => s.job);

  const [rw, rh] = aspectRatio.split(":").map(Number);
  const ratioStyle = { aspectRatio: `${rw || 16} / ${rh || 9}` };

  const busy = ["pending", "generating", "watermarking"].includes(frame.status);

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
        ) : busy ? (
          <div className="skeleton flex h-full w-full flex-col items-center justify-center gap-2">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            <span className="text-xs text-muted">{STATUS_LABELS[frame.status]}</span>
          </div>
        ) : frame.status === "failed" ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-rose-950/20 px-4 text-center">
            <span className="text-lg">⚠️</span>
            <span className="line-clamp-3 text-xs text-rose-300">{frame.errorMsg}</span>
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-bg/40">
            <span className="text-xs text-muted/60">Chưa generate</span>
          </div>
        )}

        <span className="btn-gradient absolute left-2 top-2 rounded-md px-1.5 py-0.5 text-[11px] font-bold text-white">
          {formatFrameBadge(frame.index)}
        </span>

        {!busy && !job && (
          <button
            onClick={() => void startGeneration([frame.id])}
            className="absolute bottom-2 right-2 hidden rounded-lg bg-black/70 px-2.5 py-1.5 text-[11px] font-semibold text-white backdrop-blur transition hover:bg-black/90 group-hover:block"
            title="Chỉ generate lại frame này — không ảnh hưởng frame khác"
          >
            ↻ Tạo lại frame này
          </button>
        )}
      </div>

      <p className="line-clamp-2 px-3 py-2 text-xs text-muted" title={frame.description}>
        {frame.description || "—"}
      </p>
    </div>
  );
}
