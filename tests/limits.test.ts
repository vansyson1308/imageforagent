import { describe, expect, it } from "vitest";
import { validateAssetUpload } from "@/lib/config/limits";

const png = (sizeBytes = 1024): { mimeType: string; sizeBytes: number } => ({
  mimeType: "image/png",
  sizeBytes,
});

describe("validateAssetUpload", () => {
  it("accepts valid mascot upload within limit", () => {
    expect(validateAssetUpload("mascot_ref", 1, [png(), png()])).toEqual({ ok: true });
  });

  it("rejects 4th mascot image (limit 3)", () => {
    const result = validateAssetUpload("mascot_ref", 3, [png()]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("ASSET_LIMIT");
  });

  it("rejects batch that would exceed limit (2 existing + 2 new)", () => {
    const result = validateAssetUpload("style_ref", 2, [png(), png()]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("còn 1 slot");
  });

  it("rejects file over 8MB", () => {
    const result = validateAssetUpload("mascot_ref", 0, [png(12 * 1024 * 1024)]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("ASSET_TOO_LARGE");
  });

  it("rejects unsupported mime type", () => {
    const result = validateAssetUpload("mascot_ref", 0, [
      { mimeType: "image/gif", sizeBytes: 100 },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("ASSET_BAD_TYPE");
  });

  it("watermark: replace allowed even when one already exists", () => {
    expect(validateAssetUpload("watermark", 1, [png()])).toEqual({ ok: true });
  });

  it("watermark: rejects more than one file per batch", () => {
    const result = validateAssetUpload("watermark", 0, [png(), png()]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("ASSET_LIMIT");
  });

  it("rejects empty file list", () => {
    const result = validateAssetUpload("mascot_ref", 0, []);
    expect(result.ok).toBe(false);
  });
});
