"use client";

import { useAppStore } from "@/lib/store/useAppStore";

export function SaveIndicator() {
  const saveState = useAppStore((s) => s.saveState);

  if (saveState === "idle") return null;

  const label =
    saveState === "saving" ? "Đang lưu…" : saveState === "saved" ? "Đã lưu ✓" : "Lỗi lưu!";
  const color =
    saveState === "saving"
      ? "text-muted"
      : saveState === "saved"
        ? "text-emerald-400"
        : "text-rose-400";

  return <span className={`text-xs ${color} transition-colors`}>{label}</span>;
}
