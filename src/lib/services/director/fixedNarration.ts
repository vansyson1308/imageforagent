import { audioDuration, decodeWav, encodeWav, resample, toChannels, type AudioBuffer } from "@/lib/services/audio/wav";
import { measureLoudness } from "@/lib/services/audio/loudness";
import { limitPeaks } from "@/lib/services/audio/mix";

/** The voice id of a line the owner recorded (AivisSpeech): traces, labels and the end credits key on it. */
export const OWNER_VOICE = "owner-recording";

/** Every owner line is levelled to this integrated loudness before the mix (owner, 2026-10-10: the lines run −15.9 to −21.6 LUFS). */
export const LINE_LUFS = -18;
/** Sample-peak ceiling after levelling (dBFS); a boosted line is limited, never clipped. */
export const LINE_PEAK_DB = -1;

/**
 * One line levelled to LINE_LUFS (BS.1770-4 integrated, the same meter the
 * mix uses), then a lookahead limiter holds its peaks under LINE_PEAK_DB.
 * Mono in, mono out; returns the measured loudness before and after.
 */
export function levelLine(a: AudioBuffer, target = LINE_LUFS): { audio: AudioBuffer; lufsIn: number; lufsOut: number; gainDb: number } {
  const lufsIn = measureLoudness(a).integrated;
  if (!Number.isFinite(lufsIn)) return { audio: a, lufsIn, lufsOut: lufsIn, gainDb: 0 };
  // gain to the target, limit the peaks, and once more if the limiter took more than 0.3 LU back (a quiet line with loud peaks)
  let ch = a.channels;
  let gainDb = 0;
  let lufsOut = lufsIn;
  for (let pass = 0; pass < 4 && Math.abs(target - lufsOut) > 0.3; pass++) {
    const step = target - lufsOut;
    const g = 10 ** (step / 20);
    ch = ch.map((c) => Float32Array.from(c, (v) => v * g));
    limitPeaks(ch, a.sampleRate, 10 ** (LINE_PEAK_DB / 20));
    gainDb += step;
    lufsOut = measureLoudness({ sampleRate: a.sampleRate, channels: ch }).integrated;
  }
  return { audio: { sampleRate: a.sampleRate, channels: ch }, lufsIn, lufsOut, gainDb };
}

/**
 * Fixed narration (owner decision 2026-10-10, section B): the narration is
 * decided BEFORE the run, usually recorded by the owner's AivisSpeech
 * pipeline. One shot per scene of the owner's package; each shot carries its
 * lines (id, text, pause_after, the WAV). The Director plans the picture
 * around them and never rewrites them (nor does the Editor); each shot holds
 * exactly its lines' real audio plus their pauses.
 */

export interface NarrationLine {
  readonly id: string;
  readonly text: string;
  readonly pauseAfter: number;
  /** the owner's recording (WAV bytes); absent = draft, spoken by the demo TTS */
  readonly wav?: Buffer;
}

export interface NarrationShot {
  readonly lines: readonly NarrationLine[];
}

/** Lead-in before the first line of a shot, seconds (the same 0.3 s the TTS path uses). */
export const NARRATION_OFFSET = 0.3;

/** The words a shot speaks, as one line of the plan (Japanese/Chinese join without spaces). */
export function shotText(shot: NarrationShot, language: string): string {
  return shot.lines.map((l) => l.text.trim()).join(/^(ja|zh|ko)/.test(language) ? "" : " ");
}

/** True when every line of the shot has the owner's recording. */
export function hasRecording(shot: NarrationShot): boolean {
  return shot.lines.every((l) => l.wav && l.wav.length > 44);
}

/**
 * One WAV for a shot: its lines in order, each levelled to −18 LUFS
 * (levelLine) and followed by its pause_after of silence, mono, at the first
 * line's sample rate, 16-bit (the owner's format). Null when a line has no
 * recording.
 */
export function shotVoice(shot: NarrationShot): { wav: Buffer; seconds: number; lines: Array<{ id: string; seconds: number; lufsIn: number; lufsOut: number }> } | null {
  if (!hasRecording(shot)) return null;
  const parts = shot.lines.map((l) => ({ id: l.id, pauseAfter: l.pauseAfter, audio: toChannels(decodeWav(l.wav!), 1) }));
  const rate = parts[0].audio.sampleRate;
  const pieces: Float32Array[] = [];
  const lines: Array<{ id: string; seconds: number; lufsIn: number; lufsOut: number }> = [];
  for (const p of parts) {
    const lv = levelLine(resample(p.audio, rate));
    const a: AudioBuffer = lv.audio;
    lines.push({ id: p.id, seconds: Math.round(audioDuration(a) * 1000) / 1000, lufsIn: Math.round(lv.lufsIn * 10) / 10, lufsOut: Math.round(lv.lufsOut * 10) / 10 });
    pieces.push(a.channels[0], new Float32Array(Math.round(Math.max(0, p.pauseAfter) * rate)));
  }
  const total = pieces.reduce((n, x) => n + x.length, 0);
  const out = new Float32Array(total);
  let at = 0;
  for (const x of pieces) {
    out.set(x, at);
    at += x.length;
  }
  return { wav: encodeWav({ sampleRate: rate, channels: [out] }, 16), seconds: Math.round((total / rate) * 1000) / 1000, lines };
}

/** Line durations the owner's timings.json reports, by line id (tolerant of the common shapes). */
export function timingsById(raw: unknown): Map<string, number> {
  const out = new Map<string, number>();
  const take = (id: unknown, v: unknown) => {
    if (typeof id !== "string") return;
    const o = (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>;
    const d = typeof v === "number" ? v : typeof o.duration === "number" ? o.duration : typeof o.duration_sec === "number" ? o.duration_sec : typeof o.seconds === "number" ? o.seconds : typeof o.end === "number" && typeof o.start === "number" ? o.end - o.start : NaN;
    if (Number.isFinite(d)) out.set(id, d);
  };
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? ((raw as Record<string, unknown>).lines ?? (raw as Record<string, unknown>).timings ?? raw) : null;
  if (Array.isArray(list)) for (const e of list) take((e as Record<string, unknown>)?.id ?? (e as Record<string, unknown>)?.line_id, e);
  else if (list && typeof list === "object") for (const [k, v] of Object.entries(list)) take(k, v);
  return out;
}
