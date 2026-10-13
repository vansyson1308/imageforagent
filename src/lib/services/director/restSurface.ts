import type { Box01 } from "@/lib/services/director/svgTools";

/**
 * The surface an object rests on, drawn by the engine (owner + QC 2026-10-12, D78; D80).
 * A shot that says its object sits "on a table" gets a table under that object: the Artist
 * was told so in words and did not draw one (bánh chưng take 1, shot 11). Like the kite's
 * string, the table is drawn on the final layout from where the object really is, and is
 * redrawn from scratch on every revision (`data-rest`).
 */

/** "on the small wooden table", "trên bàn", "テーブルの上": the object of the shot rests on a table. */
export const ON_TABLE =
  /\b(?:on|upon|atop|onto)\s+(?:the\s+|a\s+|an\s+|its\s+|their\s+)?(?:[a-z-]+\s+){0,3}?(?:table|tabletop|desk|counter)\b|\btrên\s+(?:(?:cái|chiếc|mặt)\s+)?bàn\b(?!\s*thờ)|(?:テーブル|机|卓袱台|ちゃぶ台|カウンター)の上/i;

export function restsOnTable(description: string): boolean {
  return ON_TABLE.test(description);
}

/** Element nesting depth at `index` (0 = top level) and where the top-level element holding it starts. */
function topLevelStart(svg: string, index: number): number {
  let depth = 0;
  let start = index;
  for (const t of svg.slice(0, index).matchAll(/<(\/?)([a-zA-Z][\w:-]*)\b[^>]*?(\/?)>/g)) {
    if (t[3] === "/") continue;
    if (!t[1] && depth === 0) start = t.index!;
    depth += t[1] ? -1 : 1;
  }
  return depth === 0 ? index : start;
}

const r = (v: number) => Math.round(v);

/**
 * A wooden table whose top carries `body` (the object's main body, in [0,1] of the frame):
 * its back edge a little above the object's base, its front edge below it, wider than the
 * object, an apron and two legs to the bottom of the frame, and a soft contact shadow under
 * the object. Inserted just before the object's first `<use>` (or before the top-level
 * element holding it), so the object stands on it. Null when the object is not placed.
 */
export function tableUnder(svg: string, id: string, body: Box01, canvas: { w: number; h: number }, night = false): { svg: string; note: string } | null {
  const clean = svg.replace(/<g\b[^>]*\bdata-rest\s*=\s*["'][^"']*["'][^>]*>[\s\S]*?<\/g>/g, "");
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`<use\\b[^>]*href\\s*=\\s*["']#${esc}(?:--[a-z0-9_-]+)?["']`).exec(clean);
  if (!m) return null;
  const { w: W, h: H } = canvas;
  const cx = ((body.x0 + body.x1) / 2) * W;
  const bw = (body.x1 - body.x0) * W;
  const base = body.y1 * H;
  const depth = H * 0.1;
  const yBack = base - depth * 0.5;
  const yFront = Math.min(H, base + depth * 0.5);
  const halfBack = Math.max(bw * 0.8, W * 0.26);
  const halfFront = halfBack * 1.12;
  const clampX = (x: number) => Math.min(W * 1.05, Math.max(-W * 0.05, x));
  const [bl, br, fl, fr] = [clampX(cx - halfBack), clampX(cx + halfBack), clampX(cx - halfFront), clampX(cx + halfFront)];
  const apron = H * 0.045;
  const wood = night ? { top: "#5b3d27", grain: "#4a311f", edge: "#6f4a2f", apron: "#3f2919", leg: "#352215" } : { top: "#9a6a42", grain: "#86593a", edge: "#b47e50", apron: "#6e4729", leg: "#5c3a21" };
  const parts: string[] = [];
  // two legs at the front corners, down to the bottom of the frame
  const legW = W * 0.022;
  if (yFront + apron < H) {
    for (const x of [fl + W * 0.03, fr - W * 0.03 - legW]) parts.push(`<rect x="${r(x)}" y="${r(yFront + apron)}" width="${r(legW)}" height="${r(H - yFront - apron + 2)}" fill="${wood.leg}"/>`);
  }
  // the top, seen a little from above, its grain, the lit front edge and the apron under it
  parts.push(`<path d="M${r(bl)} ${r(yBack)} L${r(br)} ${r(yBack)} L${r(fr)} ${r(yFront)} L${r(fl)} ${r(yFront)} Z" fill="${wood.top}"/>`);
  for (const t of [0.3, 0.55, 0.8]) {
    const y = yBack + (yFront - yBack) * t;
    const lx = bl + (fl - bl) * t;
    const rx = br + (fr - br) * t;
    parts.push(`<path d="M${r(lx + (rx - lx) * 0.06)} ${r(y)} L${r(rx - (rx - lx) * 0.1)} ${r(y + depth * 0.02)}" stroke="${wood.grain}" stroke-width="${Math.max(1, r(H * 0.003))}" fill="none" stroke-linecap="round"/>`);
  }
  parts.push(`<rect x="${r(fl)}" y="${r(yFront)}" width="${r(fr - fl)}" height="${r(H * 0.008)}" fill="${wood.edge}"/>`);
  parts.push(`<rect x="${r(fl)}" y="${r(yFront + H * 0.008)}" width="${r(fr - fl)}" height="${r(apron)}" fill="${wood.apron}"/>`);
  // the object sits ON it: a soft shadow where its base meets the top
  parts.push(`<ellipse cx="${r(cx)}" cy="${r(base)}" rx="${r(bw * 0.52)}" ry="${r(depth * 0.16)}" fill="#1e140c" opacity="0.35"/>`);
  const at = topLevelStart(clean, m.index);
  const group = `<g data-rest="table">${parts.join("")}</g>`;
  return {
    svg: clean.slice(0, at) + group + clean.slice(at),
    note: `#${id} rests on a table drawn by the engine (top ${r(yBack)}–${r(yFront)} px, ${r(fl)}–${r(fr)} px wide; owner D78)`,
  };
}
