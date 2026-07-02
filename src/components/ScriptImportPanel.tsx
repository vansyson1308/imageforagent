"use client";

import { useState } from "react";
import { useAppStore } from "@/lib/store/useAppStore";
import { ApiError } from "@/lib/api";

type Tab = "sheet" | "tsv";

export function ScriptImportPanel() {
  const importScript = useAppStore((s) => s.importScript);
  const meta = useAppStore((s) => s.meta);
  const project = useAppStore((s) => s.project);

  const [tab, setTab] = useState<Tab>("sheet");
  const [sheetUrl, setSheetUrl] = useState("");
  const [tsvText, setTsvText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [copied, setCopied] = useState(false);

  const serviceEmail = meta?.serviceAccountEmail;

  async function submit(confirmOverwrite = false) {
    setLoading(true);
    setError(null);
    setNeedsConfirm(false);
    try {
      await importScript({
        source: tab,
        sheetUrl: tab === "sheet" ? sheetUrl.trim() : undefined,
        tsvText: tab === "tsv" ? tsvText : undefined,
        confirmOverwrite,
      });
      setTsvText("");
    } catch (err) {
      if (err instanceof ApiError && err.code === "CONFIRM_REQUIRED") {
        setNeedsConfirm(true);
        setError(err.message);
      } else if (err instanceof ApiError) {
        setError(err.hint ? `${err.message} ${err.hint}` : err.message);
      } else {
        setError(err instanceof Error ? err.message : "Lỗi không xác định");
      }
    } finally {
      setLoading(false);
    }
  }

  async function copyEmail() {
    if (!serviceEmail) return;
    await navigator.clipboard.writeText(serviceEmail);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const canSubmit =
    !loading && (tab === "sheet" ? sheetUrl.trim() !== "" : tsvText.trim() !== "");

  return (
    <section className="fade-up rounded-card border border-line bg-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">1. Nhập kịch bản</h2>
          <p className="mt-0.5 text-sm text-muted">
            Định dạng 3 cột: STT · Shot Type · Description (dòng 1 là header)
          </p>
        </div>
        <div className="flex rounded-xl border border-line bg-card-2 p-1 text-sm">
          <button
            className={`rounded-lg px-4 py-1.5 font-medium transition ${
              tab === "sheet" ? "btn-gradient text-white" : "text-muted hover:text-ink"
            }`}
            onClick={() => setTab("sheet")}
          >
            Link Google Sheet
          </button>
          <button
            className={`rounded-lg px-4 py-1.5 font-medium transition ${
              tab === "tsv" ? "btn-gradient text-white" : "text-muted hover:text-ink"
            }`}
            onClick={() => setTab("tsv")}
          >
            Dán từ Clipboard
          </button>
        </div>
      </div>

      <div className="mt-4">
        {tab === "sheet" ? (
          <div className="flex flex-col gap-3">
            <input
              value={sheetUrl}
              onChange={(e) => setSheetUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/…"
              className="w-full rounded-xl border border-line bg-card-2 px-4 py-3 text-sm outline-none placeholder:text-muted/60 focus:border-accent"
            />
            <div className="rounded-xl border border-line bg-card-2/60 px-4 py-3 text-xs text-muted">
              {serviceEmail ? (
                <>
                  Share quyền <b className="text-ink">Viewer</b> cho service account:{" "}
                  <code className="rounded bg-bg px-1.5 py-0.5 text-accent">{serviceEmail}</code>
                  <button
                    onClick={copyEmail}
                    className="ml-2 rounded-lg border border-line px-2 py-0.5 text-[11px] text-ink transition hover:border-accent"
                  >
                    {copied ? "Đã copy ✓" : "Copy"}
                  </button>
                </>
              ) : (
                <>
                  Chưa cấu hình Google Service Account — thêm{" "}
                  <code className="text-accent">GOOGLE_SERVICE_ACCOUNT_JSON</code> vào .env (xem
                  README), hoặc dùng tab <b className="text-ink">Dán từ Clipboard</b>.
                </>
              )}
            </div>
          </div>
        ) : (
          <textarea
            value={tsvText}
            onChange={(e) => setTsvText(e.target.value)}
            rows={6}
            placeholder={
              "Copy vùng dữ liệu từ Google Sheet/Excel rồi dán vào đây…\nVD:\nSTT\tShot Type\tDescription\n1\tStatic shot\tMascot xuất hiện…"
            }
            className="w-full resize-y rounded-xl border border-line bg-card-2 px-4 py-3 font-mono text-xs outline-none placeholder:text-muted/60 focus:border-accent"
          />
        )}
      </div>

      {error && (
        <div className="mt-3 rounded-xl border border-rose-900/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-300">
          {error}
          {needsConfirm && (
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => submit(true)}
                className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rose-500"
              >
                Ghi đè toàn bộ
              </button>
              <button
                onClick={() => {
                  setNeedsConfirm(false);
                  setError(null);
                }}
                className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition hover:text-ink"
              >
                Huỷ
              </button>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button
          disabled={!canSubmit || !project}
          onClick={() => submit(false)}
          className="btn-gradient rounded-xl px-6 py-2.5 text-sm font-bold text-white"
        >
          {loading ? "Đang phân tích…" : "Phân tích kịch bản"}
        </button>
        {loading && <span className="text-xs text-muted">Đang đọc dữ liệu…</span>}
      </div>
    </section>
  );
}
