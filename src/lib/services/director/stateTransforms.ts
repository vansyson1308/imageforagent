import sharp from "sharp";
import { renderArtwork } from "@/lib/services/svgRenderer";
import { neededExtras, splitLibrary, symbolIds } from "@/lib/services/director/svgTools";
import type { CastMember } from "@/lib/services/director/schemas";

/**
 * Prop state transforms (owner 2026-10-12, D77): the ENGINE draws a key object's later state on top
 * of its approved drawing, instead of asking the Cast for a new drawing that may not read (the round-4
 * kite: four redraws of "torn" never showed a hole). Generic for any flat prop drawn as a symbol:
 *
 * - `tear`: a jagged hole through the object (what is behind it shows through: the hole is clipped
 *   out, not painted), its frayed edge, and a flap of the object's own colour hanging from the hole.
 * - `patch`: a white cloth patch with visible running stitches and cross-stitches over the same spot.
 * - `star`: a big gold five-point star painted on the same spot — on another state's drawing (`on`, e.g.
 *   the patched one: owner 2026-10-12 night, the kite's starred state is its patched state + a gold star) or,
 *   without one, on a patch of its own.
 *
 * Both are new `<symbol>`s that `<use>` the base drawing, so the base stays byte-identical and every
 * state lines up pixel-perfectly with it. The spot is found on the base drawing alone (`findSpot`): the
 * first of four quadrant points of the object's body where a disc fits entirely on the object, so a
 * tear and a later patch land on the same spot. Deterministic: same base → same spot → same markup.
 */

export const STATE_OPS = ["tear", "patch", "star"] as const;
export type StateOp = (typeof STATE_OPS)[number];

export interface ViewBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Where an op lands, in the base symbol's viewBox units, and the object's colour there. */
export interface Spot {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly color: string;
}

const n = (v: number) => String(Math.round(v * 10) / 10);

export function viewBoxOf(symbol: string): ViewBox | null {
  const m = symbol.match(/^<symbol\b[^>]*\bviewBox\s*=\s*["']\s*([-\d.]+)[\s,]+([-\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  if (!m) return null;
  const [x, y, w, h] = m.slice(1, 5).map(Number);
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

const hex2 = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
function shade(color: string, t: number): string {
  const c = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  const to = t < 0 ? 0 : 255;
  return `#${c.map((v) => hex2(v + (to - v) * Math.abs(t))).join("")}`;
}

/**
 * The spot on the base drawing an op lands on: the object's body is measured on a render (white
 * background), then the first of four points — upper-right, upper-left, lower-right, lower-left of the
 * body's centre, off its centre lines (where a kite's spars run) — whose disc of radius r lies on the
 * object at 9 sample points. Null when the drawing has no such spot (too thin or empty).
 */
export async function findSpot(defs: string, baseId: string): Promise<Spot | null> {
  const lib = splitLibrary(defs);
  const symbol = lib.symbols.get(baseId);
  const vb = symbol ? viewBoxOf(symbol) : null;
  if (!symbol || !vb) return null;
  // the symbol drawn on a 1920×1080 canvas inside a 1000-unit box, aspect kept
  const k = 1000 / Math.max(vb.w, vb.h);
  const bw = vb.w * k;
  const bh = vb.h * k;
  const ox = (1920 - bw) / 2;
  const oy = (1080 - bh) / 2;
  const own = [...neededExtras(symbol, lib.extras).values()];
  // the base may <use> other symbols (a state built on a state): keep the whole library
  const png = await renderArtwork([...own, ...lib.symbols.values()].join("\n"), `<rect width="1920" height="1080" fill="#ffffff"/><use href="#${baseId}" x="${n(ox)}" y="${n(oy)}" width="${n(bw)}" height="${n(bh)}"/>`, "16:9", "1K");
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const s = info.width / 1920;
  const px = (x: number, y: number) => {
    const X = Math.round(x * s);
    const Y = Math.round(y * s);
    if (X < 0 || Y < 0 || X >= info.width || Y >= info.height) return null;
    const i = (Y * info.width + X) * info.channels;
    return [data[i], data[i + 1], data[i + 2]] as const;
  };
  const on = (x: number, y: number) => {
    const p = px(x, y);
    return !!p && 765 - (p[0] + p[1] + p[2]) > 30;
  };
  // the body's box: rows and columns with a run of object pixels (thin strings and lines ignored)
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const step = 4;
  const minRun = 6;
  for (let y = oy; y < oy + bh; y += step) {
    let run = 0;
    for (let x = ox; x < ox + bw; x += step) {
      run = on(x, y) ? run + 1 : 0;
      if (run >= minRun) {
        x0 = Math.min(x0, x - (minRun - 1) * step);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
  }
  if (!(x1 > x0 && y1 > y0)) return null;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const w = x1 - x0;
  const h = y1 - y0;
  const samples = [[0, 0], ...Array.from({ length: 8 }, (_, i) => [Math.cos((i * Math.PI) / 4), Math.sin((i * Math.PI) / 4)])];
  // largest disc first, nearer the centre as it shrinks (a diamond kite's quadrants narrow toward the tips)
  for (const [off, rf] of [[0.22, 0.12], [0.2, 0.1], [0.16, 0.08]] as const) {
    const r = rf * Math.min(w, h);
    for (const [sx, sy] of [[1, -1], [-1, -1], [1, 1], [-1, 1]] as const) {
      const x = cx + sx * off * w;
      const y = cy + sy * off * 0.9 * h;
      // clear of the body's centre lines (a kite's spars, a parcel's strings) and fully on the object
      if (Math.abs(x - cx) < 1.3 * r || Math.abs(y - cy) < 1.3 * r) continue;
      if (!samples.every(([dx, dy]) => on(x + dx * r * 1.1, y + dy * r * 1.1))) continue;
      const c = px(x, y)!;
      return { x: vb.x + (x - ox) / k, y: vb.y + (y - oy) / k, r: r / k, color: `#${c.map(hex2).join("")}` };
    }
  }
  return null;
}

/** The jagged outline of the hole: 11 points around the spot, a fixed tear pattern. */
function holePoints(spot: Spot): Array<[number, number]> {
  const pattern = [1, 0.62, 1.12, 0.7, 0.96, 0.56, 1.06, 0.66, 1.02, 0.6, 0.9];
  return pattern.map((f, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / pattern.length;
    return [spot.x + Math.cos(a) * spot.r * 1.2 * f, spot.y + Math.sin(a) * spot.r * 1.2 * f];
  });
}

const placeBase = (baseId: string, vb: ViewBox) => `<use href="#${baseId}" x="${n(vb.x)}" y="${n(vb.y)}" width="${n(vb.w)}" height="${n(vb.h)}"/>`;

/** `tear`: the base with a jagged hole cut through it (clipped out), a frayed edge and a hanging flap. */
export function tearSymbol(baseId: string, id: string, vb: ViewBox, spot: Spot): string {
  const pts = holePoints(spot);
  const poly = `M${pts.map(([x, y]) => `${n(x)} ${n(y)}`).join(" L")} Z`;
  // the flap: the torn piece, still attached along the hole's right edge, folded out and hanging down over the
  // object (its back shows), so the hole itself stays open
  const [a, b] = [pts[2], pts[4]];
  const tip: [number, number] = [spot.x + spot.r * 1.55, spot.y + spot.r * 1.9];
  const mid: [number, number] = [spot.x + spot.r * 1.75, spot.y + spot.r * 0.55];
  const edge = shade(spot.color, -0.45);
  return [
    `<symbol id="${id}" viewBox="${n(vb.x)} ${n(vb.y)} ${n(vb.w)} ${n(vb.h)}">`,
    `<clipPath id="${id}-hole"><path clip-rule="evenodd" d="M${n(vb.x)} ${n(vb.y)} H${n(vb.x + vb.w)} V${n(vb.y + vb.h)} H${n(vb.x)} Z ${poly}"/></clipPath>`,
    `<g clip-path="url(#${id}-hole)">${placeBase(baseId, vb)}</g>`,
    // frayed edge around the hole, and short loose threads
    `<path d="${poly}" fill="none" stroke="${edge}" stroke-width="${n(spot.r * 0.07)}" stroke-linejoin="round"/>`,
    ...pts.filter((_, i) => i % 2 === 0).map(([x, y]) => `<path d="M${n(x)} ${n(y)} L${n(x + (x - spot.x) * 0.16)} ${n(y + (y - spot.y) * 0.16)}" stroke="${edge}" stroke-width="${n(spot.r * 0.035)}" stroke-linecap="round"/>`),
    // the flap: the object's own colour, a shade darker (its back), a fold line and a shadow
    `<path d="M${n(a[0])} ${n(a[1])} L${n(b[0])} ${n(b[1])} L${n(tip[0])} ${n(tip[1])} L${n(mid[0])} ${n(mid[1])} Z" fill="#000000" fill-opacity="0.18" transform="translate(${n(spot.r * 0.08)} ${n(spot.r * 0.1)})"/>`,
    `<path d="M${n(a[0])} ${n(a[1])} L${n(b[0])} ${n(b[1])} L${n(tip[0])} ${n(tip[1])} L${n(mid[0])} ${n(mid[1])} Z" fill="${shade(spot.color, -0.22)}" stroke="${edge}" stroke-width="${n(spot.r * 0.06)}" stroke-linejoin="round"/>`,
    `<path d="M${n((a[0] + b[0]) / 2)} ${n((a[1] + b[1]) / 2)} L${n(tip[0])} ${n(tip[1])}" stroke="${shade(spot.color, 0.25)}" stroke-width="${n(spot.r * 0.04)}"/>`,
    `</symbol>`,
  ].join("");
}

/** `patch`: the base with a white cloth patch sewn over the spot (running stitches inside its edge, cross-stitches over it). */
export function patchSymbol(baseId: string, id: string, vb: ViewBox, spot: Spot): string {
  const s = spot.r * 1.25;
  const x = spot.x - s;
  const y = spot.y - s;
  const thread = "#5b4636";
  const inset = s * 0.2;
  const ticks: string[] = [];
  // cross-stitches over the patch's edge, every ~0.4 r on each side
  const count = 5;
  for (let i = 1; i < count; i++) {
    const t = x + (2 * s * i) / count;
    const u = y + (2 * s * i) / count;
    const L = s * 0.18;
    ticks.push(`M${n(t)} ${n(y - L)} V${n(y + L)}`, `M${n(t)} ${n(y + 2 * s - L)} V${n(y + 2 * s + L)}`, `M${n(x - L)} ${n(u)} H${n(x + L)}`, `M${n(x + 2 * s - L)} ${n(u)} H${n(x + 2 * s + L)}`);
  }
  return [
    `<symbol id="${id}" viewBox="${n(vb.x)} ${n(vb.y)} ${n(vb.w)} ${n(vb.h)}">`,
    placeBase(baseId, vb),
    `<g transform="rotate(-7 ${n(spot.x)} ${n(spot.y)})">`,
    `<rect x="${n(x + s * 0.08)}" y="${n(y + s * 0.1)}" width="${n(2 * s)}" height="${n(2 * s)}" rx="${n(s * 0.1)}" fill="#000000" fill-opacity="0.16"/>`,
    `<rect x="${n(x)}" y="${n(y)}" width="${n(2 * s)}" height="${n(2 * s)}" rx="${n(s * 0.1)}" fill="#f7f2e6" stroke="#d6ccb8" stroke-width="${n(s * 0.04)}"/>`,
    // the weave, faintly
    `<path d="${Array.from({ length: 6 }, (_, i) => `M${n(x + s * 0.15)} ${n(y + ((i + 1) * 2 * s) / 7)} H${n(x + 2 * s - s * 0.15)}`).join(" ")}" stroke="#e4dccb" stroke-width="${n(s * 0.025)}"/>`,
    `<rect x="${n(x + inset)}" y="${n(y + inset)}" width="${n(2 * s - 2 * inset)}" height="${n(2 * s - 2 * inset)}" fill="none" stroke="${thread}" stroke-width="${n(s * 0.05)}" stroke-dasharray="${n(s * 0.16)} ${n(s * 0.1)}" stroke-linecap="round"/>`,
    `<path d="${ticks.join(" ")}" stroke="${thread}" stroke-width="${n(s * 0.045)}" stroke-linecap="round"/>`,
    `</g>`,
    `</symbol>`,
  ].join("");
}

/** The five-point star's outline around the spot, tilted with the patch. */
function starPath(spot: Spot): string {
  const R = spot.r * 1.25 * 0.88;
  const r = R * 0.42;
  const pts = Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const k = i % 2 ? r : R;
    return `${n(spot.x + Math.cos(a) * k)} ${n(spot.y + Math.sin(a) * k)}`;
  });
  return `M${pts.join(" L")} Z`;
}

/** `star`: a big gold star painted on the spot, over another state's drawing (`onId`) or over a patch of its own. */
export function starSymbol(baseId: string, id: string, vb: ViewBox, spot: Spot, onId: string | null): string {
  const under = onId ? placeBase(onId, vb) : patchSymbol(baseId, `${id}-p`, vb, spot).replace(/^<symbol\b[^>]*>/, "").replace(/<\/symbol>$/, "");
  const d = starPath(spot);
  return [
    `<symbol id="${id}" viewBox="${n(vb.x)} ${n(vb.y)} ${n(vb.w)} ${n(vb.h)}">`,
    under,
    `<g transform="rotate(-7 ${n(spot.x)} ${n(spot.y)})">`,
    `<path d="${d}" fill="#000000" fill-opacity="0.15" transform="translate(${n(spot.r * 0.06)} ${n(spot.r * 0.08)})"/>`,
    `<path d="${d}" fill="#f2c230" stroke="#b8860b" stroke-width="${n(spot.r * 0.06)}" stroke-linejoin="round"/>`,
    // a painted highlight on the upper arms
    `<path d="M${n(spot.x)} ${n(spot.y - spot.r * 0.85)} L${n(spot.x + spot.r * 0.18)} ${n(spot.y - spot.r * 0.3)} L${n(spot.x)} ${n(spot.y - spot.r * 0.22)} Z" fill="#fff3b8" fill-opacity="0.8"/>`,
    `</g>`,
    `</symbol>`,
  ].join("");
}

/** One edit of a reused cast (an operator request option, D77). `on`: the state a `star` is painted over. */
export type CastEdit = { readonly prop: string; readonly state: string; readonly op: StateOp; readonly on?: string } | { readonly prop: string; readonly op: "single" };

/**
 * Apply edits to a reused cast and its library. `tear`/`patch` replace `<prop>--<state>` with the
 * engine's drawing on the base (`<prop>`); `single` keeps the prop's base drawing only (its states and
 * state symbols are removed, so the planner sees one look). Returns what changed, for the trace.
 */
export async function applyCastEdits(cast: readonly CastMember[], library: string, edits: readonly CastEdit[]): Promise<{ cast: CastMember[]; library: string; changed: string[]; removed: string[]; report: string[] }> {
  let lib = splitLibrary(library);
  let members = cast.map((c) => ({ ...c }));
  const changed: string[] = [];
  const removed: string[] = [];
  const report: string[] = [];
  for (const e of edits) {
    const member = members.find((c) => c.id === e.prop);
    if (!member) throw new Error(`no cast member #${e.prop}`);
    if (e.op === "single") {
      const gone = [...lib.symbols.keys()].filter((id) => id.startsWith(`${e.prop}--`));
      for (const id of gone) lib.symbols.delete(id);
      removed.push(...gone);
      members = members.map((c) => (c.id === e.prop ? { ...c, states: undefined, ...(c.anatomy && { anatomy: { ...c.anatomy, states: [] } }) } : c));
      report.push(`#${e.prop}: one look only (removed ${gone.length ? gone.map((g) => `#${g}`).join(", ") : "no state symbols"})`);
      continue;
    }
    if (!member.states?.some((s) => s.id === e.state)) throw new Error(`#${e.prop} has no state "${e.state}"`);
    const base = lib.symbols.get(e.prop);
    const vb = base ? viewBoxOf(base) : null;
    if (!base || !vb) throw new Error(`no drawing of #${e.prop} to ${e.op}`);
    const defs = [...lib.extras.values(), ...lib.symbols.values()].join("\n");
    const spot = await findSpot(defs, e.prop);
    if (!spot) throw new Error(`#${e.prop}: no spot on the drawing to ${e.op} (the object is too thin)`);
    const id = `${e.prop}--${e.state}`;
    const onId = e.op === "star" && e.on ? `${e.prop}--${e.on}` : null;
    if (onId && !lib.symbols.has(onId)) throw new Error(`no drawing #${onId} to paint the star on`);
    lib.symbols.set(id, e.op === "tear" ? tearSymbol(e.prop, id, vb, spot) : e.op === "patch" ? patchSymbol(e.prop, id, vb, spot) : starSymbol(e.prop, id, vb, spot, onId));
    changed.push(id);
    report.push(`#${id} = ${e.op} of #${e.prop}${onId ? ` on #${onId}` : ""} at (${n(spot.x)}, ${n(spot.y)}) r ${n(spot.r)}`);
    lib = splitLibrary([...lib.extras.values(), ...lib.symbols.values()].join("\n"));
  }
  const out = [...lib.extras.values(), ...lib.symbols.values()].join("\n");
  if (!symbolIds(out).length) throw new Error("the edited library is empty");
  return { cast: members, library: out, changed, removed, report };
}
