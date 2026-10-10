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
