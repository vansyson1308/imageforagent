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
