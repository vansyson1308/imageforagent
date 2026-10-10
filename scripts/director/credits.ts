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
 * ffmpeg appends it (`appendCredits`), argv arrays, never a shell: the film's
 * picture and sound fade out over its last 0.5 s, the card fades in over 0.3 s,
 * total = film + 3 s, re-encoded at x264 CRF 18 / medium (owner QC of #25).
 * A line that would shrink below its floor wraps onto two rows instead.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import sharp from "sharp";
import { STUDIO_LINE, VAIS_CREDIT, NEMOTRON_LINE, TAVILY_LINE, voiceCreditLine, type CreditBlock } from "@/lib/services/director/filmCredits";
import { VOICE_CREDIT } from "@/lib/services/director/ownerPackage";

export const CREDIT_SECONDS = 3;
/** The film fades out over its last FADE_OUT s (picture to the card's cream, sound to silence), then the card fades in over FADE_IN s. */
export const FADE_OUT = 0.5;
export const FADE_IN = 0.3;
/** Re-encode quality: the 2K showcase films keep their detail (owner QC of #25). */
export const CRF = 18;
const CREAM = "#f3e6cf";
type Aspect = "16:9" | "9:16";

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const CJK = /[\u3000-\u30ff\u3400-\u9fff\uff00-\uffef]/u;
/** Rough rendered width in em: CJK and full-width glyphs are 1 em, the rest about 0.56 em. */
export const ems = (t: string) => [...t].reduce((n, c) => n + (CJK.test(c) ? 1 : 0.56), 0);
/** The size that keeps a line inside `maxW` px, never above `size`. */
const fit = (t: string, size: number, maxW: number) => Math.min(size, Math.floor(maxW / Math.max(1, ems(t))));

/**
 * Type sizes per aspect (px on the 1080-wide side for 9:16): the base a line starts at, and the
 * floor below which a line is wrapped onto two rows instead of shrunk (owner QC of #25).
 */
export const CARD_TYPE = {
  "16:9": { width: 1920, height: 1080, main: 48, detail: 30, studio: 29, mainFloor: 36, detailFloor: 26 },
  "9:16": { width: 1080, height: 1920, main: 56, detail: 35, studio: 32, mainFloor: 40, detailFloor: 30 },
} as const;
/** Text stays inside this share of the card width. */
export const TEXT_WIDTH = 0.76;

/**
 * Two rows for a line that would otherwise go below its floor: the break nearest the middle,
 * at a space, or (Japanese) after 、 or ：. A line with no such place breaks at its middle.
 */
export function wrapTwo(text: string): [string, string] {
  const chars = [...text];
  const total = ems(text);
  let best = -1;
  let gap = Infinity;
  for (let i = 1; i < chars.length - 1; i++) {
    const c = chars[i];
    const cut = c === " " ? i : c === "、" || c === "：" ? i + 1 : -1;
    if (cut < 0) continue;
    const d = Math.abs(ems(chars.slice(0, cut).join("")) - total / 2);
    if (d < gap) {
      gap = d;
      best = cut;
    }
  }
  if (best < 0) best = Math.ceil(chars.length / 2);
  return [chars.slice(0, best).join("").trimEnd(), chars.slice(best).join("").trimStart()];
}

/** The rows one line becomes: itself at the largest size that fits, or two rows when that size is below the floor. */
export function layoutLine(text: string, base: number, floor: number, maxW: number): Array<{ text: string; size: number }> {
  const one = fit(text, base, maxW);
  if (one >= floor) return [{ text, size: one }];
  const two = wrapTwo(text);
  const size = Math.max(floor, Math.min(...two.map((t) => fit(t, base, maxW))));
  return two.map((t) => ({ text: t, size }));
}

/** The owner's credit file for a package directory (qa/voice_credit.txt), when there is one. */
export function readVoiceCredit(pkgDir: string): string | null {
  const f = `${pkgDir}/qa/voice_credit.txt`;
  return existsSync(f) ? voiceCreditLine(readFileSync(f, "utf8")) : null;
}

/** Every text row of the card, top to bottom, with its size and the space after it. */
export function cardRows(aspect: Aspect, blocks: readonly CreditBlock[]): Array<{ text: string; size: number; fill: string; gap: number }> {
  const T = CARD_TYPE[aspect];
  const maxW = T.width * TEXT_WIDTH;
  const rows: Array<{ text: string; size: number; fill: string; gap: number }> = [];
  const add = (parts: Array<{ text: string; size: number }>, fill: string, after: number) =>
    parts.forEach((p, i) => rows.push({ ...p, fill, gap: i < parts.length - 1 ? p.size * 0.28 : after }));
  add(layoutLine(STUDIO_LINE, T.studio, T.detailFloor, maxW), "#8a6a4a", T.main * 0.9);
  for (const b of blocks) {
    add(layoutLine(b.main, T.main, T.mainFloor, maxW), "#5a3a22", b.detail ? T.main * 0.5 : T.main * 0.8);
    if (b.detail) add(layoutLine(b.detail, T.detail, T.detailFloor, maxW), "#7a5233", T.main * 0.8);
  }
  return rows;
}

/** The card as SVG: warm cream, the studio name, then each block (main line + smaller detail), centred. */
export function creditSvg(aspect: Aspect, blocks: readonly CreditBlock[]): string {
  const T = CARD_TYPE[aspect];
  const [w, h] = [T.width, T.height];
  const font = 'font-family="Noto Sans CJK JP, Noto Sans JP, Noto Sans, DejaVu Sans, sans-serif"';
  const rows = cardRows(aspect, blocks);
  const height = rows.reduce((n, r, i) => n + r.size + (i < rows.length - 1 ? r.gap : 0), 0);
  const pad = T.main * 1.1;
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
<rect width="${w}" height="${h}" fill="${CREAM}"/>
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

export interface FilmProbe {
  readonly w: number;
  readonly h: number;
  readonly fps: number;
  readonly audio: boolean;
  /** Duration of the film (s), from the container. */
  readonly dur: number;
}

/** Size, frame rate, audio and duration of a film, from ffprobe. */
export function probe(file: string): FilmProbe {
  const v = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate", "-of", "csv=p=0", file], { encoding: "utf8" }).stdout.trim().split(",");
  const a = spawnSync("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", file], { encoding: "utf8" }).stdout.trim();
  const d = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }).stdout.trim();
  const [num, den] = (v[2] ?? "12/1").split("/").map(Number);
  return { w: Number(v[0]), h: Number(v[1]), fps: Math.round(num / (den || 1)) || 12, audio: a.length > 0, dur: Number(d) || 0 };
}

/**
 * The ffmpeg filter graph: the film trimmed to its own length with picture and sound fading out over
 * its last FADE_OUT s, then the card (CREDIT_SECONDS, silent) fading in from the same cream over
 * FADE_IN s. Inputs: 0 = film, 1 = looped card, 2 = silence (when the film has sound).
 */
export function creditFilter(p: FilmProbe): string {
  const out = Math.max(0, p.dur - FADE_OUT).toFixed(3);
  const dur = p.dur.toFixed(3);
  const card = `scale=${p.w}:${p.h}:force_original_aspect_ratio=decrease,pad=${p.w}:${p.h}:(ow-iw)/2:(oh-ih)/2:color=${CREAM},setsar=1,fps=${p.fps},format=yuv420p,fade=t=in:st=0:d=${FADE_IN}:color=${CREAM}`;
  const film = `trim=duration=${dur},setpts=PTS-STARTPTS,setsar=1,fps=${p.fps},format=yuv420p,fade=t=out:st=${out}:d=${FADE_OUT}:color=${CREAM}`;
  return p.audio
    ? `[0:v]${film}[a0];[1:v]${card}[c];[0:a]atrim=duration=${dur},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,apad=whole_dur=${dur},afade=t=out:st=${out}:d=${FADE_OUT}[s0];[2:a]aformat=channel_layouts=stereo[s1];[a0][s0][c][s1]concat=n=2:v=1:a=1[v][a]`
    : `[0:v]${film}[a0];[1:v]${card}[c];[a0][c]concat=n=2:v=1:a=0[v]`;
}

/** Append the credit card to a film in place: total = film + CREDIT_SECONDS. */
export async function appendCredits(film: string, aspect: Aspect, blocks: readonly CreditBlock[]): Promise<void> {
  const card = `${film}.credits.png`;
  await renderCard(card, aspect, blocks);
  const p = probe(film);
  const tmp = `${film}.credits.mp4`;
  const enc = ["-c:v", "libx264", "-preset", "medium", "-crf", String(CRF), "-pix_fmt", "yuv420p"];
  const args = p.audio
    ? ["-loglevel", "error", "-y", "-i", film, "-loop", "1", "-t", String(CREDIT_SECONDS), "-i", card, "-f", "lavfi", "-t", String(CREDIT_SECONDS), "-i", "anullsrc=r=48000:cl=stereo",
       "-filter_complex", creditFilter(p), "-map", "[v]", "-map", "[a]", ...enc, "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", tmp]
    : ["-loglevel", "error", "-y", "-i", film, "-loop", "1", "-t", String(CREDIT_SECONDS), "-i", card,
       "-filter_complex", creditFilter(p), "-map", "[v]", ...enc, "-movflags", "+faststart", tmp];
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
