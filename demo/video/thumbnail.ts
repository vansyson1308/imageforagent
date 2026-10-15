/**
 * YouTube thumbnail for video v2 (1280×720): shot 9 of the published kite film
 * (the by-eye frame of the published run, the same drawing as the film) with the
 * title on a soft dark band. No model call.
 *
 *   npx tsx demo/video/thumbnail.ts [--shot 9] [--out demo/video/out/thumbnail_v2.png]
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const argv = process.argv.slice(2);
const arg = (k: string, d: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const shot = Number(arg("--shot", "9"));
const out = arg("--out", "demo/video/out/thumbnail_v2.png");
const RUN = "docs/hackathon/evidence/byeye/v2-kite-cmv6z9x3k00002apec9c55j9f";
const W = 1280;
const H = 720;

const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="DejaVu Sans, Helvetica, Arial, sans-serif">
  <defs>
    <linearGradient id="band" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0.5" stop-color="#0d0d0f" stop-opacity="0"/>
      <stop offset="0.8" stop-color="#0d0d0f" stop-opacity="0.72"/>
      <stop offset="1" stop-color="#0d0d0f" stop-opacity="0.88"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#band)"/>
  <text x="1244" y="600" text-anchor="end" font-size="72" font-weight="700" fill="#ffffff" stroke="#0d0d0f" stroke-opacity="0.35" stroke-width="2">Typed, not drawn.</text>
  <text x="1244" y="650" text-anchor="end" font-size="32" fill="#ececf1">A film written as code by NVIDIA Nemotron</text>
</svg>`;

async function main() {
  mkdirSync(path.dirname(out), { recursive: true });
  const base = await sharp(`${RUN}/f${String(shot).padStart(2, "0")}.jpg`).resize(W, H, { fit: "cover" }).toBuffer();
  await sharp(base).composite([{ input: Buffer.from(overlay) }]).png().toFile(out);
  console.log(`wrote ${out} (kite shot ${shot})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
