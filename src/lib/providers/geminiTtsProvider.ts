import { GoogleGenAI } from "@google/genai";
import type { TtsProvider, TtsResult } from "@/lib/providers/types";
import { AppError } from "@/lib/services/apiError";
import { pcmToWav } from "@/lib/services/pcmToWav";

/**
 * GeminiTtsProvider — Interactions API với response_format audio.
 * Output PCM s16le 24kHz mono → bọc WAV. Model qua GEMINI_TTS_MODEL,
 * giọng qua GEMINI_TTS_VOICE (30 giọng: Kore, Puck, Zephyr...).
 */
export class GeminiTtsProvider implements TtsProvider {
  readonly name: string;
  private readonly ai: GoogleGenAI;
  private readonly model: string;
  private readonly voice: string;

  constructor(apiKey: string, model: string, voice: string) {
    this.ai = new GoogleGenAI({ apiKey });
    this.model = model;
    this.voice = voice;
    this.name = `${model}/${voice}`;
  }

  async synthesize(text: string): Promise<TtsResult> {
    const trimmed = text.trim();
    if (!trimmed) {
      throw new AppError("VALIDATION", "Voiceover trống — không có gì để đọc.");
    }

    try {
      const interaction = await this.ai.interactions.create({
        model: this.model,
        input: trimmed,
        generation_config: {
          speech_config: [{ voice: this.voice }],
        },
        response_format: { type: "audio" },
      });

      const audio = interaction.output_audio;
      if (!audio?.data) {
        throw new AppError(
          "INTERNAL",
          "TTS không trả về audio.",
          "Kiểm tra GEMINI_TTS_MODEL trong .env (chạy scripts/smoke-tts.mjs).",
        );
      }

      const pcm = Buffer.from(audio.data, "base64");
      // PCM 24kHz mono s16le theo docs; nếu model trả wav sẵn thì giữ nguyên
      const isWav = pcm.subarray(0, 4).toString() === "RIFF";
      return {
        data: isWav ? pcm : pcmToWav(pcm, 24_000, 1),
        mimeType: "audio/wav",
      };
    } catch (err: unknown) {
      if (err instanceof AppError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      if (/RESOURCE_EXHAUSTED|rate limit|quota/i.test(message)) {
        throw new AppError("PROVIDER_RATE_LIMIT", "TTS bị giới hạn quota.", "Thử lại sau ít phút.");
      }
      throw new AppError("INTERNAL", `Lỗi TTS: ${message}`);
    }
  }
}
