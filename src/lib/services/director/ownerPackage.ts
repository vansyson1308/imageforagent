import { z } from "zod";

/**
 * The owner's narration package (owner decision 2026-10-10, section B).
 *
 * For every narrated film the Studio writes `<slug>/production.json` in the
 * schema of the owner's EP013 package (one scene per shot, lines with
 * tts_text / sub_text / sub_pages / pause_after) plus `reading_check.txt`
 * (expected katakana per line). The owner's AivisSpeech pipeline renders
 * `audio/<line id>.wav` + `audio/timings.json`, and the narration is fixed
 * BEFORE the Director runs: the lines are never rewritten, each shot is timed
 * to its real WAVs + pause_after.
 */

export const PAUSE_AFTER = 0.5;

export const VOICE = {
  phase1: "all lines read by the narrator voice",
  engine: "aivisspeech",
  speaker: "<NARRATOR_MODEL_ID>",
  speedScale: 0.9,
  pauseLengthScale: 1.3,
  intonationScale: 1.0,
  use_field: "tts_text",
} as const;

/** Credit line for end credits, README and Devpost (the owner asks for it although ACML 1.0 makes it optional). */
export const VOICE_CREDIT = "音声合成：AivisSpeech / morioki（ボイス提供：もりおき、モデル制作：yuki、ACML 1.0）";

const lineId = z.string().regex(/^S\d{2}_L\d{2}$/, 'Line ids look like "S01_L01"');

export const productionLineSchema = z.object({
  id: lineId,
  speaker: z.string().min(1),
  text: z.string().min(1).max(400),
  tts_text: z.string().min(1).max(400),
  sub_text: z.string().min(1).max(400),
  sub_pages: z.array(z.string().min(1)).min(1),
  pause_after: z.number().min(0).max(5),
});

export const productionSchema = z.object({
  voice: z.object({ engine: z.string(), use_field: z.string() }).passthrough(),
  scenes: z
    .array(z.object({ id: z.string().regex(/^S\d{2}$/), lines: z.array(productionLineSchema).min(1).max(4) }).passthrough())
    .min(1)
    .max(24),
}).passthrough();

export type Production = z.infer<typeof productionSchema>;
export type ProductionLine = z.infer<typeof productionLineSchema>;

export interface SourceScene {
  readonly setting?: string;
  readonly lines: ReadonlyArray<{ readonly text: string; readonly tts?: string }>;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Subtitle text: the line without its closing 。 (a quote keeps its 「」). */
export function subText(text: string): string {
  return text.trim().replace(/[。．]+$/u, "");
}

/** What the TTS reads: the line (or its reading override) without quote brackets. */
export function ttsText(text: string, override?: string): string {
  return (override ?? text).replace(/[「」『』]/g, "").trim();
}

/** Characters per subtitle row (the owner's EP013 layout). */
export const SUB_ROW_CHARS = 20;
/** Rows per subtitle page; a line that needs more becomes two pages. */
export const SUB_PAGE_ROWS = 2;
/** The row break inside a page (ASS/libass `\N`, as in EP013). */
export const SUB_BREAK = "\\N";

/** Rows of a subtitle: whole clauses (after 、 or 。) packed up to `width` characters; a longer clause is a row of its own. */
function rows(sub: string, width: number): string[] {
  const clauses = sub.match(/[^、。]+[、。]?/gu) ?? [sub];
  const out: string[] = [];
  let cur = "";
  for (const c of clauses) {
    if (cur && [...cur + c].length > width) {
      out.push(cur);
      cur = "";
    }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Subtitle pages, as in the owner's EP013: one page per line; two pages only
 * when the line needs more than two rows. Rows break after a 、 or 。 at about
 * 20 characters, joined inside a page with `\N`. A clause is never split.
 */
export function subPages(sub: string, width = SUB_ROW_CHARS): string[] {
  const r = rows(sub, width);
  if (r.length <= SUB_PAGE_ROWS) return [r.join(SUB_BREAK)];
  // two pages, split where the characters balance best
  let best = 1;
  let gap = Infinity;
  const len = (xs: string[]) => xs.reduce((n, x) => n + [...x].length, 0);
  for (let k = 1; k < r.length; k++) {
    const d = Math.abs(len(r.slice(0, k)) - len(r.slice(k)));
    if (d < gap) {
      gap = d;
      best = k;
    }
  }
  const pack = (xs: string[]) => rows(xs.join(""), width).join(SUB_BREAK);
  return [pack(r.slice(0, best)), pack(r.slice(best))];
}

/** production.json for a film: one scene per shot, every line read by the narrator. */
export function buildProduction(scenes: readonly SourceScene[], opts: { rowChars?: number } = {}): Production {
  return {
    voice: { ...VOICE },
    scenes: scenes.map((s, i) => ({
      id: `S${pad(i + 1)}`,
      lines: s.lines.map((l, j) => {
        const sub = subText(l.text);
        return { id: `S${pad(i + 1)}_L${pad(j + 1)}`, speaker: "narrator", text: l.text.trim(), tts_text: ttsText(l.text, l.tts), sub_text: sub, sub_pages: subPages(sub, opts.rowChars ?? SUB_ROW_CHARS), pause_after: PAUSE_AFTER };
      }),
    })),
  };
}

/** reading_check.txt: a header comment, then "S01_L01\t<text>\n\t<KANA>" per line. */
export function readingCheck(title: string, lines: ReadonlyArray<{ id: string; text: string; kana: string }>): string {
  return [`# reading_check · ${title} · expected katakana of tts_text per line (pyopenjtalk g2p, kana=True)`, ...lines.map((l) => `${l.id}\t${l.text}\n\t${l.kana}`)].join("\n") + "\n";
}

/** Morae of a katakana reading (small ャュョァィゥェォ join the previous mora; punctuation is not spoken). */
export function morae(kana: string): number {
  return [...kana].filter((c) => /[゠-ヿ]/u.test(c) && !/[ャュョァィゥェォヮ・]/u.test(c)).length;
}

/**
 * Estimated spoken length (s) of a line before the WAVs exist: 6 morae a
 * second (朗読 at speedScale 0.9), 0.35 s for each 、 (pauseLengthScale 1.3),
 * plus pause_after. A planning guide only: shots are timed to the real WAVs.
 */
export function estimateSeconds(kana: string, text: string, pauseAfter = PAUSE_AFTER): number {
  return morae(kana) / 6 + [...text].filter((c) => c === "、").length * 0.35 + pauseAfter;
}
