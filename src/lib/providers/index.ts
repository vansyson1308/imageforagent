import type { ImageProvider, TextProvider } from "@/lib/providers/types";
import { MockImageProvider } from "@/lib/providers/mockImageProvider";
import { GeminiImageProvider } from "@/lib/providers/geminiImageProvider";
import { GeminiTextProvider } from "@/lib/providers/geminiTextProvider";
import { AppError } from "@/lib/services/apiError";

const DEFAULT_IMAGE_MODEL = "gemini-3.1-flash-image";
const DEFAULT_TEXT_MODEL = "gemini-flash-latest";

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
