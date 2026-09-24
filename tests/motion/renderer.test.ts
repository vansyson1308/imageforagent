import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { encodeAnimatedWebp, encodeContactSheet, renderMotionClip } from "@/lib/services/motionRenderer";
import { motionSpecSchema } from "@/lib/validation/motionSchema";
import { AppError } from "@/lib/services/apiError";

const motion = (m: Record<string, unknown> = {}) =>
  motionSpecSchema.parse({
    version: 1,
    fps: 6,
    duration: 1,
    scene: {
      version: 1,
      solids: [{ id: "ball", type: "sphere", r: 60, at: [0, 60, 0], fill: "#e74c3c" }],
    },
    tracks: [{ target: "solids.ball.at.0", keys: [{ t: 0, v: -300 }, { t: 1, v: 300, ease: "linear" }] }],
    ...m,
  });

describe("motionRenderer", () => {
  it("render clip: đủ frame, PNG đúng kích thước, poster theo thời điểm", async () => {
    const r = await renderMotionClip({ motion: motion({ poster: 0.5 }), defs: null, aspectRatio: "16:9", resolution: "1K" });
    expect(r.frames).toHaveLength(6);
    expect(r.stats.posterIndex).toBe(3);
    const meta = await sharp(r.frames[0].png).metadata();
    expect([meta.width, meta.height]).toEqual([1024, 576]);
    expect(r.posterPng.equals(r.frames[3].png)).toBe(true);
    expect(r.frames[0].png.equals(r.frames[1].png)).toBe(false);
  });

  it("backdrop độc hại bị sanitizer chặn (ARTWORK_INVALID)", async () => {
    await expect(
      renderMotionClip({
        motion: motion({ backdrop: '<image href="http://evil/x.png"/>' }),
        defs: null,
        aspectRatio: "16:9",
        resolution: "1K",
      }),
    ).rejects.toMatchObject({ code: "ARTWORK_INVALID" } satisfies Partial<AppError>);
  });

  it("backdrop tham chiếu defs project (<use href>) render được", async () => {
    const r = await renderMotionClip({
      motion: motion({ backdrop: '<use href="#sky"/>', duration: 0.5 }),
      defs: '<symbol id="sky"><rect width="1920" height="600" fill="#88c"/></symbol>',
      aspectRatio: "16:9",
      resolution: "1K",
    });
    const px = await sharp(r.frames[0].png).extract({ left: 10, top: 10, width: 1, height: 1 }).raw().toBuffer();
    expect([...px.subarray(0, 3)]).toEqual([0x88, 0x88, 0xcc]);
  });

  it("animated WebP gộp frame giống hệt (hold) thành 1 page, tổng delay đúng", async () => {
    const r = await renderMotionClip({
      motion: motion({ fps: 12, holdFrames: 2 }),
      defs: null,
      aspectRatio: "16:9",
      resolution: "1K",
    });
    const webp = await encodeAnimatedWebp(r.frames.map((f) => f.png), 12);
    const meta = await sharp(webp, { animated: true }).metadata();
    expect(meta.pages).toBe(6); // 12 frame on twos → 6 pose
    expect((meta.delay ?? []).reduce((a, b) => a + b, 0)).toBe(1000);
    expect(meta.width).toBe(640);
  });

  it("contact sheet: lưới 4 cột, ô 384px + thanh thời gian", async () => {
    const r = await renderMotionClip({ motion: motion(), defs: null, aspectRatio: "16:9", resolution: "1K" });
    const sheet = await encodeContactSheet(r.frames.map((f) => f.png), 6, r.frames.map((f) => f.t), 1);
    const meta = await sharp(sheet).metadata();
    expect(meta.width).toBe(4 * 384 + 3 * 4);
    expect(meta.height).toBe(2 * (216 + 6) + 4);
  });
});
