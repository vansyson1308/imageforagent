import { describe, expect, it } from "vitest";
import { MockImageProvider } from "@/lib/providers/mockImageProvider";
import type { ImageRequest } from "@/lib/services/promptComposer";

const baseRequest: ImageRequest = {
  prompt:
    "ROLE: test\nSCENE (Frame 3/7): The mascot waves hello to the audience\nFORMAT: 16:9",
  referenceImages: [],
  aspectRatio: "16:9",
  resolution: "1K",
};

describe("MockImageProvider", () => {
  it("returns a valid PNG buffer with 16:9 dimensions", async () => {
    const provider = new MockImageProvider();
    const result = await provider.generate(baseRequest);
    // PNG magic bytes
    expect(result.data.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(result.mimeType).toBe("image/png");

    const sharp = (await import("sharp")).default;
    const meta = await sharp(result.data).metadata();
    expect(meta.width).toBe(1024);
    expect(meta.height).toBe(576);
  });

  it("respects portrait aspect ratio 9:16", async () => {
    const provider = new MockImageProvider();
    const result = await provider.generate({ ...baseRequest, aspectRatio: "9:16" });
    const sharp = (await import("sharp")).default;
    const meta = await sharp(result.data).metadata();
    expect(meta.width).toBe(576);
    expect(meta.height).toBe(1024);
  });
});
