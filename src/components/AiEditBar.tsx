"use client";

import { useState } from "react";
import { api, ApiError, type AiEditFrameDto } from "@/lib/api";
import { useAppStore } from "@/lib/store/useAppStore";
import { AiDiffModal } from "@/components/AiDiffModal";

export function AiEditBar() {
  const project = useAppStore((s) => s.project);
  const frames = useAppStore((s) => s.frames);

  const [instruction, setInstruction] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<AiEditFrameDto[] | null>(null);

  async function submit() {
    if (!project || instruction.trim().length < 3) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.aiEdit(project.id, instruction.trim());
      setProposal(result.frames);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.hint ? `${err.message} ${err.hint}` : err.message);
      } else {
        setError(err instanceof Error ? err.message : "Lỗi không xác định");
      }
    } finally {
      setLoading(false);
    }
  }

  if (frames.length === 0) return null;

  return (
    <div className="mt-5 border-t border-line pt-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
          placeholder="Nhờ AI sửa toàn bộ kịch bản… (VD: đổi bối cảnh sang ban đêm trời mưa)"
          className="flex-1 rounded-xl border border-line bg-card-2 px-4 py-2.5 text-sm outline-none placeholder:text-muted/60 focus:border-accent"
        />
        <button
          onClick={() => void submit()}
          disabled={loading || instruction.trim().length < 3}
          className="btn-gradient rounded-xl px-5 py-2.5 text-sm font-bold text-white"
        >
          {loading ? "AI đang xử lý…" : "✨ AI sửa kịch bản"}
        </button>
      </div>
      {error && (
        <p className="mt-2 rounded-xl border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-xs text-rose-300">
          {error}
        </p>
      )}

      {proposal && (
        <AiDiffModal
          proposal={proposal}
          onClose={() => {
            setProposal(null);
            setInstruction("");
          }}
        />
      )}
    </div>
  );
}
