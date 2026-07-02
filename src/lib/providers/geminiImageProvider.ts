import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import type { ImageRequest } from "@/lib/services/promptComposer";
import type { GeneratedImage, ImageProvider } from "@/lib/providers/types";
import { AppError } from "@/lib/services/apiError";
import { readBuffer } from "@/lib/services/storage";

interface ImagePart {
  readonly type: "image";
  readonly data: string;
  readonly mime_type: string;
}

interface TextPart {
  readonly type: "text";
  readonly text: string;
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
      "Model ảnh đang bị giới hạn tốc độ/quota.",
      "Đợi một lúc rồi thử lại, hoặc kiểm tra quota API key.",
    );
  }
  if (/safety|blocked|prohibited|SAFETY/i.test(message)) {
    return new AppError(
      "PROVIDER_SAFETY_BLOCK",
      "Prompt bị safety filter của model chặn.",
      "Sửa lại mô tả cảnh: tránh từ ngữ nhạy cảm, thương hiệu, người thật.",
    );
  }
  return new AppError("INTERNAL", `Lỗi từ model ảnh: ${message}`);
}

/**
 * GeminiImageProvider — gọi Gemini Interactions API (Nano Banana) với
 * text prompt + reference images. Model qua env GEMINI_IMAGE_MODEL.
 */
export class GeminiImageProvider implements ImageProvider {
  readonly name = "gemini";
  private readonly ai: GoogleGenAI;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    this.ai = new GoogleGenAI({ apiKey });
    this.model = model;
  }

  async generate(request: ImageRequest): Promise<GeneratedImage> {
    const imageParts: ImagePart[] = await Promise.all(
      request.referenceImages.map(async (ref) => ({
        type: "image" as const,
        data: (await readBuffer(ref.filePath)).toString("base64"),
        mime_type: ref.mimeType,
      })),
    );

    const input: Array<TextPart | ImagePart> = [
      { type: "text", text: request.prompt },
      ...imageParts,
    ];

    try {
      const interaction = await this.ai.interactions.create({
        model: this.model,
        input,
        response_format: {
          type: "image",
          // API chỉ hỗ trợ image/jpeg cho response_format — convert PNG phía dưới
          mime_type: "image/jpeg",
          aspect_ratio: request.aspectRatio,
          image_size: request.resolution, // "1K" | "2K" — chữ K viết hoa
        },
      });

      const image = interaction.output_image;
      if (!image?.data) {
        // Model trả text thay vì ảnh — thường là từ chối do safety/policy
        const text = (interaction.output_text ?? "").slice(0, 300);
        throw new AppError(
          "PROVIDER_SAFETY_BLOCK",
          "Model không trả về ảnh cho frame này.",
          text || "Thử diễn đạt lại mô tả cảnh đơn giản và trung tính hơn.",
        );
      }

      // Chuẩn hoá về PNG để pipeline (raw/watermark/export) đồng nhất
      const png = await sharp(Buffer.from(image.data, "base64")).png().toBuffer();
      return { data: png, mimeType: "image/png" };
    } catch (err: unknown) {
      throw classifyError(err);
    }
  }
}
