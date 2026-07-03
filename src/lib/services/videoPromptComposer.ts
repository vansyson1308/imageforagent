import { motionForShotType } from "@/lib/config/motion";
import {
  TIER_RULES,
  effectiveClipDuration,
  type VideoTier,
} from "@/lib/config/video";

/**
 * VideoPromptComposer — pure function, snapshot-tested.
 * Sinh VideoRequest cho Veo từ frame đã generate: prompt chuyển động
 * (character lock + motion theo shotType + audio cues) + ảnh first-frame
 * (+ lastFrame nếu interpolation, + mascot refs nếu tier hỗ trợ).
 */

export interface VideoComposerProject {
  readonly characterDesc: string | null;
  readonly aspectRatio: string; // "16:9" | "9:16"
  readonly videoResolution: string; // "720p" | "1080p"
  readonly clipDurationSec: number;
}

export interface VideoComposerFrame {
  readonly index: number;
  readonly shotType: string;
  readonly description: string;
  readonly rawImagePath: string; // ảnh gốc chưa watermark
  readonly voiceoverText: string | null;
}

export interface VideoComposerAsset {
  readonly kind: string;
  readonly filePath: string;
  readonly mimeType: string;
  readonly order: number;
}

export interface VideoRequest {
  readonly tier: VideoTier;
  readonly prompt: string;
  readonly negativePrompt: string;
  /** Ảnh first-frame (relative path — provider tự đọc). */
  readonly imagePath: string;
  /** Ảnh last-frame cho interpolation mode. */
  readonly lastImagePath: string | null;
  /** Mascot refs (≤3) khi tier hỗ trợ — giữ nhân vật khi chuyển động. */
  readonly referenceImagePaths: readonly string[];
  readonly durationSeconds: number;
  readonly aspectRatio: string;
  readonly resolution: string;
}

const NEGATIVE_PROMPT =
  "character redesign, off-model character, morphing anatomy, extra limbs, " +
  "flickering, jitter, text, captions, subtitles, watermark, logo, " +
  "photorealistic style, 3D render, camera shake";

export function composeVideoRequest(
  tier: VideoTier,
  project: VideoComposerProject,
  frame: VideoComposerFrame,
  assets: readonly VideoComposerAsset[],
  totalFrames: number,
  nextFrame: VideoComposerFrame | null, // interpolation target (frame i+1)
): VideoRequest {
  const rules = TIER_RULES[tier];
  const motion = motionForShotType(frame.shotType);
  const interp = nextFrame !== null;

  const lines: string[] = [];
  lines.push(
    "Animate this 2D cartoon storyboard frame into a smooth animation clip. " +
      "The starting image is the exact visual reference — preserve its art style, " +
      "colors, lighting, and composition.",
  );

  const desc = project.characterDesc?.trim();
  if (desc) {
    lines.push(
      `CHARACTER LOCK: The main character (${desc}) must stay perfectly on-model — ` +
        "same proportions, colors, costume, accessories through every moment of motion.",
    );
  }

  lines.push(`SCENE (Frame ${frame.index}/${totalFrames}): ${frame.description}`);
  lines.push(`CAMERA: ${motion.veoMotion}.`);

  if (interp) {
    lines.push(
      "TRANSITION: The clip starts exactly at the first image and ends exactly at " +
        "the last image, evolving naturally between the two scenes.",
    );
  }

  // Audio cues — chỉ khi tier có native audio
  if (rules.hasNativeAudio) {
    if (frame.voiceoverText?.trim()) {
      // Frame có voiceover TTS riêng → cấm thoại native để không đè VO
      lines.push(
        "AUDIO: Ambient scene sounds and soft sound effects only. " +
          "No speech, no talking, no narration, no singing.",
      );
    } else {
      lines.push(
        "AUDIO: Natural ambient sounds and sound effects matching the scene.",
      );
    }
  }

  lines.push("Loopable gentle motion, no scene cuts inside the clip.");

  return {
    tier,
    prompt: lines.join("\n"),
    negativePrompt: NEGATIVE_PROMPT,
    imagePath: frame.rawImagePath,
    lastImagePath: interp ? nextFrame.rawImagePath : null,
    referenceImagePaths: rules.supportsReferenceImages
      ? assets
          .filter((a) => a.kind === "mascot_ref")
          .slice()
          .sort((a, b) => a.order - b.order)
          .slice(0, 3)
          .map((a) => a.filePath)
      : [],
    durationSeconds: effectiveClipDuration(
      tier,
      project.clipDurationSec,
      project.videoResolution,
    ),
    aspectRatio: project.aspectRatio,
    resolution: rules.allowedResolutions.includes(project.videoResolution)
      ? project.videoResolution
      : "720p",
  };
}
