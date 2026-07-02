"use client";

import { useRef, useState, type DragEvent } from "react";
import { useAppStore } from "@/lib/store/useAppStore";
import { ASSET_LIMITS, type AssetKind } from "@/lib/config/limits";

/* eslint-disable @next/next/no-img-element */

interface ZoneConfig {
  kind: AssetKind;
  title: string;
  hint: string;
}

const ZONES: ZoneConfig[] = [
  {
    kind: "mascot_ref",
    title: "Ảnh nhân vật / Mascot",
    hint: "Tối đa 3 ảnh — góc nhìn khác nhau càng tốt",
  },
  {
    kind: "style_ref",
    title: "Ảnh phong cách / Bối cảnh",
    hint: "Tối đa 3 ảnh tham chiếu style",
  },
  {
    kind: "watermark",
    title: "Logo Watermark",
    hint: "1 ảnh PNG nền trong suốt — upload mới sẽ thay cũ",
  },
];

function UploadZone({ config }: { config: ZoneConfig }) {
  const assets = useAppStore((s) => s.assets);
  const uploadAssets = useAppStore((s) => s.uploadAssets);
  const deleteAsset = useAppStore((s) => s.deleteAsset);

  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);

  const items = assets
    .filter((a) => a.kind === config.kind)
    .sort((a, b) => a.order - b.order);
  const limit = ASSET_LIMITS[config.kind];
  const remaining = config.kind === "watermark" ? 1 : limit - items.length;

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploading(true);
    try {
      await uploadAssets(config.kind, list);
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
    <div className="flex-1 rounded-xl border border-line bg-card-2/50 p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">{config.title}</h3>
        <span className="text-xs text-muted">
          {items.length}/{limit}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-muted">{config.hint}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        {items.map((asset) => (
          <div key={asset.id} className="group relative h-20 w-20">
            <img
              src={asset.url}
              alt={config.title}
              className="h-full w-full rounded-lg border border-line object-cover"
            />
            <button
              onClick={() => void deleteAsset(asset.id)}
              className="absolute -right-1.5 -top-1.5 hidden h-5 w-5 items-center justify-center rounded-full bg-rose-600 text-[11px] font-bold text-white shadow group-hover:flex"
              title="Xoá ảnh này"
            >
              ✕
            </button>
          </div>
        ))}

        {remaining > 0 && (
          <button
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={`flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-2xl text-muted transition ${
              dragOver ? "border-accent bg-accent/10 text-accent" : "border-line hover:border-accent hover:text-accent"
            }`}
            title="Bấm hoặc kéo thả ảnh vào đây"
          >
            {uploading ? (
              <span className="text-xs">…</span>
            ) : (
              <>
                +<span className="text-[10px] leading-none">PNG/JPG/WebP</span>
              </>
            )}
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple={config.kind !== "watermark"}
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          if (e.target.files) void handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {config.kind === "mascot_ref" && (
        <p className="mt-3 text-[11px] leading-relaxed text-muted/70">
          ⚠️ Chỉ dùng nhân vật gốc của bạn hoặc được cấp quyền — không dùng nhân vật có bản
          quyền của bên thứ ba.
        </p>
      )}
    </div>
  );
}

export function AssetPanel() {
  const project = useAppStore((s) => s.project);
  const patchProject = useAppStore((s) => s.patchProject);
  const [desc, setDesc] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const value = desc ?? project?.characterDesc ?? "";

  function onDescChange(next: string) {
    setDesc(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void patchProject({ characterDesc: next });
    }, 800);
  }

  return (
    <section
      className="fade-up rounded-card border border-line bg-card p-6"
      style={{ animationDelay: "120ms" }}
    >
      <h2 className="text-lg font-bold">3. Tài sản tham chiếu</h2>
      <p className="mt-0.5 text-sm text-muted">
        Reference giữ nhân vật đồng nhất 100% qua mọi frame
      </p>

      <div className="mt-4 flex flex-col gap-4 lg:flex-row">
        {ZONES.map((zone) => (
          <UploadZone key={zone.kind} config={zone} />
        ))}
      </div>

      <div className="mt-4">
        <label className="text-sm font-semibold">Mô tả nhân vật / Mascot</label>
        <textarea
          value={value}
          onChange={(e) => onDescChange(e.target.value)}
          rows={2}
          placeholder="VD: Chú cáo cam tên Tantan, đeo tạp dề đỏ có logo tô mì, mắt to tròn, luôn tươi cười…"
          className="mt-1.5 w-full resize-y rounded-xl border border-line bg-card-2 px-4 py-3 text-sm outline-none placeholder:text-muted/60 focus:border-accent"
        />
      </div>
    </section>
  );
}
