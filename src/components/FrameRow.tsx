"use client";

import { useEffect, useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { FrameDto } from "@/lib/api";
import { useAppStore } from "@/lib/store/useAppStore";
import { formatFrameBadge } from "@/lib/services/frameService";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-zinc-500",
  pending: "bg-amber-400",
  generating: "bg-sky-400",
  watermarking: "bg-violet-400",
  done: "bg-emerald-400",
  failed: "bg-rose-500",
};

interface FrameRowProps {
  frame: FrameDto;
}

export function FrameRow({ frame }: FrameRowProps) {
  const updateFrameLocal = useAppStore((s) => s.updateFrameLocal);
  const saveFrame = useAppStore((s) => s.saveFrame);
  const deleteFrame = useAppStore((s) => s.deleteFrame);
  const addFrame = useAppStore((s) => s.addFrame);

  const [editingDesc, setEditingDesc] = useState(false);
  const [editingShot, setEditingShot] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const descRef = useRef<HTMLTextAreaElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const originalRef = useRef<{ description: string; shotType: string }>({
    description: frame.description,
    shotType: frame.shotType,
  });

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: frame.id });

  useEffect(() => {
    if (editingDesc && descRef.current) {
      descRef.current.focus();
      descRef.current.setSelectionRange(
        descRef.current.value.length,
        descRef.current.value.length,
      );
    }
  }, [editingDesc]);

  function scheduleAutosave(patch: { shotType?: string; description?: string }) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void saveFrame(frame.id, patch), 800);
  }

  function commitDesc() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setEditingDesc(false);
    void saveFrame(frame.id, { description: frame.description });
    originalRef.current.description = frame.description;
  }

  function cancelDesc() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    updateFrameLocal(frame.id, { description: originalRef.current.description });
    setEditingDesc(false);
  }

  function commitShot() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setEditingShot(false);
    void saveFrame(frame.id, { shotType: frame.shotType });
    originalRef.current.shotType = frame.shotType;
  }

  async function copyContent() {
    await navigator.clipboard.writeText(`${frame.shotType}\t${frame.description}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group rounded-xl border border-line bg-card-2/70 transition ${
        isDragging ? "z-10 border-accent opacity-90 shadow-lg shadow-accent/20" : ""
      }`}
    >
      <div className="flex items-start gap-3 px-3 py-2.5">
        {/* Drag handle + badge */}
        <button
          {...attributes}
          {...listeners}
          className="mt-0.5 flex cursor-grab items-center gap-2 active:cursor-grabbing"
          title="Kéo để đổi thứ tự"
        >
          <span className="text-muted/50 transition group-hover:text-muted">⠿</span>
          <span className="btn-gradient rounded-lg px-2 py-1 text-xs font-bold text-white">
            {formatFrameBadge(frame.index)}
          </span>
        </button>

        {/* Shot type badge */}
        <div className="mt-0.5 w-40 shrink-0">
          {editingShot ? (
            <input
              autoFocus
              value={frame.shotType}
              onChange={(e) => updateFrameLocal(frame.id, { shotType: e.target.value })}
              onBlur={commitShot}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitShot();
                if (e.key === "Escape") {
                  updateFrameLocal(frame.id, { shotType: originalRef.current.shotType });
                  setEditingShot(false);
                }
              }}
              className="w-full rounded-lg border border-accent bg-bg px-2 py-1 text-xs outline-none"
            />
          ) : (
            <button
              onClick={() => {
                originalRef.current.shotType = frame.shotType;
                setEditingShot(true);
              }}
              className="max-w-full truncate rounded-lg border border-line bg-bg px-2 py-1 text-left text-xs text-accent transition hover:border-accent"
              title={frame.shotType}
            >
              {frame.shotType || "—"}
            </button>
          )}
        </div>

        {/* Description */}
        <div className="min-w-0 flex-1">
          {editingDesc ? (
            <textarea
              ref={descRef}
              value={frame.description}
              rows={expanded ? 4 : 2}
              onChange={(e) => {
                updateFrameLocal(frame.id, { description: e.target.value });
                scheduleAutosave({ description: e.target.value });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  commitDesc();
                }
                if (e.key === "Escape") cancelDesc();
              }}
              onBlur={commitDesc}
              className="w-full resize-none rounded-lg border border-accent bg-bg px-3 py-1.5 text-sm outline-none"
            />
          ) : (
            <button
              onClick={() => {
                originalRef.current.description = frame.description;
                setEditingDesc(true);
              }}
              className={`w-full rounded-lg px-3 py-1.5 text-left text-sm transition hover:bg-bg ${
                frame.description ? "" : "italic text-muted/60"
              } ${expanded ? "" : "line-clamp-2"}`}
            >
              {frame.description || "Bấm để nhập mô tả cảnh…"}
            </button>
          )}
        </div>

        {/* Status + actions */}
        <div className="flex shrink-0 items-center gap-1.5 pt-1">
          <span
            className={`h-2 w-2 rounded-full ${STATUS_COLORS[frame.status] ?? "bg-zinc-500"}`}
            title={frame.status}
          />
          <button
            onClick={copyContent}
            className="rounded-lg px-1.5 py-1 text-xs text-muted opacity-0 transition hover:text-ink group-hover:opacity-100"
            title="Copy nội dung"
          >
            {copied ? "✓" : "⧉"}
          </button>
          <button
            onClick={() => void addFrame(frame.index)}
            className="rounded-lg px-1.5 py-1 text-xs text-muted opacity-0 transition hover:text-ink group-hover:opacity-100"
            title="Chèn frame phía dưới"
          >
            +
          </button>
          {confirmDelete ? (
            <span className="flex items-center gap-1">
              <button
                onClick={() => void deleteFrame(frame.id)}
                className="rounded-lg bg-rose-600 px-2 py-1 text-[11px] font-semibold text-white"
              >
                Xoá
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="rounded-lg border border-line px-2 py-1 text-[11px] text-muted"
              >
                Huỷ
              </button>
            </span>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="rounded-lg px-1.5 py-1 text-xs text-muted opacity-0 transition hover:text-rose-400 group-hover:opacity-100"
              title="Xoá frame"
            >
              ✕
            </button>
          )}
          <button
            onClick={() => setExpanded(!expanded)}
            className={`rounded-lg px-1.5 py-1 text-xs text-muted transition hover:text-ink ${
              expanded ? "rotate-180" : ""
            }`}
            title="Xem đầy đủ"
          >
            ▾
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-line px-4 py-3 text-xs text-muted">
          <p className="whitespace-pre-wrap text-sm text-ink">{frame.description}</p>
          <div className="mt-2 flex flex-wrap gap-4">
            <span>
              Trạng thái: <b className="text-ink">{frame.status}</b>
            </span>
            {frame.generatedAt && (
              <span>Generate lúc: {new Date(frame.generatedAt).toLocaleString("vi-VN")}</span>
            )}
            {frame.errorMsg && <span className="text-rose-400">{frame.errorMsg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
