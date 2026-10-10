/**
 * End credits on every published film (owner plan 2026-10-10, item 2): the
 * voice credit when the owner's AivisSpeech narration is used (decision A1),
 * the VAIS-1000 attribution when a Vietnamese Piper voice speaks, "Made with
 * NVIDIA Nemotron on Nebius Token Factory", and Tavily when research found
 * references. What goes on the card is decided by `filmCredits` (pure, tested)
 * from the run's trace.
 *
 *   npx tsx scripts/director/credits.ts [outDir]   # draw sample cards (all blocks, both aspects) to look at
 *
 * The card is drawn by the publish scripts (pilot.ts, showcase.ts) on the
 * machine that publishes, never on the server, and a card with Japanese
 * refuses to draw without a Japanese font (no tofu boxes in a published film).
 * ffmpeg appends it (`appendCredits`), argv arrays, never a shell.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import sharp from "sharp";
import { STUDIO_LINE, VAIS_CREDIT, NEMOTRON_LINE, TAVILY_LINE, voiceCreditLine, type CreditBlock } from "@/lib/services/director/filmCredits";
import { VOICE_CREDIT } from "@/lib/services/director/ownerPackage";

export const CREDIT_SECONDS = 3;
type Aspect = "16:9" | "9:16";

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const CJK = /[　-ヿ㐀-鿿＀-￯]/u;
/** Rough rendered width in em: CJK and full-width glyphs are 1 em, the rest about 0.56 em. */
const ems = (t: string) => [...t].reduce((n, c) => n + (CJK.test(c) ? 1 : 0.56), 0);
/** The size that keeps a line inside `maxW` px, never above `size`. */
const fit = (t: string, size: number, maxW: number) => Math.min(size, Math.floor(maxW / Math.max(1, ems(t))));

/** The owner's credit file for a package directory (qa/voice_credit.txt), when there is one. */
export function readVoiceCredit(pkgDir: string): string | null {
  const f = `${pkgDir}/qa/voice_credit.txt`;
  return existsSync(f) ? voiceCreditLine(readFileSync(f, "utf8")) : null;
}

/** The card as SVG: warm cream, the studio name, then each block (main line + smaller detail), centred. */
export function creditSvg(aspect: Aspect, blocks: readonly CreditBlock[]): string {
  const [w, h] = aspect === "16:9" ? [1920, 1080] : [1080, 1920];
  const maxW = w * 0.76;
  const base = aspect === "16:9" ? 48 : 40;
  const font = 'font-family="Noto Sans CJK JP, Noto Sans JP, Noto Sans, DejaVu Sans, sans-serif"';
  const rows: Array<{ text: string; size: number; fill: string; gap: number }> = [{ text: STUDIO_LINE, size: fit(STUDIO_LINE, Math.round(base * 0.6), maxW), fill: "#8a6a4a", gap: base * 0.9 }];
  for (const b of blocks) {
    rows.push({ text: b.main, size: fit(b.main, base, maxW), fill: "#5a3a22", gap: base * 0.55 });
    if (b.detail) rows.push({ text: b.detail, size: fit(b.detail, Math.round(base * 0.62), maxW), fill: "#7a5233", gap: base * 0.8 });
    else rows[rows.length - 1].gap = base * 0.8;
  }
  const height = rows.reduce((n, r, i) => n + r.size + (i < rows.length - 1 ? r.gap : 0), 0);
  const pad = base * 1.1;
  let y = h / 2 - height / 2;
  const text = rows
    .map((r) => {
      y += r.size;
      const line = `<text x="${w / 2}" y="${Math.round(y - r.size * 0.18)}" ${font} font-size="${r.size}" fill="${r.fill}" text-anchor="middle">${esc(r.text)}</text>`;
      y += r.gap;
      return line;
    })
    .join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<rect width="${w}" height="${h}" fill="#f3e6cf"/>
<rect x="${w * 0.08}" y="${Math.round(h / 2 - height / 2 - pad)}" width="${w * 0.84}" height="${Math.round(height + pad * 2)}" rx="24" fill="#efe2c6" stroke="#b0773a" stroke-width="3"/>
${text}
</svg>`;
}

/** A Japanese line needs a Japanese font on this machine, or librsvg draws boxes. */
function assertFonts(blocks: readonly CreditBlock[]): void {
  if (!blocks.some((b) => CJK.test(b.main + (b.detail ?? "")))) return;
  const ja = spawnSync("fc-list", [":lang=ja", "family"], { encoding: "utf8" }).stdout ?? "";
  if (!ja.trim()) throw new Error("the end card has Japanese but this machine has no Japanese font (install fonts-noto-cjk)");
}

/** The card as a PNG file next to `film`. */
export async function renderCard(file: string, aspect: Aspect, blocks: readonly CreditBlock[]): Promise<void> {
  assertFonts(blocks);
  writeFileSync(file, await sharp(Buffer.from(creditSvg(aspect, blocks))).png().toBuffer());
}

/** Duration (s) and stream facts of a film, from ffprobe. */
function probe(file: string): { w: number; h: number; fps: number; audio: boolean } {
  const v = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate", "-of", "csv=p=0", file], { encoding: "utf8" }).stdout.trim().split(",");
  const a = spawnSync("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", file], { encoding: "utf8" }).stdout.trim();
  const [num, den] = (v[2] ?? "12/1").split("/").map(Number);
  return { w: Number(v[0]), h: Number(v[1]), fps: Math.round(num / (den || 1)) || 12, audio: a.length > 0 };
}

/** Append the credit card (CREDIT_SECONDS, silent) to a film in place. */
export async function appendCredits(film: string, aspect: Aspect, blocks: readonly CreditBlock[]): Promise<void> {
  const card = `${film}.credits.png`;
  await renderCard(card, aspect, blocks);
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
  rmSync(card, { force: true });
  if (r.status !== 0) throw new Error(`appending the credits failed: ${r.stderr.slice(0, 400)}`);
  renameSync(tmp, film);
}

/** Every block a card can carry: for looking at the layout. */
export const SAMPLE_BLOCKS: CreditBlock[] = [{ main: VOICE_CREDIT.split("（")[0], detail: `（${VOICE_CREDIT.split("（")[1]}` }, VAIS_CREDIT, { main: NEMOTRON_LINE }, { main: TAVILY_LINE }];

async function main() {
  const out = process.argv[2] ?? "docs/hackathon/evidence/credits";
  mkdirSync(out, { recursive: true });
  for (const a of ["16:9", "9:16"] as const) {
    const f = `${out}/credits-all-blocks-${a.replace(":", "x")}.png`;
    await renderCard(f, a, SAMPLE_BLOCKS);
    console.log(`wrote ${f}`);
  }
}

if (process.argv[1]?.endsWith("credits.ts")) main();
