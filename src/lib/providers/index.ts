import type {
  ImageProvider,
  TextProvider,
  TtsProvider,
  VideoProvider,
} from "@/lib/providers/types";
import { MockImageProvider } from "@/lib/providers/mockImageProvider";
import { GeminiImageProvider } from "@/lib/providers/geminiImageProvider";
import { GeminiTextProvider } from "@/lib/providers/geminiTextProvider";
import { MockVideoProvider } from "@/lib/providers/mockVideoProvider";
import { VeoVideoProvider } from "@/lib/providers/veoVideoProvider";
import { MockTtsProvider } from "@/lib/providers/mockTtsProvider";
import { GeminiTtsProvider } from "@/lib/providers/geminiTtsProvider";
import type { VideoTier } from "@/lib/config/video";
import { AppError } from "@/lib/services/apiError";

const DEFAULT_IMAGE_MODEL = "gemini-3.1-flash-image";
const DEFAULT_TEXT_MODEL = "gemini-flash-latest";
const DEFAULT_TTS_MODEL = "gemini-3.1-flash-tts-preview";
const DEFAULT_TTS_VOICE = "Kore";

const DEFAULT_VEO_MODELS: Record<Exclude<VideoTier, "animatic">, string> = {
  lite: "veo-3.1-lite-generate-preview",
  fast: "veo-3.1-fast-generate-preview",
  standard: "veo-3.1-generate-preview",
};

/**
 * Chọn ImageProvider theo env:
 * - IMAGE_PROVIDER=mock → mock
 * - IMAGE_PROVIDER=gemini → gemini (bắt buộc có GEMINI_API_KEY)
 * - bỏ trống → gemini nếu có key, ngược lại mock
 */
export function getImageProvider(): ImageProvider {
  const forced = process.env.IMAGE_PROVIDER?.trim().toLowerCase();
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const model = process.env.GEMINI_IMAGE_MODEL?.trim() || DEFAULT_IMAGE_MODEL;

  if (forced === "mock") return new MockImageProvider();
  if (forced === "gemini") {
    if (!apiKey) {
      throw new AppError(
        "VALIDATION",
        "IMAGE_PROVIDER=gemini nhưng thiếu GEMINI_API_KEY trong .env.",
      );
    }
    return new GeminiImageProvider(apiKey, model);
  }
  return apiKey ? new GeminiImageProvider(apiKey, model) : new MockImageProvider();
}

export function getTextProvider(): TextProvider {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new AppError(
      "VALIDATION",
      "Tính năng AI sửa kịch bản cần GEMINI_API_KEY trong .env.",
      "Thêm key vào file .env rồi khởi động lại server.",
    );
  }
  const model = process.env.GEMINI_TEXT_MODEL?.trim() || DEFAULT_TEXT_MODEL;
  return new GeminiTextProvider(apiKey, model);
}

/**
 * VideoProvider theo tier (lite/fast/standard — animatic không đi qua provider).
 * VIDEO_PROVIDER=mock ép mock; bỏ trống → Veo nếu có key, ngược lại mock.
 */
export function getVideoProvider(tier: Exclude<VideoTier, "animatic">): VideoProvider {
  const forced = process.env.VIDEO_PROVIDER?.trim().toLowerCase();
  const apiKey = process.env.GEMINI_API_KEY?.trim();

  if (forced === "mock") return new MockVideoProvider();
  if (forced && forced !== "gemini" && forced !== "veo") {
    throw new AppError("VALIDATION", `VIDEO_PROVIDER không hợp lệ: "${forced}".`);
  }
  if (!apiKey) {
    if (forced) {
      throw new AppError("VALIDATION", "VIDEO_PROVIDER=gemini nhưng thiếu GEMINI_API_KEY.");
    }
    return new MockVideoProvider();
  }

  const envKey = `GEMINI_VEO_MODEL_${tier.toUpperCase()}`;
  const model = process.env[envKey]?.trim() || DEFAULT_VEO_MODELS[tier];
  return new VeoVideoProvider(apiKey, model);
}

export function getTtsProvider(): TtsProvider {
  const forced = process.env.TTS_PROVIDER?.trim().toLowerCase();
  const apiKey = process.env.GEMINI_API_KEY?.trim();

  if (forced === "mock") return new MockTtsProvider();
  if (!apiKey) return new MockTtsProvider();

  const model = process.env.GEMINI_TTS_MODEL?.trim() || DEFAULT_TTS_MODEL;
  const voice = process.env.GEMINI_TTS_VOICE?.trim() || DEFAULT_TTS_VOICE;
  return new GeminiTtsProvider(apiKey, model, voice);
}
