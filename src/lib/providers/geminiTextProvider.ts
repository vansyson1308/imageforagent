import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import type {
  ScriptFrameEdit,
  TextProvider,
  VoiceoverDraft,
} from "@/lib/providers/types";
import { AppError } from "@/lib/services/apiError";

const editResultSchema = z.object({
  frames: z
    .array(
      z.object({
        index: z.number().int().min(1),
        shotType: z.string().min(1),
        description: z.string().min(1),
      }),
    )
    .min(1),
});

/** JSON Schema gửi cho model — khớp với zod schema ở trên. */
const RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    frames: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer" },
          shotType: { type: "string" },
          description: { type: "string" },
        },
        required: ["index", "shotType", "description"],
      },
    },
  },
  required: ["frames"],
} as const;

const SYSTEM_INSTRUCTION = `You are a storyboard script editor for 2D animation videos.
You receive the current storyboard as a JSON array of frames ({index, shotType, description}) and an editing instruction.
Apply the instruction to the WHOLE script and return ALL frames as JSON matching the provided schema.
Rules:
- Keep the same number of frames unless the instruction explicitly asks to add or remove frames.
- Keep frame indexes sequential starting from 1.
- Keep the original language of each description unless the instruction asks to translate.
- Keep shotType values unchanged unless the instruction asks to change camera/shot composition.
- Never add commentary — return only the JSON object.`;

/**
 * GeminiTextProvider — AI bulk edit kịch bản, trả JSON đúng schema.
 * Retry 1 lần nếu JSON sai schema, sau đó báo lỗi thân thiện.
 */
export class GeminiTextProvider implements TextProvider {
  readonly name = "gemini-text";
  private readonly ai: GoogleGenAI;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    this.ai = new GoogleGenAI({ apiKey });
    this.model = model;
  }

  async editScript(
    instruction: string,
    frames: readonly ScriptFrameEdit[],
  ): Promise<readonly ScriptFrameEdit[]> {
    const payload = JSON.stringify({ instruction, frames }, null, 2);

    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const interaction = await this.ai.interactions.create({
          model: this.model,
          system_instruction: SYSTEM_INSTRUCTION,
          input: payload,
          response_format: {
            type: "text",
            mime_type: "application/json",
            schema: RESPONSE_JSON_SCHEMA as Record<string, unknown>,
          },
        });

        const text = interaction.output_text;
        if (!text) {
          throw new Error("Model không trả về nội dung.");
        }
        const parsed = editResultSchema.parse(JSON.parse(text));
        return parsed.frames;
      } catch (err: unknown) {
        lastError = err;
        if (err instanceof AppError) throw err;
        // JSON sai schema / parse lỗi → thử lại đúng 1 lần
      }
    }

    const detail = lastError instanceof Error ? lastError.message : "";
    throw new AppError(
      "INTERNAL",
      "AI không trả về kịch bản hợp lệ sau 2 lần thử.",
      detail ? `Chi tiết: ${detail.slice(0, 200)}` : "Thử diễn đạt yêu cầu ngắn gọn, rõ ràng hơn.",
    );
  }

  async draftVoiceover(
    frames: readonly ScriptFrameEdit[],
    styleHint?: string,
  ): Promise<readonly VoiceoverDraft[]> {
    const system = `You are a narration writer for short 2D animation marketing videos.
For EACH storyboard frame, write ONE short voiceover line (Vietnamese if the descriptions are Vietnamese, otherwise same language as descriptions).
Rules:
- Each line must be speakable within the clip (max ~18 words).
- Warm, friendly, energetic tone suitable for a mascot brand video.${styleHint ? `\n- Style guidance from the user: ${styleHint}` : ""}
- Return JSON only, matching the schema. One entry per frame, same indexes.`;

    const schema = {
      type: "object",
      properties: {
        frames: {
          type: "array",
          items: {
            type: "object",
            properties: {
              index: { type: "integer" },
              voiceover: { type: "string" },
            },
            required: ["index", "voiceover"],
          },
        },
      },
      required: ["frames"],
    } as const;

    const voSchema = z.object({
      frames: z
        .array(z.object({ index: z.number().int().min(1), voiceover: z.string().min(1) }))
        .min(1),
    });

    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const interaction = await this.ai.interactions.create({
          model: this.model,
          system_instruction: system,
          input: JSON.stringify({ frames }, null, 2),
          response_format: {
            type: "text",
            mime_type: "application/json",
            schema: schema as Record<string, unknown>,
          },
        });
        const text = interaction.output_text;
        if (!text) throw new Error("Model không trả về nội dung.");
        return voSchema.parse(JSON.parse(text)).frames;
      } catch (err: unknown) {
        lastError = err;
        if (err instanceof AppError) throw err;
      }
    }

    const detail = lastError instanceof Error ? lastError.message : "";
    throw new AppError(
      "INTERNAL",
      "AI không viết được lời thuyết minh hợp lệ sau 2 lần thử.",
      detail ? `Chi tiết: ${detail.slice(0, 200)}` : undefined,
    );
  }
}
