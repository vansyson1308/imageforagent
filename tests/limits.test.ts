import { describe, expect, it } from "vitest";
import { validateAssetUpload } from "@/lib/config/limits";

const png = (sizeBytes = 1024): { mimeType: string; sizeBytes: number } => ({
  mimeType: "image/png",
  sizeBytes,
});

describe("validateAssetUpload (watermark)", () => {
  it("accepts a single valid PNG", () => {
    expect(validateAssetUpload("watermark", 0, [png()])).toEqual({ ok: true });
  });

  it("replace: vẫn nhận khi đã có watermark cũ", () => {
    expect(validateAssetUpload("watermark", 1, [png()])).toEqual({ ok: true });
  });

  it("rejects nhiều hơn 1 file mỗi đợt", () => {
    const result = validateAssetUpload("watermark", 0, [png(), png()]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("ASSET_LIMIT");
  });

  it("rejects file quá 8MB", () => {
    const result = validateAssetUpload("watermark", 0, [png(12 * 1024 * 1024)]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("ASSET_TOO_LARGE");
  });

  it("rejects mime không hỗ trợ", () => {
    const result = validateAssetUpload("watermark", 0, [
      { mimeType: "image/gif", sizeBytes: 100 },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("ASSET_BAD_TYPE");
  });

  it("rejects danh sách file rỗng", () => {
    expect(validateAssetUpload("watermark", 0, []).ok).toBe(false);
  });
});
