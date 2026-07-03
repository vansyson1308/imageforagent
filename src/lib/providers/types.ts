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

export interface VoiceoverDraft {
  readonly index: number;
  readonly voiceover: string;
}

/** Adapter cho LLM text (AI bulk edit kịch bản + viết lời thuyết minh). */
export interface TextProvider {
  readonly name: string;
  editScript(
    instruction: string,
    frames: readonly ScriptFrameEdit[],
  ): Promise<readonly ScriptFrameEdit[]>;
  draftVoiceover(
    frames: readonly ScriptFrameEdit[],
    styleHint?: string,
  ): Promise<readonly VoiceoverDraft[]>;
}

// ---------- Phase 9: video + TTS ----------

import type { VideoRequest } from "@/lib/services/videoPromptComposer";

export interface GeneratedClip {
  readonly data: Buffer;
  readonly mimeType: string; // video/mp4
}

/** Adapter model video (Veo...) — download bytes NGAY trong generate (retention 2 ngày). */
export interface VideoProvider {
  readonly name: string;
  generateClip(request: VideoRequest): Promise<GeneratedClip>;
}

export interface TtsResult {
  readonly data: Buffer; // WAV
  readonly mimeType: string; // audio/wav
}

/** Adapter text-to-speech cho voiceover. */
export interface TtsProvider {
  readonly name: string;
  synthesize(text: string): Promise<TtsResult>;
}
