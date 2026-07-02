import { shotTypeToCameraInstruction } from "@/lib/config/shot-types";

/**
 * PromptComposer — pure function, không side effect.
 * Quyết định 80% chất lượng nhất quán nhân vật (spec mục 5 của blueprint).
 * Cấu trúc prompt và thứ tự reference images là CỐ ĐỊNH — thay đổi phải
 * cập nhật snapshot test đi kèm.
 */

export interface ComposerProject {
  readonly characterDesc: string | null;
  readonly aspectRatio: string; // "16:9" | "9:16" | "1:1" | "4:5"
  readonly resolution: string; // "1K" | "2K"
}

export interface ComposerFrame {
  readonly index: number;
  readonly shotType: string;
  readonly description: string;
}

export interface ComposerAsset {
  readonly kind: string; // "mascot_ref" | "style_ref" | "watermark"
  readonly filePath: string;
  readonly mimeType: string;
  readonly order: number;
}

export interface ReferenceImage {
  readonly filePath: string;
  readonly mimeType: string;
  readonly role: "mascot_ref" | "style_ref";
}

export interface ImageRequest {
  readonly prompt: string;
  /** Thứ tự cố định: mascot_ref[0..2] trước, style_ref[0..2] sau. */
  readonly referenceImages: readonly ReferenceImage[];
  readonly aspectRatio: string;
  readonly resolution: string;
}

const DEFAULT_STYLE_PRESET =
  "Flat 2D cartoon illustration, bold clean outlines, vibrant saturated colors, soft shading, consistent art direction across the whole storyboard.";

function pickRefs(assets: readonly ComposerAsset[], kind: "mascot_ref" | "style_ref"): ReferenceImage[] {
  return assets
    .filter((a) => a.kind === kind)
    .slice()
    .sort((a, b) => a.order - b.order)
    .slice(0, 3)
    .map((a) => ({ filePath: a.filePath, mimeType: a.mimeType, role: kind }));
}

export function compose(
  project: ComposerProject,
  frame: ComposerFrame,
  assets: readonly ComposerAsset[],
  totalFrames: number,
): ImageRequest {
  const mascotRefs = pickRefs(assets, "mascot_ref");
  const styleRefs = pickRefs(assets, "style_ref");

  const lines: string[] = [];
  lines.push("ROLE: Professional 2D animation storyboard artist.");

  if (mascotRefs.length > 0) {
    const desc = project.characterDesc?.trim();
    lines.push(
      "CHARACTER LOCK: The main character MUST match the attached character reference images exactly — " +
        "same proportions, colors, costume, accessories, and facial features." +
        (desc ? ` Character description: ${desc}.` : "") +
        " Do NOT redesign, restyle, or alter the character in any way.",
    );
  } else if (project.characterDesc?.trim()) {
    lines.push(
      `CHARACTER: ${project.characterDesc.trim()}. Keep this character design identical across every frame of the storyboard.`,
    );
  }

  if (styleRefs.length > 0) {
    lines.push(
      "STYLE: Match the attached style reference images exactly — same rendering technique, color palette, lighting mood, and level of detail.",
    );
  } else {
    lines.push(`STYLE: ${DEFAULT_STYLE_PRESET}`);
  }

  lines.push(`SCENE (Frame ${frame.index}/${totalFrames}): ${frame.description}`);
  lines.push(
    `SHOT TYPE: ${frame.shotType} — ${shotTypeToCameraInstruction(frame.shotType)}.`,
  );
  lines.push(
    "CONTINUITY: Same location, same lighting, same props as the previous frames of this storyboard unless the scene description states otherwise.",
  );
  lines.push(
    `FORMAT: ${project.aspectRatio} aspect ratio. No text, captions, or subtitles inside the image. No watermark or logo. Clean composition suitable for video production.`,
  );
  lines.push(
    "NEGATIVE: extra fingers, deformed anatomy, different character design, inconsistent colors, photorealistic style, 3D render, UI elements, borders, frames.",
  );

  return {
    prompt: lines.join("\n"),
    referenceImages: [...mascotRefs, ...styleRefs],
    aspectRatio: project.aspectRatio,
    resolution: project.resolution,
  };
}
