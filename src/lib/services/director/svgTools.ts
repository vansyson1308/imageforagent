import sharp from "sharp";

/**
 * Deterministic handling of LLM-written SVG before it reaches the engine's
 * own validators. The mechanical clean-up is limited to: strip markdown
 * fences, XML comments and a single wrapping <svg> root. Every safety
 * decision stays with sanitizeSvg, which runs AFTER this module.
 */

/** Pull the SVG fragment out of a reply (```svg fence, bare markup, or a stray <svg> wrapper). */
export function extractSvgFragment(text: string): string {
  const fence = text.match(/```(?:svg|xml|html)?\s*\n([\s\S]*?)```/i);
  let s = fence ? fence[1] : text;
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<\?xml[^>]*\?>/gi, "");
  const root = s.match(/<svg\b[^>]*>([\s\S]*)<\/svg>/i);
  if (root) s = root[1];
  const a = s.indexOf("<");
  const b = s.lastIndexOf(">");
  return a >= 0 && b > a ? s.slice(a, b + 1).trim() : "";
}

/** The ```json block that follows the svg block in a motion-shot reply, if any. */
export function extractJsonBlock(text: string): unknown | null {
  const m = text.match(/```json\s*\n([\s\S]*?)```/i);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch (e) {
    // The two slips real replies make: trailing commas and // line comments. Anything else stays an error.
    const lenient = m[1].replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1");
    try {
      return JSON.parse(lenient);
    } catch {
      throw e;
    }
  }
}

/** Ids declared in a fragment. */
export function declaredIds(svg: string): Set<string> {
  return new Set([...svg.matchAll(/\bid\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]));
}

/** Ids of top-level <symbol>s in a defs library. */
export function symbolIds(defs: string): string[] {
  return [...defs.matchAll(/<symbol\b[^>]*\bid\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]);
}

/**
 * Local references (#id / url(#id)) that resolve nowhere. librsvg silently
 * draws nothing for them, so the Artist would never see the mistake.
 */
export function missingRefs(svg: string, available: ReadonlySet<string>): string[] {
  const local = declaredIds(svg);
  const refs = new Set<string>();
  for (const m of svg.matchAll(/\b(?:xlink:)?href\s*=\s*["']#([^"']+)["']/g)) refs.add(m[1]);
  for (const m of svg.matchAll(/url\(\s*["']?#([^"')\s]+)["']?\s*\)/g)) refs.add(m[1]);
  return [...refs].filter((id) => !local.has(id) && !available.has(id)).sort();
}

/** true when the render is (almost) one flat colour, i.e. the drawing failed silently. */
export async function isNearlyBlank(png: Buffer): Promise<boolean> {
  const stats = await sharp(png).stats();
  return stats.channels.slice(0, 3).every((c) => c.stdev < 4);
}

/** PNG → downscaled JPEG data URI (the image budget sent to the vision critic). */
export async function toJpegDataUri(png: Buffer, longEdge = 1024): Promise<{ uri: string; jpeg: Buffer }> {
  const jpeg = await sharp(png).resize({ width: longEdge, height: longEdge, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  return { uri: `data:image/jpeg;base64,${jpeg.toString("base64")}`, jpeg };
}

/** Grid of every library symbol on one canvas (cast sheet: validates rendering + shown in the UI). */
export function castSheetFrame(ids: readonly string[], canvas: { w: number; h: number }, background = "#20243a"): string {
  const n = Math.max(1, ids.length);
  const cols = Math.min(4, n);
  const rows = Math.ceil(n / cols);
  const cw = canvas.w / cols;
  const ch = canvas.h / rows;
  const cells = ids.map((id, i) => {
    const x = (i % cols) * cw;
    const y = Math.floor(i / cols) * ch;
    return `<use href="#${id}" x="${Math.round(x + cw * 0.1)}" y="${Math.round(y + ch * 0.08)}" width="${Math.round(cw * 0.8)}" height="${Math.round(ch * 0.84)}"/>`;
  });
  return `<rect width="${canvas.w}" height="${canvas.h}" fill="${background}"/>\n${cells.join("\n")}`;
}

/**
 * Measurable composition facts for the TEXT critic (it cannot see the image):
 * how big each placed library symbol is relative to the canvas, and how bright
 * the render actually is. It turns "is the hero readable / is it night?" into numbers.
 */
export async function compositionStats(svg: string, png: Buffer, canvas: { w: number; h: number }): Promise<string> {
  const uses: string[] = [];
  for (const m of svg.matchAll(/<use\b([^>]*)>/g)) {
    const attr = (k: string) => Number(m[1].match(new RegExp(`\\b${k}\\s*=\\s*["']?(-?[\\d.]+)`))?.[1] ?? NaN);
    const id = m[1].match(/href\s*=\s*["']#([^"']+)/)?.[1];
    const h = attr("height");
    const w = attr("width");
    if (!id || !Number.isFinite(h)) continue;
    const x = Number.isFinite(attr("x")) ? attr("x") : 0;
    const y = Number.isFinite(attr("y")) ? attr("y") : 0;
    const full = Number.isFinite(w) && w >= canvas.w * 0.9 && h >= canvas.h * 0.9;
    uses.push(full ? `#${id} = full background` : `#${id} ${Math.round((h / canvas.h) * 100)}% of frame height, centre ${Math.round(((x + (w || 0) / 2) / canvas.w) * 100)}% across, feet ${Math.round(((y + h) / canvas.h) * 100)}% down (80–100% = standing on the ground, normal)`);
  }
  const stats = await sharp(png).stats();
  const lum = Math.round(0.2126 * stats.channels[0].mean + 0.7152 * stats.channels[1].mean + 0.0722 * stats.channels[2].mean);
  const contrast = Math.round((stats.channels[0].stdev + stats.channels[1].stdev + stats.channels[2].stdev) / 3);
  return [`placed symbols: ${uses.join("; ") || "none"}`, `mean brightness ${lum}/255 (${lum < 70 ? "dark/night" : lum < 140 ? "dim/dusk" : "bright/day"}), contrast ${contrast}`].join(". ");
}

const SHAPE_TAGS = /<(path|rect|circle|ellipse|polygon|polyline|line)\b/g;

/** Per-symbol viewBox size and drawn-shape count (quality gate for the cast library). */
export function symbolInfo(defs: string): Map<string, { w: number; h: number; shapes: number }> {
  const out = new Map<string, { w: number; h: number; shapes: number }>();
  for (const m of defs.matchAll(/<symbol\b([^>]*)>([\s\S]*?)<\/symbol>/g)) {
    const id = m[1].match(/\bid\s*=\s*["']([^"']+)/)?.[1];
    const vb = m[1].match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/);
    if (!id || !vb) continue;
    out.set(id, { w: Number(vb[1]), h: Number(vb[2]), shapes: (m[2].match(SHAPE_TAGS) ?? []).length });
  }
  return out;
}

/** Largest placed height (% of canvas) per referenced symbol id. */
export function placedHeights(svg: string, canvasH: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of svg.matchAll(/<use\b([^>]*)>/g)) {
    const id = m[1].match(/href\s*=\s*["']#([^"']+)/)?.[1];
    const h = Number(m[1].match(/\bheight\s*=\s*["']?([\d.]+)/)?.[1] ?? NaN);
    if (!id) continue;
    const pct = Number.isFinite(h) ? Math.round((h / canvasH) * 100) : 0;
    out.set(id, Math.max(out.get(id) ?? 0, pct));
  }
  return out;
}

/** Minimum height (% of canvas) of the largest character, by storyboard shot type. */
export function minSubjectPct(shotType: string): number {
  const s = shotType.toLowerCase();
  if (/close|cận|insert|detail|chi tiết/.test(s)) return 75;
  if (/medium|trung|waist|two[- ]shot|over[- ]the/.test(s)) return 45;
  if (/wide|establish|toàn|long|rộng|aerial|bird/.test(s)) return 25;
  return 30;
}

// ---------- Pixel-measured quality gates (robust to transforms / nesting) ----------

async function rgba(png: Buffer): Promise<{ data: Buffer; w: number; h: number }> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

/** Share (0..1) of fully transparent pixels in a render: a set symbol must cover its frame. */
export async function transparentShare(png: Buffer): Promise<number> {
  const { data, w, h } = await rgba(png);
  let clear = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 16) clear++;
  return clear / (w * h);
}

/** Remove every <use> of a symbol (and of its posed variants "id--pose-expr") from a fragment. */
export function withoutUses(svg: string, id: string): string {
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return svg.replace(new RegExp(`<use\\b[^>]*href\\s*=\\s*["']#${esc}(?:--[a-z0-9_-]+)?["'][^>]*?(/>|>\\s*</use>|>)`, "g"), "");
}

/**
 * The fragment cut right after the first `<use>` of `id` (or a posed variant),
 * with the elements still open at that point closed again: the frame as it
 * stands when the character is drawn, before anything painted over it.
 * Null when the character is not placed.
 */
export function upToUse(svg: string, id: string): string | null {
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`<use\\b[^>]*href\\s*=\\s*["']#${esc}(?:--[a-z0-9_-]+)?["'][^>]*?(/>|>\\s*</use>|>)`).exec(svg);
  if (!m) return null;
  const prefix = svg.slice(0, m.index + m[0].length);
  const open: string[] = [];
  for (const t of prefix.matchAll(/<(\/?)([a-zA-Z][\w:-]*)\b[^>]*?(\/?)>/g)) {
    if (t[3] === "/") continue;
    if (t[1]) {
      const at = open.lastIndexOf(t[2]);
      if (at >= 0) open.length = at;
    } else open.push(t[2]);
  }
  // a bare `<use …>` left open by the match itself is closed like any other
  return prefix + open.reverse().map((n) => `</${n}>`).join("");
}

export interface Placement {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * The first `<use>` of `id` (or a posed variant) placed plainly: at the top
 * level of the fragment (inside no element), no transform, numeric x, y,
 * width and height. Null otherwise (the engine then leaves framing to the
 * Artist: it never guesses through a transform).
 */
export function plainPlacement(svg: string, id: string): (Placement & { tag: string; at: number }) | null {
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`<use\\b[^>]*href\\s*=\\s*["']#${esc}(?:--[a-z0-9_-]+)?["'][^>]*?/?>`).exec(svg);
  if (!m || /\btransform\s*=/.test(m[0])) return null;
  let depth = 0;
  for (const t of svg.slice(0, m.index).matchAll(/<(\/?)([a-zA-Z][\w:-]*)\b[^>]*?(\/?)>/g)) {
    if (t[3] === "/") continue;
    depth += t[1] ? -1 : 1;
  }
  if (depth !== 0) return null;
  const num = (a: string) => {
    const v = m[0].match(new RegExp(`\\s${a}\\s*=\\s*["']?(-?[\\d.]+)["']?`))?.[1];
    return v === undefined ? NaN : Number(v);
  };
  const p = { x: num("x"), y: num("y"), w: num("width"), h: num("height") };
  if (![p.x, p.y, p.w, p.h].every(Number.isFinite) || p.w <= 0 || p.h <= 0) return null;
  return { ...p, tag: m[0], at: m.index };
}

/**
 * Where to put a figure so the shot's framing holds, from where it is and
 * what it measured (`visible`, its rendered box in [0,1]). A close-up puts
 * the head 6% below the top and lets the canvas crop the legs; other shots
 * grow the figure (never shrink it) to the required share of the frame
 * height, feet where they were unless that pushes the head out of frame.
 * The horizontal centre is kept.
 */
export function reframePlacement(p: Placement, visible: { y0: number; y1: number }, canvas: { w: number; h: number }, target: { closeUp: boolean; minPct: number }): Placement {
  const H = canvas.h;
  const topFrac = Math.min(0.3, Math.max(0, (visible.y0 * H - p.y) / p.h));
  const bottomCropped = visible.y1 >= 0.99;
  const figureFrac = bottomCropped ? 1 - topFrac : Math.min(1 - topFrac, ((visible.y1 - visible.y0) * H) / p.h);
  let h: number;
  let y: number;
  if (target.closeUp) {
    h = Math.max(p.h, H * 1.35);
    y = H * 0.06 - topFrac * h;
  } else {
    h = Math.max(p.h, ((target.minPct / 100) * 1.08 * H) / Math.max(0.3, figureFrac));
    y = p.y + p.h - h;
    if (y + topFrac * h < H * 0.03) y = H * 0.03 - topFrac * h;
  }
  const w = (h * p.w) / p.h;
  const x = Math.min(canvas.w - 0.8 * w, Math.max(-0.2 * w, p.x + p.w / 2 - w / 2));
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

/** Element nesting depth at `index` of a fragment (0 = top level). */
function depthAt(svg: string, index: number): number {
  let depth = 0;
  for (const t of svg.slice(0, index).matchAll(/<(\/?)([a-zA-Z][\w:-]*)\b[^>]*?(\/?)>/g)) {
    if (t[3] === "/") continue;
    depth += t[1] ? -1 : 1;
  }
  return depth;
}

/**
 * Night readability fix (owner QC 2026-10-10): a translucent full-canvas tint
 * drawn AFTER the characters darkens them with the set. Moves every such
 * top-level tint to just before the first character, so it darkens the set
 * only. Null when there is nothing to move.
 */
export function tintUnderFigures(svg: string, characters: readonly string[], canvas: { w: number; h: number }): { svg: string; note: string } | null {
  if (!characters.length) return null;
  const ids = characters.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const first = new RegExp(`<use\\b[^>]*href\\s*=\\s*["']#(?:${ids})(?:--[a-z0-9_-]+)?["']`).exec(svg);
  if (!first || depthAt(svg, first.index) !== 0) return null;
  const num = (tag: string, a: string) => {
    const v = tag.match(new RegExp(`\\s${a}\\s*=\\s*["']?(-?[\\d.]+)(%?)["']?`));
    return v ? (v[2] ? (Number(v[1]) / 100) * (a === "height" || a === "y" ? canvas.h : canvas.w) : Number(v[1])) : a === "x" || a === "y" ? 0 : NaN;
  };
  const tints = [...svg.matchAll(/<rect\b[^>]*\/>/g)].filter((m) => {
    if (m.index! < first.index || depthAt(svg, m.index!) !== 0) return false;
    const op = Number(m[0].match(/\s(?:fill-)?opacity\s*=\s*["']?([\d.]+)/)?.[1] ?? 1);
    return op < 1 && num(m[0], "width") >= canvas.w * 0.95 && num(m[0], "height") >= canvas.h * 0.95 && Math.abs(num(m[0], "x")) <= canvas.w * 0.05 && Math.abs(num(m[0], "y")) <= canvas.h * 0.05;
  });
  if (!tints.length) return null;
  let rest = svg;
  for (const t of [...tints].reverse()) rest = rest.slice(0, t.index!) + rest.slice(t.index! + t[0].length);
  return { svg: rest.slice(0, first.index) + tints.map((t) => t[0]).join("") + rest.slice(first.index), note: `${tints.length} full-frame tint(s) moved under the characters (they darkened the figures too)` };
}

/** The fragment with that `<use>`'s x, y, width and height replaced. */
export function applyPlacement(svg: string, placed: { tag: string; at: number }, to: Placement): string {
  const set = (tag: string, a: string, v: number) => tag.replace(new RegExp(`(\\s${a}\\s*=\\s*)(["']?)-?[\\d.]+\\2`), `$1"${v}"`);
  const tag = set(set(set(set(placed.tag, "x", to.x), "y", to.y), "width", to.w), "height", to.h);
  return svg.slice(0, placed.at) + tag + svg.slice(placed.at + placed.tag.length);
}

/**
 * How much of a character is hidden by what is drawn after it. `alone` is the
 * frame up to the character, `beneath` the same without it, `full` the whole
 * frame. The character's pixels are where `alone` differs from `beneath`; a
 * pixel is covered where `full` differs from `alone`. Measured separately on
 * the head (top 30% of the character) and the rest, so a tint laid over the
 * whole frame (which covers both alike) is told apart from a prop on a face.
 */
export async function coveredShare(full: Buffer, alone: Buffer, beneath: Buffer): Promise<{ head: number; rest: number } | null> {
  const f = await rgba(full);
  const a = await rgba(alone);
  const b = await rgba(beneath);
  const diff = (p: Buffer, q: Buffer, i: number) => Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]);
  let y0 = -1;
  let y1 = -1;
  for (let y = 0; y < a.h; y += 2) {
    for (let x = 0; x < a.w; x += 2) {
      if (diff(a.data, b.data, (y * a.w + x) * 4) > 30) {
        if (y0 < 0) y0 = y;
        y1 = y;
        break;
      }
    }
  }
  if (y0 < 0 || y1 - y0 < 8) return null;
  const headEnd = y0 + (y1 - y0) * 0.3;
  const n = { head: 0, rest: 0 };
  const hid = { head: 0, rest: 0 };
  for (let y = y0; y <= y1; y += 2) {
    const band = y < headEnd ? "head" : "rest";
    for (let x = 0; x < a.w; x += 2) {
      const i = (y * a.w + x) * 4;
      if (diff(a.data, b.data, i) <= 30) continue;
      n[band]++;
      if (diff(f.data, a.data, i) > 30) hid[band]++;
    }
  }
  return { head: n.head ? hid.head / n.head : 0, rest: n.rest ? hid.rest / n.rest : 0 };
}

/** Share of the frame's pixels that `withUse` changes over `without` (what an element visibly adds, 0..1). */
export async function visibleArea(withUse: Buffer, without: Buffer): Promise<number> {
  const a = await rgba(withUse);
  const b = await rgba(without);
  let n = 0;
  let total = 0;
  for (let y = 0; y < a.h; y += 2) {
    for (let x = 0; x < a.w; x += 2) {
      const i = (y * a.w + x) * 4;
      total++;
      if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]) > 30) n++;
    }
  }
  return total ? n / total : 0;
}

/**
 * Minimum visible area of a planned prop, as a share of the frame, by shot
 * type (owner QC 2026-10-10: hero props story-sized). An insert of the prop
 * must be big; in a wide shot it still has to be findable.
 */
export function minPropArea(shotType: string): number {
  const s = shotType.toLowerCase();
  if (/insert|detail|chi tiết|extreme close|macro|インサート/.test(s)) return 0.04;
  if (/close|cận|アップ|クローズ/.test(s)) return 0.012;
  if (/medium|trung|waist|two[- ]shot|over[- ]the|ミディアム|バスト/.test(s)) return 0.004;
  if (/wide|establish|toàn|long|rộng|aerial|bird|ロング|全景/.test(s)) return 0.0015;
  return 0.003;
}

/**
 * Visible height (% of frame) of what `withUse` adds over `without`: the
 * vertical extent of pixels that differ. Measures the character as the viewer
 * sees it, whatever transforms, groups or cropping are involved.
 */
export async function visibleHeightPct(withUse: Buffer, without: Buffer): Promise<number> {
  return (await visibleExtent(withUse, without)).pct;
}

/** Vertical extent of what `withUse` adds over `without`: % of frame height, and whether it touches the top edge. */
export async function visibleExtent(withUse: Buffer, without: Buffer): Promise<{ pct: number; touchesTop: boolean }> {
  const a = await rgba(withUse);
  const b = await rgba(without);
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < a.h; y++) {
    const row = y * a.w * 4;
    for (let x = 0; x < a.w; x++) {
      const i = row + x * 4;
      if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]) > 30) {
        if (top < 0) top = y;
        bottom = y;
        break;
      }
    }
  }
  return top < 0 ? { pct: 0, touchesTop: false } : { pct: Math.round(((bottom - top + 1) / a.h) * 100), touchesTop: top <= 1 };
}

/** Bounding box (in [0,1] of the frame) of what `withUse` adds over `without`, or null when nothing differs. */
export async function visibleBox(withUse: Buffer, without: Buffer): Promise<{ x0: number; y0: number; x1: number; y1: number } | null> {
  const a = await rgba(withUse);
  const b = await rgba(without);
  let x0 = a.w;
  let y0 = a.h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < a.h; y += 2) {
    const row = y * a.w * 4;
    for (let x = 0; x < a.w; x += 2) {
      const i = row + x * 4;
      if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]) > 30) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0: x0 / a.w, y0: y0 / a.h, x1: (x1 + 1) / a.w, y1: (y1 + 1) / a.h };
}

/** Mean perceived brightness (0..255) of a render. */
export async function meanBrightness(png: Buffer): Promise<number> {
  const s = await sharp(png).stats();
  return Math.round(0.2126 * s.channels[0].mean + 0.7152 * s.channels[1].mean + 0.0722 * s.channels[2].mean);
}

export { NIGHT_WORDS } from "@/lib/services/director/fidelity";

// ---------- Library surgery (per-symbol accept / repair) ----------

const DEF_TAGS = "linearGradient|radialGradient|clipPath|pattern|mask|filter";

/** Split a defs library into its <symbol>s and top-level paint servers (gradients, clip paths), by id. */
export function splitLibrary(defs: string): { symbols: Map<string, string>; extras: Map<string, string> } {
  const symbols = new Map<string, string>();
  const extras = new Map<string, string>();
  const rest = defs.replace(/<symbol\b[^>]*>[\s\S]*?<\/symbol>/g, (m) => {
    const id = m.match(/^<symbol\b[^>]*\bid\s*=\s*["']([^"']+)/)?.[1];
    if (id && !symbols.has(id)) symbols.set(id, m);
    return "";
  });
  const re = new RegExp(`<(${DEF_TAGS})\\b[^>]*?(?:/>|>[\\s\\S]*?</\\1>)`, "g");
  for (const m of rest.matchAll(re)) {
    const id = m[0].match(/\bid\s*=\s*["']([^"']+)/)?.[1];
    if (id && !extras.has(id)) extras.set(id, m[0]);
  }
  return { symbols, extras };
}

/** The paint servers a symbol references (transitively through gradient hrefs). */
export function neededExtras(symbol: string, extras: ReadonlyMap<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  const queue = [symbol];
  while (queue.length) {
    const s = queue.pop()!;
    for (const id of missingRefs(s, new Set())) {
      const def = extras.get(id);
      if (def && !out.has(id)) {
        out.set(id, def);
        queue.push(def);
      }
    }
  }
  return out;
}

/**
 * Deterministic set normalisation (last resort, never on a first attempt):
 * `slice` makes any viewBox cover the frame, and a backing rect in the set's
 * first colour fills whatever the drawing left transparent.
 */
export function normalizeSet(symbol: string, backing: string): string {
  const head = symbol.match(/^<symbol\b[^>]*>/)?.[0];
  if (!head) return symbol;
  const vb = head.match(/viewBox\s*=\s*["']\s*([-\d.]+)[\s,]+([-\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  let open = /preserveAspectRatio\s*=/.test(head) ? head.replace(/preserveAspectRatio\s*=\s*["'][^"']*["']/, 'preserveAspectRatio="xMidYMid slice"') : head.replace(/>$/, ' preserveAspectRatio="xMidYMid slice">');
  if (open.endsWith("/>")) open = open.slice(0, -2) + ">";
  const rect = vb ? `<rect x="${vb[1]}" y="${vb[2]}" width="${vb[3]}" height="${vb[4]}" fill="${backing}"/>` : "";
  return open + rect + symbol.slice(head.length);
}

/**
 * Separate opaque pieces in a render (alpha > 40, 4-connected, on a ≤ 160 px
 * grid): sizes as shares of the opaque area, largest first. A drawn
 * character whose head floats off its body shows up as two big pieces.
 */
export async function opaquePieces(png: Buffer): Promise<number[]> {
  const { data, info } = await sharp(png).ensureAlpha().extractChannel(3).resize({ width: 160, height: 160, fit: "inside" }).raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const seen = new Uint8Array(w * h);
  const sizes: number[] = [];
  let total = 0;
  for (let i = 0; i < w * h; i++) {
    if (seen[i] || data[i] <= 40) continue;
    let size = 0;
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      size++;
      const x = p % w;
      for (const q of [p - w, p + w, x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1]) {
        if (q >= 0 && q < w * h && !seen[q] && data[q] > 40) {
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    sizes.push(size);
    total += size;
  }
  return sizes.sort((a, b) => b - a).map((s) => s / Math.max(1, total));
}

const PAINT_RE = /\b(fill|stroke|stop-color|flood-color|lighting-color)\s*(?:=\s*(["'])([^"']*)\2|:\s*([^;"'}<>]+))/gi;

function isBadPaint(v: string): boolean {
  if (/^url/i.test(v)) return !/^url\(\s*#[A-Za-z_][\w.:-]*\s*\)(\s+[#\w(),.%\s-]+)?$/.test(v);
  return v.includes("(") && !/^(rgba?|hsla?)\(\s*[\d.%\s,/-]+\)$/i.test(v);
}

/**
 * Paint values librsvg can't resolve (hosted run 2: `fill="url://beach-skyGrad)"`,
 * a mangled url()) silently paint BLACK: the whole beach set rendered black and
 * no gate noticed. Returns the distinct bad values.
 */
export function badPaints(svg: string): string[] {
  const out = new Set<string>();
  for (const m of svg.matchAll(PAINT_RE)) {
    const v = (m[3] ?? m[4] ?? "").trim();
    if (v && isBadPaint(v)) out.add(v);
  }
  return [...out];
}

/** Replace every unresolvable paint with a plain colour (last-resort repair of a kept symbol). */
export function fixPaints(svg: string, color: string): string {
  return svg.replace(PAINT_RE, (all, prop: string, q: string | undefined, a: string | undefined, b: string | undefined) => {
    const v = (a ?? b ?? "").trim();
    if (!v || !isBadPaint(v)) return all;
    return q ? `${prop}=${q}${color}${q}` : `${prop}:${color}`;
  });
}
