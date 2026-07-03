import { GoogleGenAI, VideoGenerationReferenceType } from "@google/genai";
import type { VideoRequest } from "@/lib/services/videoPromptComposer";
import type { GeneratedClip, VideoProvider } from "@/lib/providers/types";
import { AppError } from "@/lib/services/apiError";
import { readBuffer } from "@/lib/services/storage";
import { logger } from "@/lib/services/logger";

const POLL_INTERVAL_MS = 10_000;
const HARD_TIMEOUT_MS = 10 * 60 * 1000; // 10 phút/clip

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function classifyError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const message = err instanceof Error ? err.message : String(err);
  const status =
    typeof err === "object" && err !== null && "status" in err
      ? Number((err as { status: unknown }).status)
      : undefined;

  if (status === 429 || /RESOURCE_EXHAUSTED|rate limit|quota/i.test(message)) {
    return new AppError(
      "PROVIDER_RATE_LIMIT",
      "Veo đang bị giới hạn tốc độ/quota.",
      "Đợi một lúc rồi tạo lại clip.",
    );
  }
  if (/safety|blocked|prohibited|SAFETY|RAI/i.test(message)) {
    return new AppError(
      "PROVIDER_SAFETY_BLOCK",
      "Prompt/ảnh bị safety filter của Veo chặn.",
      "Sửa mô tả cảnh: bỏ thoại nhạy cảm, thương hiệu, người thật. Clip bị chặn không bị tính tiền.",
    );
  }
  return new AppError("INTERNAL", `Lỗi từ Veo: ${message}`);
}

async function loadImagePart(relPath: string): Promise<{ imageBytes: string; mimeType: string }> {
  const buffer = await readBuffer(relPath);
  return { imageBytes: buffer.toString("base64"), mimeType: "image/png" };
}

/**
 * VeoVideoProvider — image-to-video qua Gemini API (chung GEMINI_API_KEY).
 * Submit generateVideos → poll operation 10s/lần → DOWNLOAD BYTES NGAY
 * (video chỉ lưu server 2 ngày — không bao giờ lưu URI).
 */
export class VeoVideoProvider implements VideoProvider {
  readonly name: string;
  private readonly ai: GoogleGenAI;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    this.ai = new GoogleGenAI({ apiKey });
    this.apiKey = apiKey;
    this.model = model;
    this.name = model;
  }

  async generateClip(request: VideoRequest): Promise<GeneratedClip> {
    try {
      const image = await loadImagePart(request.imagePath);
      const lastFrame = request.lastImagePath
        ? await loadImagePart(request.lastImagePath)
        : undefined;
      const referenceImages =
        request.referenceImagePaths.length > 0
          ? await Promise.all(
              request.referenceImagePaths.map(async (p) => ({
                image: await loadImagePart(p),
                referenceType: VideoGenerationReferenceType.ASSET,
              })),
            )
          : undefined;

      let operation = await this.ai.models.generateVideos({
        model: this.model,
        prompt: request.prompt,
        image,
        config: {
          durationSeconds: request.durationSeconds,
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          negativePrompt: request.negativePrompt,
          personGeneration: "allow_adult",
          numberOfVideos: 1,
          ...(lastFrame ? { lastFrame } : {}),
          ...(referenceImages ? { referenceImages } : {}),
        },
      });

      const startedAt = Date.now();
      while (!operation.done) {
        if (Date.now() - startedAt > HARD_TIMEOUT_MS) {
          throw new AppError(
            "INTERNAL",
            "Veo xử lý quá 10 phút — clip bị hủy chờ.",
            "Thử tạo lại clip; giờ cao điểm Veo có thể chậm.",
          );
        }
        await sleep(POLL_INTERVAL_MS);
        operation = await this.ai.operations.getVideosOperation({ operation });
      }

      const response = operation.response;
      if (!response || (response.raiMediaFilteredCount ?? 0) > 0) {
        const reasons = response?.raiMediaFilteredReasons?.join("; ") ?? "";
        throw new AppError(
          "PROVIDER_SAFETY_BLOCK",
          "Veo chặn clip vì safety filter.",
          reasons || "Sửa mô tả cảnh rồi tạo lại — clip bị chặn không tính tiền.",
        );
      }

      const video = response.generatedVideos?.[0]?.video;
      if (!video) {
        throw new AppError("INTERNAL", "Veo không trả về video nào.");
      }

      if (video.videoBytes) {
        return { data: Buffer.from(video.videoBytes, "base64"), mimeType: "video/mp4" };
      }
      if (video.uri) {
        logger.info({ model: this.model }, "downloading veo clip from uri");
        const res = await fetch(video.uri, {
          headers: { "x-goog-api-key": this.apiKey },
          redirect: "follow",
        });
        if (!res.ok) {
          throw new AppError("INTERNAL", `Tải video từ Veo thất bại (HTTP ${res.status}).`);
        }
        return {
          data: Buffer.from(await res.arrayBuffer()),
          mimeType: video.mimeType ?? "video/mp4",
        };
      }
      throw new AppError("INTERNAL", "Veo trả video không có bytes lẫn URI.");
    } catch (err: unknown) {
      throw classifyError(err);
    }
  }
}
