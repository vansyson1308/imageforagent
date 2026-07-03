import path from "node:path";
import fs from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { applyWatermark } from "@/lib/services/watermarker";
import { resolveStoragePath } from "@/lib/services/storage";

const DIR = "_test-wm";

async function makePng(relPath: string, w: number, h: number): Promise<void> {
  const absolute = resolveStoragePath(relPath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await sharp({
    create: { width: w, height: h, channels: 4, background: { r: 40, g: 40, b: 60, alpha: 1 } },
  })
    .png()
    .toFile(absolute);
}

describe("applyWatermark clamping (regression audit)", () => {
  beforeAll(async () => {
    await makePng(`${DIR}/base-small.png`, 320, 180);
    // Logo DỌC rất cao — trước fix sẽ làm sharp composite throw
    await makePng(`${DIR}/logo-tall.png`, 80, 1200);
    await makePng(`${DIR}/logo-normal.png`, 300, 80);
  });

  afterAll(async () => {
    await fs.rm(resolveStoragePath(DIR), { recursive: true, force: true });
  });

  it("does not throw when logo is taller than the base image", async () => {
    await applyWatermark(
      `${DIR}/base-small.png`,
      `${DIR}/out-tall.png`,
      `${DIR}/logo-tall.png`,
      { position: "bottom-right", scalePercent: 12, opacity: 0.85 },
    );
    const meta = await sharp(resolveStoragePath(`${DIR}/out-tall.png`)).metadata();
    expect(meta.width).toBe(320);
    expect(meta.height).toBe(180);
  });

  it("handles scalePercent larger than image (clamped inside)", async () => {
    await applyWatermark(
      `${DIR}/base-small.png`,
      `${DIR}/out-big.png`,
      `${DIR}/logo-normal.png`,
      { position: "center", scalePercent: 100, opacity: 0.5 },
    );
    const meta = await sharp(resolveStoragePath(`${DIR}/out-big.png`)).metadata();
    expect(meta.width).toBe(320);
  });

  it("applies normally at default settings", async () => {
    await applyWatermark(
      `${DIR}/base-small.png`,
      `${DIR}/out-normal.png`,
      `${DIR}/logo-normal.png`,
      { position: "bottom-right", scalePercent: 12, opacity: 0.85 },
    );
    const out = await fs.readFile(resolveStoragePath(`${DIR}/out-normal.png`));
    expect(out.length).toBeGreaterThan(0);
  });
});
