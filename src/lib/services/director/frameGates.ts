import sharp from "sharp";

/**
 * SPEC v2 WP4.2–4.3: measured broken-frame and near-duplicate gates. Like
 * D17, they measure the RENDER (never the markup), so groups and transforms
 * can't hide a problem, and every failure returns a measured repair hint.
 * Thresholds are calibrated on the v1 showcase frames (tests/frameGates.test.ts):
 * tea-house shot 3 (abstract blocks, no character) and shot 8 (a close-up
 * pasted over a brown rectangle) must fail; the good v1 frames must pass.
 */

export interface Block {
  /** bounding box in [0,1] frame coordinates */
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  /** share of the frame */
  readonly area: number;
  readonly color: string;
}

export interface FrameMeasure {
  /** flat, hard-edged, axis-aligned rectangles that are not full-width/height bands */
  readonly blocks: Block[];
  /** share of the frame covered by those blocks */
  readonly blockShare: number;
  /** share of pixels on a visible edge (detail) */
  readonly edgeDensity: number;
  /** number of distinct colour regions ≥ 0.05 % of the frame (shape count proxy) */
  readonly regions: number;
}

const GRID_W = 192;
const GRID_H = 108;

async function grid(png: Buffer): Promise<{ data: Buffer; w: number; h: number }> {
  const { data, info } = await sharp(png).flatten({ background: "#000000" }).resize(GRID_W, GRID_H, { fit: "fill", kernel: "nearest" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

/**
 * Colour regions of a render on a 192×108 grid (colours quantised to 4 bits
 * per channel, so JPEG noise and anti-aliasing don't split a flat area).
 */
export async function measureFrame(png: Buffer): Promise<FrameMeasure> {
  const { data, w, h } = await grid(png);
  const n = w * h;
  const key = new Int32Array(n);
  for (let i = 0; i < n; i++) key[i] = ((data[i * 3] >> 4) << 8) | ((data[i * 3 + 1] >> 4) << 4) | (data[i * 3 + 2] >> 4);
  // edges: luminance step to the right or below
  let edges = 0;
  const lum = (i: number) => 0.2126 * data[i * 3] + 0.7152 * data[i * 3 + 1] + 0.0722 * data[i * 3 + 2];
  for (let y = 0; y < h - 1; y++)
    for (let x = 0; x < w - 1; x++) {
      const i = y * w + x;
      if (Math.abs(lum(i) - lum(i + 1)) > 18 || Math.abs(lum(i) - lum(i + w)) > 18) edges++;
    }
  const seen = new Uint8Array(n);
  type Comp = { k: number; size: number; x0: number; y0: number; x1: number; y1: number; seed: number };
  const comps: Comp[] = [];
  let regions = 0;
  for (let s = 0; s < n; s++) {
    if (seen[s]) continue;
    const k = key[s];
    const c: Comp = { k, size: 0, x0: w, y0: h, x1: 0, y1: 0, seed: s };
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      c.size++;
      const x = p % w;
      const y = (p - x) / w;
      if (x < c.x0) c.x0 = x;
      if (x > c.x1) c.x1 = x;
      if (y < c.y0) c.y0 = y;
      if (y > c.y1) c.y1 = y;
      for (const q of [p - w, p + w, x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1]) {
        if (q >= 0 && q < n && !seen[q] && key[q] === k) {
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    if (c.size >= n * 0.0005) regions++;
    comps.push(c);
  }
  // A colour whose pieces together span the frame is a band split by occluders (ground behind posts)
  // or a repeated pattern (a row of columns, a forest): structure, not a stray block.
  const span = new Map<number, { x0: number; y0: number; x1: number; y1: number }>();
  for (const c of comps) {
    if (c.size < n * 0.002) continue;
    const u = span.get(c.k) ?? { x0: w, y0: h, x1: 0, y1: 0 };
    span.set(c.k, { x0: Math.min(u.x0, c.x0), y0: Math.min(u.y0, c.y0), x1: Math.max(u.x1, c.x1), y1: Math.max(u.y1, c.y1) });
  }
  const blocks: Block[] = [];
  for (const c of comps) {
    const bw = c.x1 - c.x0 + 1;
    const bh = c.y1 - c.y0 + 1;
    const area = c.size / n;
    const rect = c.size / (bw * bh);
    const u = span.get(c.k) ?? c;
    const band = u.x1 - u.x0 + 1 >= w * 0.92 || u.y1 - u.y0 + 1 >= h * 0.92;
    if (area >= 0.03 && rect >= 0.86 && !band) {
      const i = c.seed * 3;
      const hex = (v: number) => v.toString(16).padStart(2, "0");
      blocks.push({ x0: c.x0 / w, y0: c.y0 / h, x1: (c.x1 + 1) / w, y1: (c.y1 + 1) / h, area, color: `#${hex(data[i])}${hex(data[i + 1])}${hex(data[i + 2])}` });
    }
  }
  blocks.sort((a, b) => b.area - a.area);
  return { blocks, blockShare: blocks.reduce((t, b) => t + b.area, 0), edgeDensity: edges / n, regions };
}

/**
 * The blocks of `m` that the shot added itself: blocks that also appear (same
 * colour, ≥ 80 % box overlap) in `inherited` (a render of only the set
 * symbols the shot uses) belong to the Cast's set, which the Artist can't
 * edit, so they don't count against the shot. Sets are gated at cast time.
 */
export function withoutInherited(m: FrameMeasure, inherited: FrameMeasure): FrameMeasure & { inheritedShare: number } {
  const overlap = (a: Block, b: Block) => {
    const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
    const iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
    const inter = ix * iy;
    const union = (a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - inter;
    return union > 0 ? inter / union : 0;
  };
  const own = m.blocks.filter((b) => !inherited.blocks.some((h) => h.color === b.color && overlap(b, h) >= 0.8));
  const blockShare = own.reduce((t, b) => t + b.area, 0);
  return { ...m, blocks: own, blockShare, inheritedShare: m.blockShare - blockShare };
}

/** Thresholds (calibrated, see the test). */
export const GATE = {
  /** flat rectangles covering more than this share of the background = an unreadable set (v1: broken frames 0.11/0.28, good frames 0.00) */
  maxBlockShare: 0.08,
  /** below this edge density the frame shows almost nothing */
  minEdgeDensity: 0.03,
  minRegions: 12,
  /** consecutive frames at or above this similarity are near-duplicates (v1 tea-house 1→2 0.93, 4→5 0.90; distinct cuts ≤ 0.73) */
  maxSimilarity: 0.88,
  /** share of a kit figure's head (top 30%) hidden by what is drawn after it, and by at least 15 points more than its body (hosted run 4: kite over a face 0.27 vs body 0.00; a figure standing behind another 0.22 vs 0.26 = staging, not a hidden face; D42) */
  maxFaceCover: 0.2,
  /** a figure's visible box this close to a side of the frame is cut by it (rendered at 1K, sampled every 2 px) */
  edge: 0.002,
  /** night readability, on figures in a night or dark frame: mean luminance as rendered, and mean per-pixel contrast against what is behind them (v1 + v2 showcase night figures: lum ≥ 110, contrast ≥ 39) */
  nightFigureLum: 95,
  nightFigureContrast: 35,
  /** a frame darker than this is judged for night readability even when its words don't say night */
  darkFrame: 110,
} as const;

/** The plan marks a character leaving or entering the frame: an edge cut is allowed then (owner QC 2026-10-10). */
export const EXIT_ENTRY_WORDS = /\b(exits?|exiting|enters?|entering|leaves|leaving|walks? (?:out|off|away|in)|runs? (?:out|off|away|in)|steps? (?:in|out)|arrives?|arriving|comes? in|off[- ]?screen|(?:into|out of) (?:the )?frame)\b|ra khỏi|bước vào|đi vào|chạy vào|chạy ra|đi ra|rời đi|出て|入って|入る|去って|現れ|立ち去/i;
/** An over-the-shoulder shot frames the foreground character cut by the edge on purpose. */
export const OVER_SHOULDER = /over[- ]the[- ]shoulder|\bOTS\b|qua vai|từ vai|肩越し/i;

export type EdgeSide = "left" | "right" | "bottom";

/**
 * The frame edges a figure's visible box is cut by. The bottom counts only in
 * a wide shot (closer shots crop the legs on purpose); the top is the
 * head-cut gate's.
 */
export function edgeCuts(box: { x0: number; x1: number; y1: number }, wide: boolean): EdgeSide[] {
  const out: EdgeSide[] = [];
  if (box.x0 <= GATE.edge) out.push("left");
  if (box.x1 >= 1 - GATE.edge) out.push("right");
  if (wide && box.y1 >= 1 - GATE.edge) out.push("bottom");
  return out;
}

const pctOf = (v: number) => `${Math.round(v * 100)}%`;
const px = (v: number, size: number) => Math.round(v * size);

/** "Readable set": not dominated by a few unexplained flat rectangles. */
export function readableSetProblem(m: FrameMeasure, canvas: { w: number; h: number }): string | null {
  if (m.blockShare <= GATE.maxBlockShare) return null;
  const top = m.blocks.slice(0, 3).map((b) => `${b.color} ${px(b.x1 - b.x0, canvas.w)}×${px(b.y1 - b.y0, canvas.h)} at (${px(b.x0, canvas.w)},${px(b.y0, canvas.h)})`);
  return `${pctOf(m.blockShare)} of the frame is plain flat rectangles that read as nothing (${top.join("; ")}). Replace them with recognisable set pieces drawn from paths (walls with windows and texture, furniture, sky, ground) or remove them; a set reads as a place, not as blocks`;
}

/** "No empty frame": the render shows almost nothing. */
export function emptyFrameProblem(m: FrameMeasure): string | null {
  if (m.edgeDensity >= GATE.minEdgeDensity || m.regions >= GATE.minRegions) return null;
  return `the frame is nearly empty (edge density ${(m.edgeDensity * 100).toFixed(1)}%, ${m.regions} colour regions; a readable shot has ≥ ${GATE.minEdgeDensity * 100}% or ≥ ${GATE.minRegions}). Show the set and the characters the description names`;
}

export interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/**
 * "Close-up framing": the subject's head is in the upper band of the frame
 * and no hard-edged flat block sits behind the head (the subject looks pasted
 * onto a rectangle). `subject` is the character's visible box in [0,1].
 */
export function closeUpProblem(m: FrameMeasure, subject: Box, canvas: { w: number; h: number }): string | null {
  const head: Box = { x0: subject.x0, x1: subject.x1, y0: subject.y0, y1: subject.y0 + (subject.y1 - subject.y0) * 0.45 };
  if (subject.y0 > 0.35) return `in this close-up the subject's head starts ${pctOf(subject.y0)} down the frame: raise it so the head starts in the top third (y about ${px(0.06, canvas.h)})`;
  for (const b of m.blocks) {
    const ox = Math.min(head.x1, b.x1) - Math.max(head.x0, b.x0);
    const oy = Math.min(head.y1, b.y1) - Math.max(head.y0, b.y0);
    // a block that frames the head and is wider than the subject = the subject is pasted over a rectangle
    if (ox > 0 && oy > 0 && b.x1 - b.x0 > (subject.x1 - subject.x0) * 1.1 && b.area >= 0.06) {
      return `the close-up subject sits on a plain ${b.color} rectangle (${px(b.x1 - b.x0, canvas.w)}×${px(b.y1 - b.y0, canvas.h)}) that cuts behind the head: draw a real background behind them (blurred room, window, sky, wall with texture) that fills the frame`;
    }
  }
  return null;
}

/** 16×9 grey thumbnail used for the similarity gate. */
export async function thumb(png: Buffer): Promise<Buffer> {
  return sharp(png).flatten({ background: "#000000" }).resize(32, 18, { fit: "fill" }).greyscale().raw().toBuffer();
}

/**
 * Similarity in [0,1] of two thumbnails: 1 − normalised mean absolute
 * difference after removing each image's mean (so a lighting change alone
 * doesn't make two different compositions look the same, and vice versa).
 */
export function similarity(a: Buffer, b: Buffer): number {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let d = 0;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < n; i++) {
    d += Math.abs(a[i] - ma - (b[i] - mb));
    sa += Math.abs(a[i] - ma);
    sb += Math.abs(b[i] - mb);
  }
  const scale = Math.max(1, (sa + sb) / 2);
  return Math.max(0, Math.min(1, 1 - d / (2 * scale)));
}

export function nearDuplicateProblem(sim: number, otherIndex: number, shotType: string): string | null {
  if (sim < GATE.maxSimilarity) return null;
  const alt = /close/i.test(shotType) ? "a medium or wide shot from another side" : /wide|establish/i.test(shotType) ? "a close-up on a face or a hand-held object" : "a close-up, an over-the-shoulder, or a different corner of the set";
  return `this frame is ${pctOf(sim)} similar to shot ${otherIndex} (same composition). Change the camera so the cut is visible: ${alt}, different character placement, another part of the set`;
}

/**
 * How a figure reads against what is behind it (owner QC 2026-10-10, night
 * readability). The figure's pixels are where the render differs from the
 * same frame without it; `lum` is their mean luminance as rendered, `behind`
 * the mean luminance of the background at those same pixels, `contrast` the
 * mean per-pixel luminance difference between the two.
 */
export async function figureLight(withUse: Buffer, without: Buffer): Promise<{ lum: number; behind: number; contrast: number } | null> {
  const load = async (png: Buffer) => sharp(png).flatten({ background: "#000000" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const a = await load(withUse);
  const b = await load(without);
  const L = (d: Buffer, i: number) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  let n = 0;
  let lum = 0;
  let behind = 0;
  let contrast = 0;
  const { width: w, height: h } = a.info;
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 3;
      if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]) <= 30) continue;
      const la = L(a.data, i);
      const lb = L(b.data, i);
      n++;
      lum += la;
      behind += lb;
      contrast += Math.abs(la - lb);
    }
  }
  return n < 50 ? null : { lum: Math.round(lum / n), behind: Math.round(behind / n), contrast: Math.round(contrast / n) };
}
