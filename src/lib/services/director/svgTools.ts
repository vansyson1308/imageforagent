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
  return JSON.parse(m[1]);
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
    uses.push(full ? `#${id} = full background` : `#${id} ${Math.round((h / canvas.h) * 100)}% of frame height at (${Math.round(((x + (w || 0) / 2) / canvas.w) * 100)}%, ${Math.round(((y + h) / canvas.h) * 100)}%)`);
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
  if (/close|cận|insert|detail|chi tiết/.test(s)) return 90;
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

/** Remove every <use> of a symbol from a fragment (to measure what that symbol contributes). */
export function withoutUses(svg: string, id: string): string {
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return svg.replace(new RegExp(`<use\\b[^>]*href\\s*=\\s*["']#${esc}["'][^>]*?(/>|>\\s*</use>|>)`, "g"), "");
}

/**
 * Visible height (% of frame) of what `withUse` adds over `without`: the
 * vertical extent of pixels that differ. Measures the character as the viewer
 * sees it, whatever transforms, groups or cropping are involved.
 */
export async function visibleHeightPct(withUse: Buffer, without: Buffer): Promise<number> {
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
  return top < 0 ? 0 : Math.round(((bottom - top + 1) / a.h) * 100);
}

/** Mean perceived brightness (0..255) of a render. */
export async function meanBrightness(png: Buffer): Promise<number> {
  const s = await sharp(png).stats();
  return Math.round(0.2126 * s.channels[0].mean + 0.7152 * s.channels[1].mean + 0.0722 * s.channels[2].mean);
}

export const NIGHT_WORDS = /\b(night|midnight|moonlit|moonlight|at dusk|evening|dark)\b|đêm|tối|trăng|夜|晩|月明|闇/i;

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
