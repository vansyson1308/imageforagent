/**
 * End credits for films narrated by the owner's AivisSpeech voice (owner
 * decision A1, 2026-10-10: credit morioki in the film, the README and
 * Devpost, although ACML 1.0 makes it optional).
 *
 *   npx tsx scripts/director/credits.ts      # (re)draw public/credits/*.png (needs a Noto CJK font, once)
 *
 * The card is a committed image, drawn once with a CJK font, so the server
 * needs no font; the publish scripts (pilot.ts, showcase.ts) append it to the
 * downloaded film with ffmpeg (`appendCredits`), argv arrays, never a shell.
 */
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import sharp from "sharp";
import { VOICE_CREDIT } from "@/lib/services/director/ownerPackage";

export const CREDIT_SECONDS = 3;
export const creditCard = (aspect: "16:9" | "9:16") => `public/credits/voice-morioki-${aspect.replace(":", "x")}.png`;

const ANIMATION = ["Animation: Storyboard Studio Director", "NVIDIA Nemotron on Nebius Token Factory"];
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The card as SVG: warm cream, the voice credit in two lines, and what made the film. */
export function creditSvg(aspect: "16:9" | "9:16"): string {
  const [w, h] = aspect === "16:9" ? [1920, 1080] : [1080, 1920];
  const [main, detail] = VOICE_CREDIT.split("（");
  const size = aspect === "16:9" ? 56 : 46;
  const font = "font-family=\"Noto Sans CJK JP, Noto Sans JP, sans-serif\"";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<rect width="${w}" height="${h}" fill="#f3e6cf"/>
<rect x="${w * 0.08}" y="${h / 2 - size * 2.6}" width="${w * 0.84}" height="${size * (aspect === "16:9" ? 5.2 : 6)}" rx="24" fill="#efe2c6" stroke="#b0773a" stroke-width="3"/>
<text x="${w / 2}" y="${h / 2 - size * 0.6}" ${font} font-size="${size}" fill="#5a3a22" text-anchor="middle">${esc(main)}</text>
<text x="${w / 2}" y="${h / 2 + size * 0.7}" ${font} font-size="${Math.round(size * 0.62)}" fill="#7a5233" text-anchor="middle">（${esc(detail)}</text>
${(aspect === "16:9" ? [ANIMATION.join(" · ")] : ANIMATION).map((t, i) => `<text x="${w / 2}" y="${h / 2 + size * (1.8 + i * 0.75)}" ${font} font-size="${Math.round(size * 0.5)}" fill="#8a6a4a" text-anchor="middle">${esc(t)}</text>`).join("\n")}
</svg>`;
}

/** Duration (s) and stream facts of a film, from ffprobe. */
function probe(file: string): { w: number; h: number; fps: number; audio: boolean } {
  const v = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate", "-of", "csv=p=0", file], { encoding: "utf8" }).stdout.trim().split(",");
  const a = spawnSync("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", file], { encoding: "utf8" }).stdout.trim();
  const [num, den] = (v[2] ?? "12/1").split("/").map(Number);
  return { w: Number(v[0]), h: Number(v[1]), fps: Math.round(num / (den || 1)) || 12, audio: a.length > 0 };
}

/** Append the credit card (CREDIT_SECONDS, silent) to a film in place. */
export function appendCredits(film: string, aspect: "16:9" | "9:16"): void {
  const card = creditCard(aspect);
  if (!existsSync(card)) throw new Error(`${card} is missing: run npx tsx scripts/director/credits.ts`);
  const p = probe(film);
  const tmp = `${film}.credits.mp4`;
  const scale = `scale=${p.w}:${p.h}:force_original_aspect_ratio=decrease,pad=${p.w}:${p.h}:(ow-iw)/2:(oh-ih)/2:color=#f3e6cf,setsar=1,fps=${p.fps},format=yuv420p`;
  const args = p.audio
    ? ["-loglevel", "error", "-y", "-i", film, "-loop", "1", "-t", String(CREDIT_SECONDS), "-i", card, "-f", "lavfi", "-t", String(CREDIT_SECONDS), "-i", "anullsrc=r=48000:cl=stereo",
       "-filter_complex", `[0:v]setsar=1,fps=${p.fps},format=yuv420p[a0];[1:v]${scale}[c];[0:a]aresample=48000,aformat=channel_layouts=stereo[s0];[2:a]aformat=channel_layouts=stereo[s1];[a0][s0][c][s1]concat=n=2:v=1:a=1[v][a]`,
       "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", tmp]
    : ["-loglevel", "error", "-y", "-i", film, "-loop", "1", "-t", String(CREDIT_SECONDS), "-i", card,
       "-filter_complex", `[0:v]setsar=1,fps=${p.fps},format=yuv420p[a0];[1:v]${scale}[c];[a0][c]concat=n=2:v=1:a=0[v]`,
       "-map", "[v]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", tmp];
  const r = spawnSync("ffmpeg", args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`appending the credits failed: ${r.stderr.slice(0, 400)}`);
  renameSync(tmp, film);
}

async function main() {
  mkdirSync("public/credits", { recursive: true });
  for (const a of ["16:9", "9:16"] as const) {
    writeFileSync(creditCard(a), await sharp(Buffer.from(creditSvg(a))).png().toBuffer());
    console.log(`wrote ${creditCard(a)}`);
  }
}

if (process.argv[1]?.endsWith("credits.ts")) main();
