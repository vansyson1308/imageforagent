import { AppError } from "@/lib/services/apiError";
import { decodeWav, audioDuration, WavError, type AudioBuffer } from "@/lib/services/audio/wav";
import { synthesizeSpeech } from "@/lib/services/tts";

/** Trần giọng mỗi frame: 60 s (một shot) — âm thanh giải mã nằm trong RAM. */
export const MAX_VOICE_SECONDS = 60;
/** Trần nhạc nền: 15 phút. */
export const MAX_MUSIC_SECONDS = 15 * 60;

export interface VoiceInput {
  readonly wav?: string;
  readonly text?: string;
  readonly tts?: { readonly voice: string; readonly speed: number };
}

/** WAV base64 (hoặc data: URI) → AudioBuffer đã kiểm tra. */
export function decodeWavBase64(b64: string, maxSeconds: number, what: string): { buffer: Buffer; audio: AudioBuffer } {
  const raw = b64.replace(/^data:audio\/[\w.+-]+;base64,/, "");
  const buffer = Buffer.from(raw, "base64");
  let audio: AudioBuffer;
  try {
    audio = decodeWav(buffer);
  } catch (e) {
    throw new AppError("VALIDATION", `${what} is not a valid WAV: ${e instanceof WavError ? e.message : "decode failed"}`, "Send PCM or float WAV (RIFF/WAVE), base64-encoded.");
  }
  if (audioDuration(audio) > maxSeconds) {
    throw new AppError("VALIDATION", `${what} is ${audioDuration(audio).toFixed(1)}s (max ${maxSeconds}s).`, "Trim the audio or split it across frames.");
  }
  return { buffer, audio };
}

/** Giải giọng: WAV gửi kèm ưu tiên, không có thì TTS local từ text. */
export async function resolveVoice(input: VoiceInput): Promise<{ buffer: Buffer; audio: AudioBuffer } | null> {
  if (input.wav) return decodeWavBase64(input.wav, MAX_VOICE_SECONDS, "Voice");
  if (input.tts && input.text) {
    const wav = await synthesizeSpeech(input.text, input.tts.voice, input.tts.speed);
    return decodeWavBase64(wav.toString("base64"), MAX_VOICE_SECONDS, "TTS voice");
  }
  return null;
}
