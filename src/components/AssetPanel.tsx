"use client";

import { useRef, useState, type DragEvent } from "react";
import { useAppStore } from "@/lib/store/useAppStore";

/* eslint-disable @next/next/no-img-element */

/**
 * Mục 3 — Watermark logo (1 ảnh PNG nền trong suốt, upload mới thay cũ).
 * Nhân vật/asset của cảnh giờ nằm trong SVG defs (mục Artwork) — không cần
 * upload ảnh reference nữa.
 */
export function AssetPanel() {
  const assets = useAppStore((s) => s.assets);
  const uploadAssets = useAppStore((s) => s.uploadAssets);
  const deleteAsset = useAppStore((s) => s.deleteAsset);

  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);

  const watermark = assets.find((a) => a.kind === "watermark");

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploading(true);
    try {
      await uploadAssets("watermark", [list[0]]);
    } finally {
      setUploading(false);
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    void handleFiles(e.dataTransfer.files);
  }

  return (
    <section
      className="fade-up rounded-card border border-line bg-card p-6"
      style={{ animationDelay: "120ms" }}
    >
      <h2 className="text-lg font-bold">3. Watermark</h2>
      <p className="mt-0.5 text-sm text-muted">
        Logo bản quyền đóng tự động lên mọi ảnh render — 1 file PNG nền trong suốt, upload
        mới sẽ thay cũ
      </p>

      <div className="mt-4 flex items-center gap-3">
        {watermark && (
          <div className="group relative h-20 w-40">
            <img
              src={watermark.url}
              alt="Watermark"
              className="h-full w-full rounded-lg border border-line bg-bg object-contain p-2"
            />
            <button
              onClick={() => void deleteAsset(watermark.id)}
              className="absolute -right-1.5 -top-1.5 hidden h-5 w-5 items-center justify-center rounded-full bg-rose-600 text-[11px] font-bold text-white shadow group-hover:flex"
              title="Xoá watermark"
            >
              ✕
            </button>
          </div>
        )}

        <button
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`flex h-20 w-40 flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-2xl text-muted transition ${
            dragOver
              ? "border-accent bg-accent/10 text-accent"
              : "border-line hover:border-accent hover:text-accent"
          }`}
          title="Bấm hoặc kéo thả ảnh vào đây"
        >
          {uploading ? (
            <span className="text-xs">…</span>
          ) : (
            <>
              {watermark ? "↻" : "+"}
              <span className="text-[10px] leading-none">PNG/JPG/WebP ≤8MB</span>
            </>
          )}
        </button>

        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
    </section>
  );
}
