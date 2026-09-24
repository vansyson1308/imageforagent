/**
 * Fast QA: 6 sampled frames per shot through the same compile → compose →
 * sanitize → rasterize path the API uses, one contact sheet per shot.
 *   npx tsx examples/film/qa.ts [shotIdPrefix]   → /tmp/claude-0/film/qa/<id>.png
 */
import { mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { motionSpecSchema } from "@/lib/validation/motionSchema";
import { composeMotionFrame, createMotionCompiler } from "@/lib/services/motion/compileMotion";
import { LOGICAL_CANVAS, renderArtwork, sanitizeSvg } from "@/lib/services/svgRenderer";
import { buildShot } from "./shots";
import { SHOTS } from "./screenplay";

async function main() {
  const pat = process.argv[2] ?? "";
  const out = "/tmp/claude-0/film/qa";
  mkdirSync(out, { recursive: true });
  const canvas = LOGICAL_CANVAS["1.85:1"];
  for (const def of SHOTS) {
    if (pat && !def.id.startsWith(pat)) continue;
    const t0 = Date.now();
    const b = buildShot(def);
    const motion = motionSpecSchema.parse(b.json);
    const c = createMotionCompiler(motion, {}, { canvas });
    const n = 6;
    const tiles: Buffer[] = [];
    for (let k = 0; k < n; k++) {
      const i = Math.round((k * (c.frameCount - 1)) / (n - 1));
      const body = composeMotionFrame(motion, c.compileFrame(i).svg, canvas);
      sanitizeSvg(body, "frame");
      tiles.push(await sharp(await renderArtwork(null, body, "1.85:1", "1K")).resize(500, 270).png().toBuffer());
    }
    const sheet = await sharp({ create: { width: 1500, height: 540, channels: 3, background: "#000" } })
      .composite(tiles.map((t, k) => ({ input: t, left: (k % 3) * 500, top: Math.floor(k / 3) * 270 })))
      .png()
      .toBuffer();
    writeFileSync(`${out}/${def.id}.png`, sheet);
    const w = c.summary().warnings.filter((x) => !x.startsWith("Effects") && !x.startsWith("Lipsync"));
    console.log(def.id, `${((Date.now() - t0) / 1000).toFixed(1)}s`, w.slice(0, 2).join(" | "));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
