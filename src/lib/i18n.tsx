"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Tiny VI/EN switch for the Director, unlock and showcase surfaces. UI
 * strings stay Vietnamese by default (repo rule); EN is a visitor toggle
 * persisted in localStorage.
 */

export type Lang = "vi" | "en";
const KEY = "sbs-lang";
const EVENT = "sbs-lang-change";

function read(): Lang {
  try {
    return localStorage.getItem(KEY) === "en" ? "en" : "vi";
  } catch {
    return "vi";
  }
}

function subscribe(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function useLang(): [Lang, (l: Lang) => void] {
  const lang = useSyncExternalStore(subscribe, read, () => "vi" as Lang);
  const set = useCallback((l: Lang) => {
    try {
      localStorage.setItem(KEY, l);
    } catch {
      // private mode → session-only
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [lang, set];
}

const DICT = {
  directorTitle: { vi: "Đạo diễn AI: đội Nemotron", en: "AI Director: the Nemotron crew" },
  directorSub: {
    vi: "Kể một câu chuyện, bất kỳ ngôn ngữ nào. Ultra lên phân cảnh, Super vẽ từng khung bằng code, engine đo bản render và Nano chấm điểm + yêu cầu sửa, Nano biên tập thoại + nhịp.",
    en: "Tell a story in any language. Ultra plans the shots, Super draws every frame as code, the engine measures each render and Nano critiques it and asks for fixes, Nano edits dialogue and timing.",
  },
  storyLabel: { vi: "Câu chuyện", en: "Your story" },
  storyPlaceholder: {
    vi: "Ví dụ: Đêm Trung thu, bé Lan thắp chiếc đèn ông sao. Gió thổi đèn bay qua mái nhà…",
    en: "E.g. On Mid-Autumn night, little Lan lights a star lantern. The wind carries it over the rooftops…",
  },
  filmLanguage: { vi: "Ngôn ngữ phim", en: "Film language" },
  style: { vi: "Phong cách", en: "Style" },
  shots: { vi: "Số shot tối đa", en: "Max shots" },
  critic: { vi: "Critic (Nano + số đo render)", en: "Critic (Nano + render measurements)" },
  criticTextTitle: {
    vi: "Token Factory chưa có Nemotron nhận ảnh: Nano chấm dựa trên SVG + số đo của engine trên bản render",
    en: "Token Factory serves no image-input Nemotron yet: Nano judges from the SVG + the engine's measurements of the render",
  },
  research: { vi: "Tra cứu tham chiếu (Tavily)", en: "Reference research (Tavily)" },
  make: { vi: "🎬 Làm phim của tôi", en: "🎬 Make my film" },
  cancel: { vi: "Dừng", en: "Cancel" },
  confirmReplace: {
    vi: "Đạo diễn sẽ thay toàn bộ kịch bản + artwork hiện tại của project này. Tiếp tục?",
    en: "The Director replaces this project's script and artwork. Continue?",
  },
  disabled: {
    vi: "Chưa bật: server cần NEBIUS_API_KEY (hoặc LLM_PROVIDER=mock để chạy đội mẫu). Engine không-key vẫn dùng bình thường bên dưới.",
    en: "Not enabled: the server needs NEBIUS_API_KEY (or LLM_PROVIDER=mock for the scripted crew). The zero-key engine below works as usual.",
  },
  mockNote: { vi: "Đang chạy đội MẪU (mock): không gọi model thật.", en: "Running the scripted MOCK crew: no real model calls." },
  timeline: { vi: "Dòng thời gian của đội", en: "Crew timeline" },
  shotsTitle: { vi: "Các shot", en: "Shots" },
  tokens: { vi: "token", en: "tokens" },
  elapsed: { vi: "đã chạy", en: "elapsed" },
  film: { vi: "Phim hoàn chỉnh", en: "Your film" },
  downloadMp4: { vi: "⬇ Tải MP4", en: "⬇ Download MP4" },
  downloadZip: { vi: "⬇ Tải gói sản xuất (ZIP)", en: "⬇ Download production package (ZIP)" },
  assembling: { vi: "Đang dựng MP4 (ffmpeg)…", en: "Assembling the MP4 (ffmpeg)…" },
  summary: { vi: "Tổng kết", en: "Summary" },
  firstPass: { vi: "đạt ngay lần đầu", en: "first-pass OK" },
  repairs: { vi: "lần sửa", en: "repairs" },
  uplift: { vi: "điểm critic", en: "critic score" },
  lint: { vi: "lint còn lại", en: "lint left" },
  references: { vi: "Tham chiếu (Tavily)", en: "References (Tavily)" },
  status_done: { vi: "Xong", en: "Done" },
  status_cancelled: { vi: "Đã dừng", en: "Cancelled" },
  status_failed: { vi: "Lỗi", en: "Failed" },
  status_budget_exceeded: { vi: "Hết ngân sách", en: "Budget reached" },
  showcase: { vi: "🎞 Phim mẫu", en: "🎞 Showcase" },
  unlockTitle: { vi: "Bản demo công khai", en: "Public demo" },
  unlockSub: {
    vi: "Nhập mật khẩu demo (có trong phần Testing instructions của bài dự thi).",
    en: "Enter the demo passcode (see the submission's testing instructions).",
  },
  passcode: { vi: "Mật khẩu", en: "Passcode" },
  unlock: { vi: "Mở khoá", en: "Unlock" },
  notConfigured: { vi: "Server chưa đặt DEMO_PASSCODE.", en: "This server has no DEMO_PASSCODE set." },
} as const;

export type I18nKey = keyof typeof DICT;

export function t(lang: Lang, key: I18nKey): string {
  return DICT[key][lang];
}

export function LangToggle({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  return (
    <div className="flex rounded-xl border border-line bg-card-2 p-1 text-xs" role="group" aria-label="Language">
      {(["vi", "en"] as const).map((l) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          className={`rounded-lg px-3 py-1 font-semibold uppercase transition ${lang === l ? "btn-gradient text-white" : "text-muted hover:text-ink"}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
