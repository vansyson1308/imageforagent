import { describe, expect, it } from "vitest";
import {
  composeVideoRequest,
  type VideoComposerAsset,
  type VideoComposerFrame,
  type VideoComposerProject,
} from "@/lib/services/videoPromptComposer";

const project: VideoComposerProject = {
  characterDesc: "Tantan the orange fox mascot with red neckerchief",
  aspectRatio: "16:9",
  videoResolution: "720p",
  clipDurationSec: 6,
};

const frame: VideoComposerFrame = {
  index: 2,
  shotType: "Slow zoom-in",
  description: "Tantan leans over the ramen bowl, steam swirling",
  rawImagePath: "p1/frames/f2.raw.png",
  voiceoverText: null,
};

const assets: VideoComposerAsset[] = [
  { kind: "mascot_ref", filePath: "p1/assets/m1.png", mimeType: "image/png", order: 0 },
  { kind: "mascot_ref", filePath: "p1/assets/m2.png", mimeType: "image/png", order: 1 },
  { kind: "style_ref", filePath: "p1/assets/s1.png", mimeType: "image/png", order: 0 },
  { kind: "watermark", filePath: "p1/assets/wm.png", mimeType: "image/png", order: 0 },
];

describe("composeVideoRequest", () => {
  it("fast tier: refs mascot + 8s bắt buộc (refs) + audio cue", () => {
    const req = composeVideoRequest("fast", project, frame, assets, 7, null);
    expect(req.referenceImagePaths).toEqual(["p1/assets/m1.png", "p1/assets/m2.png"]);
    expect(req.durationSeconds).toBe(8); // refs → bắt buộc 8s dù chọn 6
    expect(req.prompt).toContain("AUDIO: Natural ambient sounds");
    expect(req.prompt).toContain("CHARACTER LOCK");
    expect(req.prompt).toContain("Slow steady zoom-in");
  });

  it("lite tier: không refs, giữ duration chọn, KHÔNG audio cue (tier câm)", () => {
    const req = composeVideoRequest("lite", project, frame, assets, 7, null);
    expect(req.referenceImagePaths).toEqual([]);
    expect(req.durationSeconds).toBe(6);
    expect(req.prompt).not.toContain("AUDIO:");
  });

  it("frame có voiceover → cấm thoại native trong prompt", () => {
    const voFrame = { ...frame, voiceoverText: "Tantan nếm thử nước dùng đậm đà." };
    const req = composeVideoRequest("fast", project, voFrame, assets, 7, null);
    expect(req.prompt).toContain("No speech, no talking");
  });

  it("interpolation: có lastImagePath + dòng TRANSITION", () => {
    const next: VideoComposerFrame = {
      ...frame,
      index: 3,
      rawImagePath: "p1/frames/f3.raw.png",
    };
    const req = composeVideoRequest("fast", project, frame, assets, 7, next);
    expect(req.lastImagePath).toBe("p1/frames/f3.raw.png");
    expect(req.prompt).toContain("TRANSITION:");
  });

  it("1080p → duration 8s kể cả lite", () => {
    const hd = { ...project, videoResolution: "1080p" };
    const req = composeVideoRequest("lite", hd, frame, assets, 7, null);
    expect(req.durationSeconds).toBe(8);
    // lite không hỗ trợ 1080p → resolution rơi về 720p
    expect(req.resolution).toBe("720p");
  });

  it("snapshot prompt (hợp đồng đóng băng)", () => {
    const req = composeVideoRequest("fast", project, frame, assets, 7, null);
    expect(req.prompt).toMatchSnapshot();
    expect(req.negativePrompt).toMatchSnapshot();
  });
});
