import { PIPER_MODELS, type PiperModel } from "@/lib/services/tts";

/**
 * Publication rule for the owner's channel (owner QC 2026-10-10): a voice
 * whose licence is non-commercial (Piper `ja_JP-hi_fi_captain`, CC BY-NC-SA)
 * may be used for drafts, never in a published (monetised) episode. A line is
 * cleared when the owner's own recording replaced it.
 */
export function isNonCommercialVoice(voiceId: string | null | undefined): boolean {
  const m = voiceId?.match(/^piper:([^#@]+)/)?.[1];
  if (!m || !(m in PIPER_MODELS)) return false;
  return /non-commercial/i.test(PIPER_MODELS[m as PiperModel].licence);
}

export interface SpokenLine {
  readonly shot: number;
  /** the TTS voice id the line was spoken with (null = subtitle only) */
  readonly voice: string | null;
}

export function publishVerdict(lines: readonly SpokenLine[], ownerRecorded: ReadonlySet<number>): { publishable: boolean; blocking: SpokenLine[] } {
  const blocking = lines.filter((l) => isNonCommercialVoice(l.voice) && !ownerRecorded.has(l.shot));
  return { publishable: blocking.length === 0, blocking };
}

/** The spoken lines of a run, from its trace (the Dialogue role records one `voice` step per shot, model = voice id). */
export function spokenLines(steps: ReadonlyArray<{ role: string; action: string; shotIndex: number | null; model: string; error?: string | null }>): SpokenLine[] {
  return steps
    .filter((s) => s.role === "dialogue" && s.action === "voice" && s.shotIndex !== null && !s.error)
    .map((s) => ({ shot: s.shotIndex!, voice: s.model === "subtitle-only" ? null : s.model }));
}

/**
 * The narration lines of a story read aloud (朗読, owner QC 2026-10-10): its
 * sentences, in order, split after 。！？ outside 「」 quotes, so a quoted
 * line with its own 。 inside stays whole, the 。 right after a closing 」
 * stays with it, and 「…」と言いました。 is one sentence.
 */
export function narrationLines(story: string): string[] {
  const out: string[] = [];
  let cur = "";
  let depth = 0;
  const chars = [...story.trim()];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    cur += c;
    if (c === "「" || c === "『") depth++;
    if ((c === "」" || c === "』") && depth > 0) depth--;
    const end = depth === 0 && /[。！？!?]/.test(c);
    if (end) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Reading pace of the target: 300 characters a minute (NHK announcer standard; 朗読 for older listeners is no faster). */
export const NARRATION_CHARS_PER_SEC = 5;

/**
 * Target spoken length of a line in seconds (a guide for the narrator, not a
 * limit; the engine times each shot to the real WAV): 5 characters a second,
 * plus 0.3 s for each 、 and 0.5 s at the end of the sentence.
 */
export function targetSeconds(line: string): number {
  const spoken = [...line].filter((c) => !/[、。「」『』！？!?\s]/.test(c)).length;
  const commas = [...line].filter((c) => c === "、").length;
  return Math.round((spoken / NARRATION_CHARS_PER_SEC + commas * 0.3 + 0.5) * 10) / 10;
}
