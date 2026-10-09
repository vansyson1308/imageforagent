import type { CanvasSize } from "@/lib/services/svgRenderer";
import type { AmbientLayer } from "@/lib/services/director/camera";
import type { KitSpec } from "@/lib/services/director/cast";
import { buildCritter, buildDoll, critterFace, dollFace, variantId, type DrawPose, type Expression, type FaceAnchors, type Pose } from "@/lib/services/director/dollKit";
import type { Plan, ShotPlan } from "@/lib/services/director/schemas";

/**
 * Acting (SPEC v2 WP4.1). Characters built by the engine's kits act:
 *  - per shot, a POSED + EXPRESSIVE variant symbol, built from the same parts
 *    and colours as the base symbol (identity stays pixel-identical);
 *  - EYE BLINKS: eyelid overlays switched on for two frames at seeded times;
 *  - LIP-SYNC: a mouth overlay whose height follows the engine's lip curves
 *    of the speaker's recorded line (audio/lipsync.ts);
 *  - WALK: the walker leaves the painting and becomes two stride layers
 *    (walk_a / walk_b) that alternate while the body moves one step per
 *    swap: the planted foot of one frame is exactly the back foot of the
 *    next, so the walk never skates (test-enforced, tests/acting.test.ts).
 * Pure and deterministic (seeded by shot index + character id): the output is
 * plain 2D construct shapes + tracks that ride the camera like the ambient layer.
 */

export interface ActingCue {
  readonly who: string;
  readonly pose: Pose;
  readonly expression: Expression;
}

const PREFERRED_POSE = (p: Pose): DrawPose => (p === "walk" ? "walk_a" : p);

/** The symbol the Artist should place for `who` in this shot ("lan--wave-smile", or "lan"). */
export function actingSymbol(shot: ShotPlan, who: string, kits: ReadonlyMap<string, KitSpec>): string {
  const cue = shot.acting?.find((a) => a.who === who);
  if (!cue || !kits.has(who)) return who;
  return variantId(who, PREFERRED_POSE(cue.pose), cue.expression);
}

/** Every variant the plan needs (walk needs both stride frames). */
export function neededVariants(plan: Plan, kits: ReadonlyMap<string, KitSpec>): Array<{ who: string; pose: DrawPose; expression: Expression }> {
  const seen = new Set<string>();
  const out: Array<{ who: string; pose: DrawPose; expression: Expression }> = [];
  for (const shot of plan.shots) {
    for (const a of shot.acting ?? []) {
      if (!kits.has(a.who) || !shot.cast.includes(a.who)) continue;
      const poses: DrawPose[] = a.pose === "walk" ? ["walk_a", "walk_b"] : [a.pose];
      for (const pose of poses) {
        const vid = variantId(a.who, pose, a.expression);
        if (vid === a.who || seen.has(vid)) continue;
        seen.add(vid);
        out.push({ who: a.who, pose, expression: a.expression });
      }
    }
  }
  return out;
}

/**
 * Variant symbols to append to the library (they reuse the base symbol's
 * gradient). Variants the library already holds (a series episode copies
 * the series library) are not emitted twice.
 */
export function variantDefs(plan: Plan, kits: ReadonlyMap<string, KitSpec>, defs: string): string {
  return neededVariants(plan, kits)
    .filter((v) => !defs.includes(`id="${variantId(v.who, v.pose, v.expression)}"`))
    .map((v) => {
      const kit = kits.get(v.who)!;
      const grad = kit.kind === "doll" ? `${v.who}-skin` : `${v.who}-fur`;
      const withGradient = !defs.includes(`id="${grad}"`);
      return kit.kind === "doll" ? buildDoll(v.who, kit.spec, { pose: v.pose, expression: v.expression, withGradient }) : buildCritter(v.who, kit.spec, { pose: v.pose, expression: v.expression, withGradient });
    })
    .join("\n");
}

/** The Artist's per-shot acting brief. */
export function actingBrief(shot: ShotPlan, kits: ReadonlyMap<string, KitSpec>): string {
  const lines = (shot.acting ?? [])
    .filter((a) => kits.has(a.who) && shot.cast.includes(a.who))
    .map((a) => {
      const sym = actingSymbol(shot, a.who, kits);
      return `- ${a.who} ${a.pose} (${a.expression}): place <use href="#${sym}" …/> instead of #${a.who}${a.pose === "walk" ? " (the engine animates the walk: leave room in the direction of travel)" : ""}`;
    });
  return lines.length ? `ACTING (the engine posed these characters; use exactly these symbols, same size rules):\n${lines.join("\n")}` : "";
}

// ---------- placements in a painting ----------

export interface Placement {
  readonly who: string;
  readonly symbol: string;
  readonly pose: DrawPose;
  readonly expression: Expression;
  /** the <use> element as written */
  readonly markup: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const POSE_RE = "stand|walk_a|walk_b|sit|wave|point|hold|hug|bow|look-left|look-right|kneel";
const EXPR_RE = "neutral|smile|laugh|sad|surprised|sleepy";

/**
 * Plain `<use>`s of kit characters that sit at the top level of the painting
 * (not inside a transformed group: then we can't know where the face is, and
 * the character simply isn't animated).
 */
export function kitPlacements(svg: string, kits: ReadonlyMap<string, KitSpec>): Placement[] {
  const out: Placement[] = [];
  const tagRe = /<(\/?)(g|use)\b([^>]*?)(\/?)>/g;
  let transformedDepth = 0;
  const stack: boolean[] = [];
  for (const m of svg.matchAll(tagRe)) {
    const [markup, closing, tag, attrs, selfClose] = m;
    if (tag === "g") {
      if (closing) {
        if (stack.pop()) transformedDepth--;
      } else if (!selfClose) {
        const t = /\btransform\s*=/.test(attrs);
        stack.push(t);
        if (t) transformedDepth++;
      }
      continue;
    }
    if (closing || transformedDepth > 0 || /\btransform\s*=/.test(attrs)) continue;
    const href = attrs.match(/href\s*=\s*["']#([^"']+)["']/)?.[1];
    if (!href) continue;
    const vm = href.match(new RegExp(`^(.+?)--(${POSE_RE})-(${EXPR_RE})$`));
    const who = vm ? vm[1] : href;
    if (!kits.has(who)) continue;
    const num = (k: string) => Number(attrs.match(new RegExp(`\\b${k}\\s*=\\s*["']?(-?[\\d.]+)`))?.[1] ?? NaN);
    const [x, y, w, h] = [num("x"), num("y"), num("width"), num("height")];
    if (![w, h].every(Number.isFinite) || w <= 0 || h <= 0) continue;
    out.push({ who, symbol: href, pose: (vm?.[2] as DrawPose) ?? "stand", expression: (vm?.[3] as Expression) ?? "neutral", markup, x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0, w, h });
  }
  return out;
}

/** viewBox (400×600, xMidYMid meet) → canvas mapping of a placement. */
export function placementMap(p: Pick<Placement, "x" | "y" | "w" | "h">): { s: number; ox: number; oy: number } {
  const s = Math.min(p.w / 400, p.h / 600);
  return { s, ox: p.x + (p.w - 400 * s) / 2, oy: p.y + (p.h - 600 * s) / 2 };
}

export function faceOf(kit: KitSpec, pose: DrawPose, expr: Expression): FaceAnchors {
  return kit.kind === "doll" ? dollFace(kit.spec, pose, expr) : critterFace(kit.spec, pose, expr);
}

// ---------- deterministic seeded noise ----------

function seeded(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

/** Blink start times in [0, duration): first at 0.6–1.6 s, then every 2.4–4.2 s. */
export function blinkTimes(duration: number, seed: string): number[] {
  const rnd = seeded(seed);
  const out: number[] = [];
  let t = 0.6 + rnd() * 1.0;
  while (t < duration - 0.3 && out.length < 12) {
    out.push(Math.round(t * 1000) / 1000);
    t += 2.4 + rnd() * 1.8;
  }
  return out;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const OFF = 0.001;
/** a walk shows at most this many steps (one layer + one track each) */
export const MAX_WALK_STEPS = 9;

/** Scale keys that show a shape (scale 1) during [t, t+len) and hide it (≈0) otherwise. */
function pulseKeys(starts: readonly number[], len: number, duration: number): Array<{ t: number; v: number; ease: string }> {
  const keys: Array<{ t: number; v: number; ease: string }> = [{ t: 0, v: OFF, ease: "linear" }];
  for (const s of starts) {
    const a = Math.max(0.002, s);
    const b = Math.min(duration, s + len);
    if (b - a < 0.004 || a <= keys.at(-1)!.t) continue;
    keys.push({ t: r3(a - 0.001), v: OFF, ease: "linear" }, { t: r3(a), v: 1, ease: "linear" }, { t: r3(b - 0.001), v: 1, ease: "linear" }, { t: r3(b), v: OFF, ease: "linear" });
  }
  keys.push({ t: r3(duration), v: OFF, ease: "linear" });
  return keys.filter((k, i, a) => i === 0 || k.t > a[i - 1].t);
}

/** Scale keys that show a layer exactly during [from, to) of a shot of length `duration`. */
export function windowKeys(from: number, to: number, duration: number): Array<{ t: number; v: number; ease: string }> {
  const D = r3(duration);
  const k = (t: number, v: number) => ({ t: r3(t), v, ease: "linear" });
  const keys = from <= 0 ? [k(0, 1)] : [k(0, OFF), k(from - 0.001, OFF), k(from, 1)];
  if (to < duration - 0.002) keys.push(k(to - 0.001, 1), k(to, OFF), k(D, OFF));
  else keys.push(k(D, 1));
  return keys.filter((x, i, a) => i === 0 || x.t > a[i - 1].t);
}

export interface LipInput {
  /** speaking character id */
  readonly who: string;
  /** mouth openness per frame at `fps`, starting at `offset` seconds */
  readonly open: readonly number[];
  readonly fps: number;
  readonly offset: number;
}

export interface WalkLayer {
  readonly who: string;
  /** patterns to add to the project defs (`act-fN-who-a`, `…-b`) */
  readonly patterns: string[];
  readonly steps: number;
  /** canvas units the body moves per stride swap (= one step of the gait) */
  readonly stepPx: number;
  readonly direction: 1 | -1;
}

export interface ActingOutput {
  /** the painting, with walkers taken out (they become moving layers) */
  readonly svg: string;
  readonly layer: AmbientLayer;
  readonly walks: WalkLayer[];
  readonly summary: string[];
}

/**
 * Blinks, lip-sync and walks for one shot. `index` namespaces ids per shot.
 * Shapes and tracks are in CANVAS coordinates (toCameraSpace shifts them).
 */
export function actingLayer(opts: {
  readonly index: number;
  readonly svg: string;
  readonly kits: ReadonlyMap<string, KitSpec>;
  readonly duration: number;
  readonly fps: number;
  readonly canvas: CanvasSize;
  readonly lip?: LipInput | null;
  /** remaining budget of shapes/tracks in the motion spec */
  readonly maxShapes?: number;
  readonly maxTracks?: number;
}): ActingOutput {
  const { duration, canvas } = opts;
  const shapes: Array<Record<string, unknown>> = [];
  const tracks: Array<{ target: string; keys: Array<{ t: number; v: unknown; ease?: string }> }> = [];
  const walks: WalkLayer[] = [];
  const summary: string[] = [];
  let svg = opts.svg;
  const maxShapes = opts.maxShapes ?? 30;
  const maxTracks = opts.maxTracks ?? 30;
  const room = (s: number, t: number) => shapes.length + s <= maxShapes && tracks.length + t <= maxTracks;

  for (const p of kitPlacements(opts.svg, opts.kits)) {
    const kit = opts.kits.get(p.who)!;
    const { s, ox, oy } = placementMap(p);
    const tag = `act${opts.index}-${p.who}`.replace(/[^a-zA-Z0-9_-]/g, "");

    // WALK: the painted walker is replaced by one layer per step position, shown in turn. Each step
    // alternates the stride frame and moves the body by exactly one step, so the planted foot of
    // one frame is the back foot of the next: no skating (construct bakes `at` into the path, so the
    // positions live in the patterns themselves).
    if (p.pose === "walk_a" || p.pose === "walk_b") {
      const stepPx = faceOf(kit, "walk_a", p.expression).step * s;
      const half = 0.35; // one stride frame per 0.35 s: a calm storybook walk
      const centre = p.x + p.w / 2;
      const direction: 1 | -1 = centre <= canvas.w / 2 ? 1 : -1;
      const maxTravel = canvas.w * 0.45;
      const steps = Math.max(1, Math.min(MAX_WALK_STEPS, Math.floor(duration / half), Math.floor(maxTravel / Math.max(1, stepPx))));
      if (!room(steps + 1, steps + 1) || stepPx <= 0) continue;
      svg = svg.replace(p.markup, "");
      const patterns: string[] = [];
      for (let k = 0; k <= steps; k++) {
        const id = `${tag}-s${k}`;
        const pose: DrawPose = k % 2 === 0 ? "walk_a" : "walk_b";
        const x = p.x + direction * k * stepPx;
        const flip = direction === -1 ? ` transform="translate(${r3(2 * (x + p.w / 2))} 0) scale(-1 1)"` : "";
        patterns.push(
          `<pattern id="${id}" patternUnits="userSpaceOnUse" x="${-canvas.w / 2}" y="${-canvas.h / 2}" width="${canvas.w}" height="${canvas.h}">\n` +
            `<g${flip}><use href="#${variantId(p.who, pose, p.expression)}" x="${r3(x)}" y="${r3(p.y)}" width="${r3(p.w)}" height="${r3(p.h)}"/></g>\n</pattern>`,
        );
        const from = k * half;
        const to = k === steps ? duration : Math.min(duration, (k + 1) * half);
        shapes.push({ id, type: "rect", w: canvas.w, h: canvas.h, at: [canvas.w / 2, canvas.h / 2], fill: `url(#${id})`, scale: k === 0 ? 1 : OFF });
        tracks.push({ target: `shapes.${id}.scale`, keys: windowKeys(from, to, duration) });
      }
      walks.push({ who: p.who, patterns, steps, stepPx: r3(stepPx), direction });
      summary.push(`${p.who} walks ${steps} steps ${direction === 1 ? "right" : "left"}`);
      continue;
    }

    const face = faceOf(kit, p.pose, p.expression);
    // BLINKS (2 frames each), only when the expression has open eyes
    if (!face.eyesClosed && room(4, 4)) {
      const times = blinkTimes(duration, `${opts.index}:${p.who}`);
      if (times.length) {
        const len = 2 / opts.fps;
        face.eyes.forEach((e, k) => {
          const lid = `${tag}-lid${k}`;
          const lash = `${tag}-lash${k}`;
          const at = [r3(ox + e.x * s), r3(oy + e.y * s)];
          shapes.push({ id: lid, type: "ellipse", rx: r3(e.rx * 1.55 * s), ry: r3(Math.max(e.ry, e.rx) * 1.45 * s), at, fill: face.skin, scale: OFF });
          shapes.push({ id: lash, type: "line", points: [[r3(-e.rx * 1.3 * s), 0], [r3(e.rx * 1.3 * s), 0]], strokeWidth: r3(Math.max(1.5, e.rx * 0.55 * s)), stroke: "#2a2233", at, scale: OFF });
          tracks.push({ target: `shapes.${lid}.scale`, keys: pulseKeys(times, len, duration) }, { target: `shapes.${lash}.scale`, keys: pulseKeys(times, len, duration) });
        });
        summary.push(`${p.who} blinks ${times.length}×`);
      }
    }
    // LIP-SYNC: the speaker's mouth opens with the measured envelope of the recorded line
    if (opts.lip && opts.lip.who === p.who && opts.lip.open.length && room(1, 1)) {
      const mouth = `${tag}-mouth`;
      const m = face.mouth;
      const step = Math.max(1, Math.ceil(opts.lip.open.length / 56));
      const keys: Array<{ t: number; v: number[]; ease: string }> = [{ t: 0, v: [1, OFF], ease: "linear" }];
      for (let k = 0; k < opts.lip.open.length; k += step) {
        const t = r3(opts.lip.offset + (k + 0.5) / opts.lip.fps);
        if (t <= keys.at(-1)!.t || t >= duration) continue;
        keys.push({ t, v: [1, r3(Math.max(OFF, Math.min(1, opts.lip.open[k])))], ease: "linear" });
      }
      const endT = r3(Math.min(duration, opts.lip.offset + opts.lip.open.length / opts.lip.fps + 0.05));
      if (endT > keys.at(-1)!.t) keys.push({ t: endT, v: [1, OFF], ease: "linear" });
      if (duration > keys.at(-1)!.t) keys.push({ t: r3(duration), v: [1, OFF], ease: "linear" });
      shapes.push({ id: mouth, type: "ellipse", rx: r3(m.w * 0.42 * s), ry: r3(m.w * 0.42 * s), at: [r3(ox + m.x * s), r3(oy + (m.y + m.w * 0.15) * s)], fill: "#6e2620", scale: [1, OFF] });
      tracks.push({ target: `shapes.${mouth}.scale`, keys });
      summary.push(`${p.who} lip-sync ${r3(opts.lip.open.length / opts.lip.fps)} s`);
    }
  }
  return { svg, layer: { shapes, tracks }, walks, summary };
}

/** The speaking cast id of a shot (speaker named like a cast member), else null (narrator / nobody). */
export function speakerId(plan: Plan, shot: ShotPlan): string | null {
  if (!shot.speaker) return null;
  const s = shot.speaker.trim().toLowerCase();
  const c = plan.cast.find((m) => m.kind === "character" && (m.name.toLowerCase() === s || m.id === s || s.includes(m.name.toLowerCase())));
  return c && shot.cast.includes(c.id) ? c.id : null;
}
