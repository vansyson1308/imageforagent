"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * EN / VI / JA switch for the judge-facing surfaces (landing, unlock,
 * Director, showcase). English is the default for visitors (judges); a
 * browser set to Vietnamese or Japanese starts in that language, and the
 * choice persists in localStorage. The legacy engine panels stay Vietnamese
 * (D13). JA covers the pilot surfaces (SPEC v2 WP5/WP6).
 */

export type Lang = "en" | "vi" | "ja";
export const LANGS: readonly Lang[] = ["en", "vi", "ja"];
const KEY = "sbs-lang";
const EVENT = "sbs-lang-change";

function read(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "en" || v === "vi" || v === "ja") return v;
    const nav = (navigator.language || "en").toLowerCase();
    return nav.startsWith("vi") ? "vi" : nav.startsWith("ja") ? "ja" : "en";
  } catch {
    return "en";
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
  const lang = useSyncExternalStore(subscribe, read, () => "en" as Lang);
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

type Entry = Record<Lang, string>;

const DICT = {
  // ── brand + landing ──
  tagline: {
    en: "Type a story. Get a film. No image generator.",
    vi: "Gõ một câu chuyện. Nhận một bộ phim. Không dùng AI vẽ ảnh.",
    ja: "物語を入力するだけで、映画ができる。画像生成AIは使いません。",
  },
  howItWorks: {
    en: "NVIDIA Nemotron models on Nebius Token Factory write the whole film as code. A deterministic engine renders it, measures every frame, and the crew fixes what the numbers say is wrong.",
    vi: "Các model NVIDIA Nemotron trên Nebius Token Factory viết cả bộ phim bằng code. Engine render, đo từng khung hình, và đội sửa những gì con số chỉ ra là sai.",
    ja: "Nebius Token Factory 上の NVIDIA Nemotron が映画全体をコードとして書きます。決定論的なエンジンが描画して全フレームを計測し、数値が示す問題をクルーが直します。",
  },
  makeAFilm: { en: "Make a film", vi: "Làm một bộ phim", ja: "映画をつくる" },
  watchShowcase: { en: "Watch the showcase", vi: "Xem phim mẫu", ja: "作品を見る" },
  samplesTitle: { en: "Or start from a sample story", vi: "Hoặc bắt đầu từ một truyện mẫu", ja: "またはサンプルの物語から" },
  makeThis: { en: "Make this film", vi: "Làm phim này", ja: "この映画をつくる" },
  estTime: { en: "about {a}–{b} min", vi: "khoảng {a}–{b} phút", ja: "約{a}〜{b}分" },
  keepsRendering: {
    en: "You can close this tab: the film keeps rendering on the server, and this page picks it up again when you come back.",
    vi: "Bạn có thể đóng tab: phim vẫn tiếp tục render trên server, quay lại trang này là thấy tiếp.",
    ja: "タブを閉じても大丈夫です。映画はサーバーで描画を続け、戻るとこのページが続きを表示します。",
  },
  heroCaption: { en: "A real film made by the Nemotron crew", vi: "Một bộ phim thật do đội Nemotron làm", ja: "Nemotron クルーが実際につくった映画" },
  replayRun: { en: "Replay the real run", vi: "Xem lại quá trình thật", ja: "実際の制作過程を再生" },
  advanced: { en: "Advanced: the zero-key engine underneath", vi: "Nâng cao: engine không-key bên dưới", ja: "上級者向け: 下層のキー不要エンジン" },
  openStudio: { en: "Open the studio", vi: "Mở studio", ja: "スタジオを開く" },
  starting: { en: "Starting…", vi: "Đang khởi động…", ja: "起動中…" },

  // ── Director panel ──
  directorTitle: { en: "AI Director: the Nemotron crew", vi: "Đạo diễn AI: đội Nemotron", ja: "AI 監督: Nemotron クルー" },
  directorSub: {
    en: "Tell a story in any language. Ultra plans the shots, Super draws every frame as code, the engine measures each render, the critic scores it and asks for fixes, and Nano edits dialogue and timing.",
    vi: "Kể một câu chuyện, bất kỳ ngôn ngữ nào. Ultra lên phân cảnh, Super vẽ từng khung bằng code, engine đo bản render, critic chấm điểm và yêu cầu sửa, Nano biên tập thoại + nhịp.",
    ja: "どの言語でも物語を書いてください。Ultra がショットを計画し、Super が全フレームをコードで描き、エンジンが描画を計測し、批評家が採点して修正を求め、Nano が台詞とタイミングを編集します。",
  },
  storyLabel: { en: "Your story", vi: "Câu chuyện", ja: "あなたの物語" },
  storyPlaceholder: {
    en: "E.g. On Mid-Autumn night, little Lan lights a star lantern. The wind carries it over the rooftops…",
    vi: "Ví dụ: Đêm Trung thu, bé Lan thắp chiếc đèn ông sao. Gió thổi đèn bay qua mái nhà…",
    ja: "例: 中秋の夜、ランちゃんは星の灯籠に火をともします。風が灯籠を屋根の上へ運び…",
  },
  filmLanguage: { en: "Film language", vi: "Ngôn ngữ phim", ja: "映画の言語" },
  style: { en: "Style", vi: "Phong cách", ja: "スタイル" },
  shots: { en: "Max shots", vi: "Số shot tối đa", ja: "最大ショット数" },
  critic: { en: "Critic (scores every frame)", vi: "Critic (chấm từng khung)", ja: "批評家 (全フレームを採点)" },
  criticTextTitle: {
    en: "The critic reads the engine's measurements of the render plus the drawing",
    vi: "Critic đọc số đo của engine trên bản render + bản vẽ",
    ja: "批評家はエンジンの計測値と描画コードを読みます",
  },
  research: { en: "Reference research (Tavily)", vi: "Tra cứu tham chiếu (Tavily)", ja: "資料リサーチ (Tavily)" },
  researchOff: {
    en: "Research is optional and not enabled on this server (no Tavily key).",
    vi: "Tra cứu là tuỳ chọn và chưa bật trên server này (không có key Tavily).",
    ja: "リサーチは任意で、このサーバーでは無効です (Tavily キーなし)。",
  },
  researchAuto: {
    en: "Auto: Nano decides whether the story needs real-world references.",
    vi: "Tự động: Nano quyết định truyện có cần tham chiếu thực tế không.",
    ja: "自動: 実在の資料が必要かどうかを Nano が判断します。",
  },
  make: { en: "🎬 Make my film", vi: "🎬 Làm phim của tôi", ja: "🎬 映画をつくる" },
  cancel: { en: "Cancel the film", vi: "Dừng làm phim", ja: "制作を中止" },
  confirmCancel: {
    en: "Stop this film? Shots already rendered are kept.",
    vi: "Dừng bộ phim này? Các shot đã render vẫn được giữ.",
    ja: "この映画の制作を止めますか？描画済みのショットは残ります。",
  },
  confirmReplace: {
    en: "The Director replaces this project's script and artwork. Continue?",
    vi: "Đạo diễn sẽ thay toàn bộ kịch bản + artwork hiện tại của project này. Tiếp tục?",
    ja: "このプロジェクトの台本とアートワークを置き換えます。続けますか？",
  },
  disabled: {
    en: "Not enabled: the server needs NEBIUS_API_KEY (or LLM_PROVIDER=mock for the scripted crew). The zero-key engine below works as usual.",
    vi: "Chưa bật: server cần NEBIUS_API_KEY (hoặc LLM_PROVIDER=mock để chạy đội mẫu). Engine không-key vẫn dùng bình thường bên dưới.",
    ja: "無効: サーバーに NEBIUS_API_KEY が必要です (台本どおりのクルーなら LLM_PROVIDER=mock)。下のキー不要エンジンは通常どおり使えます。",
  },
  mockNote: { en: "Running the scripted MOCK crew: no real model calls.", vi: "Đang chạy đội MẪU (mock): không gọi model thật.", ja: "台本どおりの MOCK クルーで実行中: 実際のモデル呼び出しはありません。" },
  timeline: { en: "Crew timeline", vi: "Dòng thời gian của đội", ja: "クルーのタイムライン" },
  timelineHint: {
    en: "Every model call: role, model, tokens, cost, latency",
    vi: "Mọi lần gọi model: vai trò, model, token, chi phí, độ trễ",
    ja: "全モデル呼び出し: 役割・モデル・トークン・費用・待ち時間",
  },
  shotsTitle: { en: "Shots", vi: "Các shot", ja: "ショット" },
  tokens: { en: "tokens", vi: "token", ja: "トークン" },
  elapsed: { en: "elapsed", vi: "đã chạy", ja: "経過" },
  film: { en: "Your film", vi: "Phim hoàn chỉnh", ja: "完成した映画" },
  downloadMp4: { en: "⬇ Download MP4", vi: "⬇ Tải MP4", ja: "⬇ MP4 をダウンロード" },
  downloadZip: { en: "⬇ Production package (ZIP)", vi: "⬇ Gói sản xuất (ZIP)", ja: "⬇ 制作パッケージ (ZIP)" },
  assembling: { en: "The MP4 is assembled with ffmpeg on first play.", vi: "MP4 được dựng bằng ffmpeg ở lần phát đầu.", ja: "MP4 は初回再生時に ffmpeg で組み立てます。" },
  summary: { en: "Run stats", vi: "Thống kê", ja: "実行の統計" },
  firstPass: { en: "first-pass OK", vi: "đạt ngay lần đầu", ja: "一発合格" },
  repairs: { en: "repairs", vi: "lần sửa", ja: "修正回数" },
  uplift: { en: "critic score", vi: "điểm critic", ja: "批評スコア" },
  lint: { en: "lint left", vi: "lint còn lại", ja: "残りの指摘" },
  wall: { en: "time to make", vi: "thời gian làm", ja: "制作時間" },
  cost: { en: "cost", vi: "chi phí", ja: "費用" },
  references: { en: "Research", vi: "Tra cứu", ja: "リサーチ" },
  referencesSub: {
    en: "Real-world facts the crew used, with their sources",
    vi: "Dữ kiện thực tế đội đã dùng, kèm nguồn",
    ja: "クルーが使った実在の事実と出典",
  },
  status_done: { en: "Done", vi: "Xong", ja: "完成" },
  status_cancelled: { en: "Cancelled", vi: "Đã dừng", ja: "中止" },
  status_failed: { en: "Failed", vi: "Lỗi", ja: "失敗" },
  status_budget_exceeded: { en: "Budget reached", vi: "Hết ngân sách", ja: "予算の上限" },
  showcase: { en: "🎞 Showcase", vi: "🎞 Phim mẫu", ja: "🎞 作品集" },
  livePreview: { en: "Latest frame", vi: "Khung mới nhất", ja: "最新のフレーム" },
  waitingFirst: { en: "The first frame appears here in about a minute.", vi: "Khung đầu tiên sẽ hiện ở đây sau khoảng một phút.", ja: "最初のフレームは約1分でここに表示されます。" },
  criticWin: { en: "The critic asked for a better version", vi: "Critic yêu cầu một bản tốt hơn", ja: "批評家がより良い版を求めました" },
  before: { en: "before", vi: "trước", ja: "修正前" },
  after: { en: "after", vi: "sau", ja: "修正後" },
  reconnecting: { en: "Reconnecting… the film keeps rendering on the server.", vi: "Đang kết nối lại… phim vẫn render trên server.", ja: "再接続中… 映画はサーバーで描画を続けています。" },
  saveSeries: { en: "Save as series", vi: "Lưu thành series", ja: "シリーズとして保存" },
  seriesPick: { en: "Series", vi: "Series", ja: "シリーズ" },
  seriesNone: { en: "None (new cast)", vi: "Không (dàn nhân vật mới)", ja: "なし (新しいキャスト)" },
  seriesSaved: { en: "Saved as a series. New films can reuse this cast and set.", vi: "Đã lưu series. Phim mới có thể dùng lại nhân vật và bối cảnh này.", ja: "シリーズとして保存しました。新しい映画でこのキャストとセットを使えます。" },
  seriesName: { en: "Series name", vi: "Tên series", ja: "シリーズ名" },
  models: { en: "models", vi: "model", ja: "モデル" },

  // ── unlock ──
  unlockTitle: { en: "Judges' demo", vi: "Bản demo cho giám khảo", ja: "審査員用デモ" },
  unlockSub: {
    en: "Judges: the passcode is in the Judge Access PDF attached to the Devpost submission.",
    vi: "Giám khảo: mật khẩu có trong file PDF Judge Access đính kèm bài nộp trên Devpost.",
    ja: "審査員の方へ: パスコードは Devpost 提出物に添付の Judge Access PDF に記載されています。",
  },
  noPasscodeNeeded: { en: "Watch finished films without a passcode", vi: "Xem phim đã hoàn thành, không cần mật khẩu", ja: "パスコードなしで完成作品を見る" },
  contact: { en: "Contact", vi: "Liên hệ", ja: "連絡先" },
  passcode: { en: "Passcode", vi: "Mật khẩu", ja: "パスコード" },
  unlock: { en: "Unlock", vi: "Mở khoá", ja: "ロック解除" },
  notConfigured: { en: "This server has no DEMO_PASSCODE set.", vi: "Server chưa đặt DEMO_PASSCODE.", ja: "このサーバーには DEMO_PASSCODE が設定されていません。" },
} as const satisfies Record<string, Entry>;

export type I18nKey = keyof typeof DICT;

export function t(lang: Lang, key: I18nKey, vars?: Record<string, string | number>): string {
  let s: string = DICT[key][lang] ?? DICT[key].en;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

export function LangToggle({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  return (
    <div className="flex rounded-xl border border-line bg-card-2 p-1 text-xs" role="group" aria-label="Language">
      {LANGS.map((l) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          aria-pressed={lang === l}
          className={`rounded-lg px-3 py-1 font-semibold uppercase transition ${lang === l ? "btn-gradient text-white" : "text-muted hover:text-ink"}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
