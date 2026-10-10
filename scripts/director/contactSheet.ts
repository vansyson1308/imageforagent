/**
 * Contact sheets for by-eye QC (owner plan 2026-10-10): every shot of a film
 * on one image, in order, each tile labelled with its shot number and a short
 * measured note (critic score, shot type). Used by showcase.ts (candidates)
 * and pilot.ts (Shorts).
 */
import sharp, { type OverlayOptions } from "sharp";

export interface SheetTile {
  /** An image file or buffer (any size; it is fitted into the tile). */
  readonly image: string | Buffer;
  /** Label under the tile, e.g. "03 · MS · critic 7/10". Latin text only (no font needed for CJK). */
  readonly label: string;
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Columns for a sheet: 4 for landscape tiles, 6 for portrait (9:16) ones. */
export const sheetColumns = (aspect: "16:9" | "9:16") => (aspect === "9:16" ? 6 : 4);

/** Tile size in px for an aspect: 480 wide for 16:9, 270 wide for 9:16 (same area per shot). */
export function tileSize(aspect: "16:9" | "9:16"): { w: number; h: number } {
  return aspect === "9:16" ? { w: 270, h: 480 } : { w: 480, h: 270 };
}

/** One JPEG with every tile in reading order, a title bar on top. */
export async function contactSheet(tiles: readonly SheetTile[], opts: { aspect: "16:9" | "9:16"; title: string }): Promise<Buffer> {
  const cols = sheetColumns(opts.aspect);
  const { w, h } = tileSize(opts.aspect);
  const gap = 12;
  const labelH = 30;
  const titleH = 56;
  const rows = Math.max(1, Math.ceil(tiles.length / cols));
  const W = cols * w + (cols + 1) * gap;
  const H = titleH + rows * (h + labelH + gap) + gap;
  const layers: OverlayOptions[] = [];
  const labels: string[] = [];
  for (const [i, t] of tiles.entries()) {
    const x = gap + (i % cols) * (w + gap);
    const y = titleH + gap + Math.floor(i / cols) * (h + labelH + gap);
    layers.push({ input: await sharp(t.image).resize(w, h, { fit: "contain", background: "#222" }).toBuffer(), left: x, top: y });
    labels.push(`<text x="${x + 4}" y="${y + h + 21}" font-family="DejaVu Sans, sans-serif" font-size="17" fill="#ddd">${esc(t.label)}</text>`);
  }
  const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><text x="${gap}" y="38" font-family="DejaVu Sans, sans-serif" font-size="26" font-weight="bold" fill="#fff">${esc(opts.title)}</text>${labels.join("")}</svg>`;
  layers.push({ input: Buffer.from(overlay), left: 0, top: 0 });
  return sharp({ create: { width: W, height: H, channels: 3, background: "#111" } }).composite(layers).jpeg({ quality: 85 }).toBuffer();
}
