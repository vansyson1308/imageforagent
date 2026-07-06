import type { ImageRequest } from "@/lib/services/promptComposer";

export interface GeneratedImage {
  readonly data: Buffer;
  readonly mimeType: string;
}

/**
 * Adapter cho model tạo ảnh — mọi call đi qua interface này,
 * không gọi SDK trực tiếp từ UI hay route handler.
 */
export interface ImageProvider {
  readonly name: string;
  generate(request: ImageRequest): Promise<GeneratedImage>;
}

export interface ScriptFrameEdit {
  readonly index: number;
  readonly shotType: string;
  readonly description: string;
}

/** Adapter cho LLM text (AI bulk edit kịch bản). */
export interface TextProvider {
  readonly name: string;
  editScript(
    instruction: string,
    frames: readonly ScriptFrameEdit[],
  ): Promise<readonly ScriptFrameEdit[]>;
}
