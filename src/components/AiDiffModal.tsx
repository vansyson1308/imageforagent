"use client";

import { useMemo, useState } from "react";
import type { AiEditFrameDto } from "@/lib/api";
import { useAppStore } from "@/lib/store/useAppStore";
import { formatFrameBadge } from "@/lib/services/frameService";

interface AiDiffModalProps {
  proposal: AiEditFrameDto[];
  onClose: () => void;
}

/**
 * Diff-review đề xuất của AI: so sánh cũ/mới từng frame, chọn áp dụng
 * tất cả hoặc từng frame. Chỉ khi bấm Áp dụng mới ghi DB.
 */
export function AiDiffModal({ proposal, onClose }: AiDiffModalProps) {
  const frames = useAppStore((s) => s.frames);
  const applyAiEdit = useAppStore((s) => s.applyAiEdit);
  const setToast = useAppStore((s) => s.setToast);

  const [applying, setApplying] = useState(false);

  const oldByIndex = useMemo(
    () => new Map(frames.map((f) => [f.index, f])),
    [frames],
  );

  const countChanged = proposal.filter((p) => {
    const old = oldByIndex.get(p.index);
    return !old || old.description !== p.description || old.shotType !== p.shotType;
  }).length;

  const sameCount = proposal.length === frames.length;

  // Chọn từng frame (chỉ khi số frame không đổi); mặc định chọn frame có thay đổi
  const [selected, setSelected] = useState<Set<number>>(
    () =>
      new Set(
        proposal
          .filter((p) => {
            const old = oldByIndex.get(p.index);
            return !old || old.description !== p.description || old.shotType !== p.shotType;
          })
          .map((p) => p.index),
      ),
  );

  function toggle(index: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  async function apply(all: boolean) {
    setApplying(true);
    try {
      const merged = all || !sameCount
        ? proposal
        : proposal.map((p) => {
            if (selected.has(p.index)) return p;
            const old = oldByIndex.get(p.index);
            return old
              ? { index: p.index, shotType: old.shotType, description: old.description }
              : p;
          });
      await applyAiEdit(merged);
      setToast(`Đã áp dụng đề xuất AI cho ${all ? proposal.length : merged.length} frame ✓`);
      onClose();
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Lỗi áp dụng đề xuất");
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-card border border-line bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-line px-6 py-4">
          <h3 className="font-bold">Đề xuất của AI</h3>
          <p className="mt-0.5 text-sm text-muted">
            {countChanged}/{proposal.length} frame thay đổi
            {!sameCount && ` · số frame đổi từ ${frames.length} → ${proposal.length}`}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="flex flex-col gap-3">
            {proposal.map((p) => {
              const old = oldByIndex.get(p.index);
              const descChanged = !old || old.description !== p.description;
              const shotChanged = !old || old.shotType !== p.shotType;
              const changed = descChanged || shotChanged;
              return (
                <div
                  key={p.index}
                  className={`rounded-xl border px-4 py-3 ${
                    changed ? "border-accent/50 bg-card-2" : "border-line bg-card-2/40 opacity-70"
                  }`}
                >
                  <div className="flex items-center gap-2 text-xs">
                    <span className="btn-gradient rounded-md px-1.5 py-0.5 font-bold text-white">
                      {formatFrameBadge(p.index)}
                    </span>
                    <span className={shotChanged ? "font-semibold text-accent" : "text-muted"}>
                      {p.shotType}
                    </span>
                    {changed && sameCount && (
                      <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-muted">
                        <input
                          type="checkbox"
                          checked={selected.has(p.index)}
                          onChange={() => toggle(p.index)}
                          className="accent-[var(--color-accent)]"
                        />
                        Áp dụng frame này
                      </label>
                    )}
                  </div>
                  {descChanged && old && (
                    <p className="mt-2 text-xs text-muted line-through decoration-rose-500/60">
                      {old.description}
                    </p>
                  )}
                  <p className={`mt-1 text-sm ${descChanged ? "text-emerald-300" : "text-ink"}`}>
                    {p.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-line px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-xl border border-line px-4 py-2 text-sm text-muted transition hover:text-ink"
          >
            Huỷ
          </button>
          {sameCount && (
            <button
              onClick={() => void apply(false)}
              disabled={applying || selected.size === 0}
              className="rounded-xl border border-accent px-4 py-2 text-sm font-semibold text-accent transition hover:bg-accent/10 disabled:opacity-40"
            >
              Áp dụng {selected.size} frame đã chọn
            </button>
          )}
          <button
            onClick={() => void apply(true)}
            disabled={applying}
            className="btn-gradient rounded-xl px-5 py-2 text-sm font-bold text-white"
          >
            {applying ? "Đang áp dụng…" : "Áp dụng tất cả"}
          </button>
        </div>
      </div>
    </div>
  );
}
