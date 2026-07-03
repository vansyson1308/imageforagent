import type { TtsProvider, TtsResult } from "@/lib/providers/types";
import { pcmToWav } from "@/lib/services/pcmToWav";

/**
 * MockTtsProvider — sinh sóng sine "giọng đọc giả" thuần TS, không API.
 * Độ dài ∝ độ dài text (ước lượng tốc độ đọc ~14 ký tự/giây).
 */
export class MockTtsProvider implements TtsProvider {
  readonly name = "mock-tts";

  async synthesize(text: string): Promise<TtsResult> {
    const sampleRate = 24_000;
    const seconds = Math.min(12, Math.max(1, text.length / 14));
    const total = Math.floor(sampleRate * seconds);
    const pcm = Buffer.alloc(total * 2);

    for (let i = 0; i < total; i++) {
      // Sine 220Hz + rung nhẹ 3Hz cho giống giọng nói, fade out cuối
      const t = i / sampleRate;
      const envelope = Math.min(1, (total - i) / (sampleRate * 0.2));
      const sample =
        Math.sin(2 * Math.PI * 220 * t) *
        (0.7 + 0.3 * Math.sin(2 * Math.PI * 3 * t)) *
        envelope *
        0.3;
      pcm.writeInt16LE(Math.round(sample * 32767), i * 2);
    }

    return { data: pcmToWav(pcm, sampleRate, 1), mimeType: "audio/wav" };
  }
}
