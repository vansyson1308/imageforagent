import { describe, expect, it } from "vitest";
import {
  compose,
  type ComposerAsset,
  type ComposerFrame,
  type ComposerProject,
} from "@/lib/services/promptComposer";

const project: ComposerProject = {
  characterDesc: "A cheerful orange fox mascot named Tantan wearing a red apron with a ramen bowl logo",
  aspectRatio: "16:9",
  resolution: "1K",
};

const frame: ComposerFrame = {
  index: 2,
  shotType: "Wide static shot",
  description: "A spotlight glows on a large ramen bowl in the center of the izakaya",
};

const assets: ComposerAsset[] = [
  { kind: "style_ref", filePath: "p1/assets/style-b.png", mimeType: "image/png", order: 1 },
  { kind: "mascot_ref", filePath: "p1/assets/mascot-b.png", mimeType: "image/png", order: 1 },
  { kind: "mascot_ref", filePath: "p1/assets/mascot-a.png", mimeType: "image/png", order: 0 },
  { kind: "watermark", filePath: "p1/assets/wm.png", mimeType: "image/png", order: 0 },
  { kind: "style_ref", filePath: "p1/assets/style-a.png", mimeType: "image/png", order: 0 },
];

describe("compose", () => {
  it("orders references: mascot_ref (by order) first, then style_ref — watermark excluded", () => {
    const req = compose(project, frame, assets, 7);
    expect(req.referenceImages.map((r) => r.filePath)).toEqual([
      "p1/assets/mascot-a.png",
      "p1/assets/mascot-b.png",
      "p1/assets/style-a.png",
      "p1/assets/style-b.png",
    ]);
  });

  it("includes CHARACTER LOCK block when mascot refs exist", () => {
    const req = compose(project, frame, assets, 7);
    expect(req.prompt).toContain("CHARACTER LOCK:");
    expect(req.prompt).toContain("Do NOT redesign");
    expect(req.prompt).toContain("Tantan");
  });

  it("uses style preset when no style refs", () => {
    const noStyle = assets.filter((a) => a.kind !== "style_ref");
    const req = compose(project, frame, noStyle, 7);
    expect(req.prompt).toContain("Flat 2D cartoon illustration");
  });

  it("embeds frame index/total, shot type mapping, and aspect ratio", () => {
    const req = compose(project, frame, assets, 7);
    expect(req.prompt).toContain("SCENE (Frame 2/7):");
    expect(req.prompt).toContain("Wide static shot");
    expect(req.prompt).toContain("lower third");
    expect(req.prompt).toContain("16:9 aspect ratio");
    expect(req.aspectRatio).toBe("16:9");
    expect(req.resolution).toBe("1K");
  });

  it("contains NEGATIVE block and no-watermark instruction", () => {
    const req = compose(project, frame, assets, 7);
    expect(req.prompt).toContain("NEGATIVE:");
    expect(req.prompt).toContain("No watermark");
  });

  it("caps references at 3 per kind", () => {
    const many: ComposerAsset[] = Array.from({ length: 5 }, (_, i) => ({
      kind: "mascot_ref",
      filePath: `p1/assets/m${i}.png`,
      mimeType: "image/png",
      order: i,
    }));
    const req = compose(project, frame, many, 7);
    expect(req.referenceImages).toHaveLength(3);
  });

  it("matches snapshot (prompt structure is a frozen contract)", () => {
    const req = compose(project, frame, assets, 7);
    expect(req.prompt).toMatchSnapshot();
  });
});
