/**
 * Client-side state of one Director run, built from its Server-Sent Events.
 * Pure (no React, no fetch): the live view, the reconnecting stream and the
 * showcase replay all fold events through `reduceRun`, so they render the
 * same UI from the same data. Replayed events are idempotent: steps are
 * de-duplicated by `seq`, frames and research overwrite.
 */

export interface RunStep {
  seq: number;
  role: string;
  model: string;
  action: string;
  shotIndex: number | null;
  attempt: number;
  summary: string;
  score: number | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
  imageUrl: string | null;
  error: string | null;
}

export interface RunShot {
  index: number;
  shotType: string;
  description: string;
  mode: string;
  dialogue: string | null;
  imageUrl: string | null;
  clipUrl: string | null;
  /** critic scores in order (first = before, last = after) */
  scores: number[];
  status: string;
  /** the critic snapshot of the version before a winning revision */
  beforeImageUrl: string | null;
  /** research citations used by this shot (indexes into references) */
  cites: number[];
}

export interface RunSummary {
  status: string;
  shots: number;
  rendered: number;
  firstPassOk: number;
  repairs: number;
  criticBefore: number | null;
  criticAfter: number | null;
  revisions: number;
  lintErrors: number;
  lintWarnings: number;
  durationSec: number;
  wallMs: number;
  tokens: number;
  costUsd: number;
  continuity: string[];
  textCritic: boolean;
  criticModel?: string | null;
  belowFloor?: number[];
}

export interface RunReference {
  note: string;
  url: string;
  title: string;
  /** what the fact was used for (costume, props, palette, set…) */
  use?: string;
}

export interface Uplift {
  shotIndex: number;
  before: number;
  after: number;
  beforeImageUrl: string | null;
  afterImageUrl: string | null;
}

export interface RunState {
  runId: string | null;
  projectId: string | null;
  provider: string | null;
  models: Record<string, string> | null;
  notes: string[];
  title: string | null;
  logline: string | null;
  status: string | null;
  /** last plain status message from the server */
  message: string | null;
  steps: RunStep[];
  shots: RunShot[];
  references: RunReference[];
  totals: { tokens: number; costUsd: number };
  summary: RunSummary | null;
  error: string | null;
  /** the most recent critic win (shown large) */
  lastUplift: Uplift | null;
  /** index of the shot that most recently landed (big preview) */
  latestShot: number | null;
  finished: boolean;
  startedAt: string | null;
}

export const emptyRun = (): RunState => ({
  runId: null,
  projectId: null,
  provider: null,
  models: null,
  notes: [],
  title: null,
  logline: null,
  status: null,
  message: null,
  steps: [],
  shots: [],
  references: [],
  totals: { tokens: 0, costUsd: 0 },
  summary: null,
  error: null,
  lastUplift: null,
  latestShot: null,
  finished: false,
  startedAt: null,
});

/* eslint-disable @typescript-eslint/no-explicit-any */
export type DirectorEventLike = { type: string } & Record<string, any>;

export function reduceRun(s: RunState, e: DirectorEventLike): RunState {
  switch (e.type) {
    case "run":
      // A different run resets; the same run (a reconnect replay) keeps what we have.
      if (s.runId && s.runId !== e.runId) s = emptyRun();
      return { ...s, runId: e.runId, projectId: e.projectId ?? s.projectId, provider: e.provider, models: e.models ?? null, notes: e.notes ?? [], status: s.status ?? "running", startedAt: e.startedAt ?? s.startedAt };
    case "status":
      return { ...s, message: e.message };
    case "plan": {
      const known = new Map(s.shots.map((x) => [x.index, x]));
      const shots: RunShot[] = (e.shots as Array<Omit<RunShot, "imageUrl" | "clipUrl" | "scores" | "status" | "beforeImageUrl" | "cites"> & { cites?: number[] }>).map((x) => {
        const prev = known.get(x.index);
        return {
          index: x.index,
          shotType: x.shotType,
          description: x.description,
          mode: x.mode,
          dialogue: x.dialogue ?? null,
          imageUrl: prev?.imageUrl ?? null,
          clipUrl: prev?.clipUrl ?? null,
          scores: prev?.scores ?? [],
          status: prev?.status ?? "draft",
          beforeImageUrl: prev?.beforeImageUrl ?? null,
          cites: x.cites ?? prev?.cites ?? [],
        };
      });
      return { ...s, title: e.title || s.title, logline: e.logline || s.logline, shots };
    }
    case "research":
      return { ...s, references: e.references ?? [] };
    case "step": {
      const step = e.step as RunStep;
      if (s.steps.some((x) => x.seq === step.seq)) return s;
      const steps = [...s.steps, step].sort((a, b) => a.seq - b.seq);
      let shots = s.shots;
      let lastUplift = s.lastUplift;
      if (step.shotIndex && step.action === "score" && step.score !== null) {
        shots = shots.map((x) => (x.index === step.shotIndex ? { ...x, scores: [...x.scores, step.score!], beforeImageUrl: x.beforeImageUrl ?? step.imageUrl } : x));
      }
      if (step.shotIndex && step.action === "uplift" && step.score !== null) {
        const shot = shots.find((x) => x.index === step.shotIndex);
        const scored = steps.filter((x) => x.shotIndex === step.shotIndex && x.action === "score");
        const first = scored[0];
        const last = scored.at(-1);
        if (first && first.score !== null) {
          lastUplift = { shotIndex: step.shotIndex, before: first.score, after: step.score, beforeImageUrl: first.imageUrl ?? shot?.beforeImageUrl ?? null, afterImageUrl: last?.imageUrl ?? shot?.imageUrl ?? null };
        }
      }
      return { ...s, steps, shots, lastUplift, totals: e.totals ?? s.totals };
    }
    case "frame": {
      const exists = s.shots.some((x) => x.index === e.index);
      const shots = exists
        ? s.shots.map((x) => (x.index === e.index ? { ...x, imageUrl: e.imageUrl ?? x.imageUrl, clipUrl: e.clipUrl ?? x.clipUrl, status: e.status } : x))
        : [...s.shots, { index: e.index, shotType: "", description: "", mode: "still", dialogue: null, imageUrl: e.imageUrl, clipUrl: e.clipUrl, scores: [], status: e.status, beforeImageUrl: null, cites: [] }].sort((a, b) => a.index - b.index);
      return { ...s, shots, latestShot: e.imageUrl ? e.index : s.latestShot };
    }
    case "error":
      return { ...s, error: e.message };
    case "done":
      return { ...s, status: e.status, summary: e.summary ?? s.summary, finished: true, message: null };
    default:
      return s;
  }
}

export function reduceAll(events: readonly DirectorEventLike[], start: RunState = emptyRun()): RunState {
  return events.reduce(reduceRun, start);
}

/** "nvidia/nemotron-3-super-120b-a12b" → "Super" (crew names judges can read). */
export function modelLabel(model: string): string {
  const m = model.toLowerCase();
  if (m.includes("ultra")) return "Nemotron Ultra";
  if (m.includes("super")) return "Nemotron Super";
  if (m.includes("nano") || m.includes("lightning")) return "Nemotron Nano";
  if (m.includes("omni")) return "Nemotron Omni";
  if (m === "engine" || m === "catalog") return "Engine";
  // the Japanese Piper voice is CC BY-NC-SA: labelled in the demo so nobody mistakes it for a publishable voice (owner decision A1)
  if (m.startsWith("piper:ja_jp")) return "Piper voice (non-commercial demo voice)";
  if (m.startsWith("espeak") || m.startsWith("piper")) return m.split(":")[0] === "piper" ? "Piper voice" : "espeak-ng";
  if (m === "owner-recording") return "Owner recording (AivisSpeech)";
  if (m.startsWith("tavily")) return "Tavily";
  if (m.startsWith("mock")) return `mock ${m.replace(/^mock-?/, "")}`;
  return model.replace(/^[^/]+\//, "");
}

export type UiLang = "en" | "vi" | "ja";

const LINES: Record<string, Record<UiLang, (n: { shot?: number | null; count?: number; model?: string }) => string>> = {
  researching: { en: () => "The Researcher is looking up real-world references…", vi: () => "Researcher đang tra cứu tham chiếu thực tế…", ja: () => "リサーチャーが実在の資料を調べています…" },
  planning: { en: (n) => `${n.model ?? "Ultra"} is planning the shots…`, vi: (n) => `${n.model ?? "Ultra"} đang lên phân cảnh…`, ja: (n) => `${n.model ?? "Ultra"} がショットを計画しています…` },
  planned: { en: (n) => `${n.count} shots planned. Recording the voices…`, vi: (n) => `Đã lên ${n.count} shot. Đang thu giọng…`, ja: (n) => `${n.count} ショットを計画。声を録音しています…` },
  casting: { en: (n) => `${n.model ?? "Super"} is designing the cast and the sets…`, vi: (n) => `${n.model ?? "Super"} đang thiết kế nhân vật và bối cảnh…`, ja: (n) => `${n.model ?? "Super"} がキャストとセットをデザインしています…` },
  drawing: { en: (n) => `${n.model ?? "Super"} is drawing shot ${n.shot}…`, vi: (n) => `${n.model ?? "Super"} đang vẽ shot ${n.shot}…`, ja: (n) => `${n.model ?? "Super"} がショット ${n.shot} を描いています…` },
  repairing: { en: (n) => `The engine measured a problem in shot ${n.shot}; ${n.model ?? "Super"} is fixing it…`, vi: (n) => `Engine đo thấy lỗi ở shot ${n.shot}; ${n.model ?? "Super"} đang sửa…`, ja: (n) => `エンジンがショット ${n.shot} の問題を測定。${n.model ?? "Super"} が修正中…` },
  critiquing: { en: (n) => `The critic is scoring shot ${n.shot}…`, vi: (n) => `Critic đang chấm shot ${n.shot}…`, ja: (n) => `批評家がショット ${n.shot} を採点しています…` },
  editing: { en: () => "The Editor is checking timing and continuity…", vi: () => "Editor đang kiểm tra nhịp và tính liên tục…", ja: () => "編集者がタイミングと連続性を確認しています…" },
  rendering: { en: (n) => `The engine is rendering shot ${n.shot}…`, vi: (n) => `Engine đang render shot ${n.shot}…`, ja: (n) => `エンジンがショット ${n.shot} をレンダリング中…` },
  starting: { en: () => "Starting the crew…", vi: () => "Đang khởi động đội…", ja: () => "クルーを起動しています…" },
};

/** One plain-language line describing what the crew is doing right now. */
export function statusLine(s: RunState, lang: UiLang): string {
  if (s.finished) return "";
  const last = s.steps.at(-1);
  const plain = (k: keyof typeof LINES, n: Parameters<(typeof LINES)[string][UiLang]>[0] = {}) => LINES[k][lang](n);
  if (!last) return plain(s.shots.length ? "planned" : "starting", { count: s.shots.length });
  const model = last.model ? modelLabel(last.model).replace(/^Nemotron /, "") : undefined;
  switch (last.role) {
    case "researcher":
      return plain("researching");
    case "director":
      return s.shots.length ? plain("planned", { count: s.shots.length }) : plain("planning", { model });
    case "dialogue":
      return plain("planned", { count: s.shots.length });
    case "cast":
      return plain("casting", { model });
    case "artist":
      return last.action.startsWith("repair") || last.error ? plain("repairing", { shot: last.shotIndex, model }) : plain("drawing", { shot: last.shotIndex, model });
    case "critic":
      return plain("critiquing", { shot: last.shotIndex });
    case "editor":
      return plain("editing");
    default:
      return last.shotIndex ? plain("rendering", { shot: last.shotIndex }) : plain("starting");
  }
}
