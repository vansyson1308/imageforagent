import { z } from "zod";

/**
 * The paper-doll kit: a parametric human character drawn by the ENGINE from a
 * small spec the Cast (Super) writes. Real runs showed Super draws sets well
 * enough but assembles people badly (heads floating off bodies, 4-shape stick
 * figures). A doll is connected, proportioned and consistent by construction,
 * and costs ~150 output tokens instead of ~2 000. Pure and deterministic:
 * the same spec always yields the same markup (viewBox 0 0 400 600, feet on
 * y≈592, facing the viewer). Non-human characters are still drawn by Super.
 */

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "a #rrggbb colour");

export const HAIR_STYLES = ["short", "spiky", "bob", "long", "ponytail", "bun", "low-bun", "braids", "bald"] as const;
export const TOPS = ["tshirt", "shirt", "jacket", "cardigan", "dress", "robe", "kimono", "aodai"] as const;
export const BOTTOMS = ["pants", "shorts", "skirt", "long-skirt", "none"] as const;
export const ACCESSORIES = ["glasses", "round-glasses", "scarf", "hat", "conical-hat", "bow", "bag", "beard", "mustache", "bangle", "cane", "apron"] as const;
/**
 * Figure proportions: "storybook" (big head, about 1:5) or "adult" (about
 * 1:6.3, for channels that forbid chibi; owner decision C, 2026-10-10).
 */
export const FIGURES = ["storybook", "adult"] as const;

export const dollSchema = z.object({
  age: z.enum(["child", "adult", "elder"]),
  build: z.enum(["slim", "average", "round"]).default("average"),
  skin: hex,
  hairStyle: z.enum(HAIR_STYLES),
  hairColor: hex,
  top: z.enum(TOPS),
  topColor: hex,
  bottom: z.enum(BOTTOMS).default("pants"),
  bottomColor: hex.optional(),
  accent: hex,
  accessories: z.array(z.enum(ACCESSORIES)).max(4).default([]),
  figure: z.enum(FIGURES).default("storybook"),
  /** the blouse under a cardigan or jacket (default warm white) */
  innerColor: hex.optional(),
  /** apron colour (default cream) */
  apronColor: hex.optional(),
  /** shoe colour (default dark) */
  shoeColor: hex.optional(),
});
export type DollSpec = z.infer<typeof dollSchema>;

/* Words the Cast used for a kit option under another name (VI showcase run 3: "top" outside the list rejected both dolls). */
const DOLL_ALIASES: Record<string, Record<string, string>> = {
  age: { kid: "child", girl: "child", boy: "child", baby: "child", teen: "child", teenager: "child", young: "adult", man: "adult", woman: "adult", grown: "adult", old: "elder", senior: "elder", grandma: "elder", grandpa: "elder", grandmother: "elder", grandfather: "elder", elderly: "elder" },
  build: { thin: "slim", skinny: "slim", normal: "average", medium: "average", chubby: "round", plump: "round", stout: "round", heavy: "round" },
  hairStyle: { curly: "short", buzz: "short", crew: "short", "pixie": "short", "pony-tail": "ponytail", "pigtails": "braids", braid: "braids", plait: "braids", "top-knot": "bun", topknot: "bun", "updo": "bun", "low bun": "low-bun", lowbun: "low-bun", chignon: "low-bun", "nape-bun": "low-bun", shoulder: "bob", straight: "long", wavy: "long", none: "bald", shaved: "bald" },
  top: { "t-shirt": "tshirt", tee: "tshirt", blouse: "shirt", tunic: "shirt", "ao-ba-ba": "shirt", "áo-bà-ba": "shirt", "ba-ba": "shirt", polo: "shirt", sweater: "jacket", hoodie: "jacket", coat: "jacket", knit: "cardigan", "knit-cardigan": "cardigan", vest: "jacket", uniform: "jacket", gown: "dress", sundress: "dress", frock: "dress", cloak: "robe", kaftan: "robe", yukata: "kimono", happi: "kimono", hanbok: "robe", "ao-dai": "aodai", "áo-dài": "aodai" },
  bottom: { "long skirt": "long-skirt", longskirt: "long-skirt", "maxi-skirt": "long-skirt", "maxi": "long-skirt", "ankle-skirt": "long-skirt", trousers: "pants", jeans: "pants", slacks: "pants", leggings: "pants", "quần": "pants", short: "shorts", dress: "none", gown: "none", hakama: "pants" },
};
const DOLL_ACCESSORY_ALIASES: Record<string, (typeof ACCESSORIES)[number]> = { "tortoiseshell-glasses": "round-glasses", "round-spectacles": "round-glasses", "reading-glasses": "round-glasses", spectacles: "glasses", "non-la": "conical-hat", "nón-lá": "conical-hat", "conical": "conical-hat", cap: "hat", beanie: "hat", ribbon: "bow", "hair-bow": "bow", backpack: "bag", purse: "bag", basket: "bag", moustache: "mustache", bracelet: "bangle", walking: "cane", stick: "cane", "walking-stick": "cane", pinafore: "apron" };

/**
 * A Cast doll spec, made usable (like sets, D44): an option outside the kit's
 * list is mapped to the kit's word for it, and accessories the kit has no word
 * for are dropped. Returns what changed so the run can say it.
 */
export function normalizeDollSpec(raw: unknown): { spec: unknown; notes: string[] } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { spec: raw, notes: [] };
  const spec: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  const notes: string[] = [];
  const allowed: Record<string, readonly string[]> = { age: ["child", "adult", "elder"], build: ["slim", "average", "round"], hairStyle: HAIR_STYLES, top: TOPS, bottom: BOTTOMS, figure: FIGURES };
  const key = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase().replace(/[\s_]+/g, "-") : "");
  for (const [field, list] of Object.entries(allowed)) {
    const v = key(spec[field]);
    if (!v) continue;
    const mapped = list.includes(v) ? v : list.includes(v.replace(/-/g, "")) ? v.replace(/-/g, "") : DOLL_ALIASES[field]?.[v];
    if (mapped && mapped !== spec[field]) {
      if (mapped !== v) notes.push(`${field} "${spec[field]}" → "${mapped}"`);
      spec[field] = mapped;
    }
  }
  if (Array.isArray(spec.accessories)) {
    const kept: string[] = [];
    const dropped: string[] = [];
    for (const a of spec.accessories) {
      const v = key(a);
      const known = (ACCESSORIES as readonly string[]).includes(v) ? v : DOLL_ACCESSORY_ALIASES[v];
      if (known && !kept.includes(known)) kept.push(known);
      else if (!known) dropped.push(String(a));
    }
    if (dropped.length) notes.push(`dropped accessories the kit doesn't draw: ${dropped.join(", ")}`);
    spec.accessories = kept.slice(0, 4);
  }
  return { spec, notes };
}

/** Natural human skin tones, light to dark (the fallback when a spec's skin is not one). */
export const SKIN_TONES = ["#f6d3b8", "#f1c9a5", "#e9c09c", "#d9a77f", "#c68863", "#a86b4a", "#8a5236", "#6b3e28", "#4e2c1d"] as const;

function hsl(hex: string): { h: number; s: number; l: number } {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  return { h: (h + 360) % 360, s, l };
}

/**
 * A human kit figure's skin must be a plausible skin tone (owner QC: a Cast
 * reply once gave the grandfather the palette's green). Plausible = a warm
 * hue (red to yellow-orange), not grey (HSV saturation ≥ 0.08), not neon (≤ 0.75), not black. Anything else is replaced by
 * the natural tone of the nearest lightness, so the character stays as light
 * or as dark as the model intended.
 */
export function naturalSkin(hex: string): { skin: string; corrected: boolean } {
  const c = hsl(hex.toLowerCase());
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const sat = max ? (max - Math.min(r, g, b)) / max : 0; // HSV saturation: pale skin with red at 255 is still only ~0.2
  const warm = c.h <= 55 || c.h >= 345;
  if (warm && sat >= 0.08 && sat <= 0.75 && max >= 0.18) return { skin: hex, corrected: false };
  let best: string = SKIN_TONES[0];
  for (const t of SKIN_TONES) if (Math.abs(hsl(t).l - c.l) < Math.abs(hsl(best).l - c.l)) best = t;
  return { skin: best, corrected: true };
}

/**
 * Natural hair: black, browns, blondes, reds/auburn (warm hues) or greys and
 * whites (barely saturated). A tinted grey (hosted run 3: the grandfather's
 * light-blue hair and beard) becomes the neutral grey of the same lightness.
 */
export function naturalHair(hex: string): { hair: string; corrected: boolean } {
  const c = hsl(hex.toLowerCase());
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const sat = max ? (max - Math.min(r, g, b)) / max : 0;
  if (sat <= 0.12 || c.l < 0.22 || c.h <= 50 || c.h >= 340) return { hair: hex, corrected: false };
  const v = Math.round(c.l * 255).toString(16).padStart(2, "0");
  return { hair: `#${v}${v}${v}`, corrected: true };
}

/** The kit's vocabulary, for the Cast prompt. */
export const DOLL_VOCABULARY = [
  `{"age": "child|adult|elder", "build": "slim|average|round", "skin": "#rrggbb (a natural human skin tone, never a palette colour)", "hairStyle": "${HAIR_STYLES.join("|")}", "hairColor": "#rrggbb",`,
  ` "top": "${TOPS.join("|")}", "topColor": "#rrggbb", "bottom": "${BOTTOMS.join("|")}", "bottomColor": "#rrggbb", "accent": "#rrggbb",`,
  ` "accessories": [up to 4 of ${ACCESSORIES.map((a) => `"${a}"`).join(", ")}],`,
  ` "figure": "storybook|adult", "innerColor": "#rrggbb (blouse under a cardigan/jacket, optional)", "apronColor": "#rrggbb (optional)", "shoeColor": "#rrggbb (optional)"}`,
].join("\n");

const n = (x: number) => String(Math.round(x * 10) / 10);

function mix(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `#${pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

export interface Frame {
  cx: number;
  headR: number;
  headY: number;
  shoulderY: number;
  hipY: number;
  kneeY: number;
  footY: number;
  shw: number;
  hhw: number;
  armW: number;
  legW: number;
}

export function dollProportions(spec: DollSpec): Frame {
  const k = spec.build === "slim" ? 0.88 : spec.build === "round" ? 1.22 : 1;
  // adult figure (no chibi): a smaller head on a longer body, same 400×600 box and foot line
  const adult = spec.figure === "adult";
  const base = adult
    ? spec.age === "child"
      ? { headR: 60, headY: 168, shoulderY: 246, hipY: 404, shw: 54, hhw: 46, armW: 20, legW: 25 }
      : spec.age === "elder"
        ? { headR: 44, headY: 112, shoulderY: 170, hipY: 356, shw: 62, hhw: 54, armW: 19, legW: 24 }
        : { headR: 43, headY: 72, shoulderY: 128, hipY: 324, shw: 60, hhw: 50, armW: 19, legW: 24 }
    : spec.age === "child"
      ? { headR: 80, headY: 132, shoulderY: 222, hipY: 396, shw: 58, hhw: 50, armW: 22, legW: 28 }
      : spec.age === "elder"
        ? { headR: 58, headY: 100, shoulderY: 176, hipY: 350, shw: 72, hhw: 58, armW: 24, legW: 30 }
        : { headR: 58, headY: 86, shoulderY: 160, hipY: 338, shw: 76, hhw: 60, armW: 24, legW: 31 };
  const footY = 592;
  return { cx: 200, ...base, shw: base.shw * k, hhw: base.hhw * k, footY, kneeY: base.hipY + (footY - base.hipY) * 0.5 };
}

// ---------- Acting: poses and expressions (SPEC v2 WP4.1) ----------

/** Poses the Director can ask for. `walk` is rendered as two stride frames (walk_a / walk_b) by the acting layer. */
export const POSES = ["stand", "walk", "sit", "wave", "point", "hold", "hug", "bow", "look-left", "look-right", "kneel"] as const;
export type Pose = (typeof POSES)[number];
/** Internal stride frames of `walk` (mirror images of each other around the hip). */
export type DrawPose = Exclude<Pose, "walk"> | "walk_a" | "walk_b";
export const EXPRESSIONS = ["neutral", "smile", "laugh", "sad", "surprised", "sleepy"] as const;
export type Expression = (typeof EXPRESSIONS)[number];

export interface ActingOptions {
  readonly pose?: DrawPose;
  readonly expression?: Expression;
  /** symbol id (default: the character id = stand + neutral) */
  readonly symbolId?: string;
  /** false = don't emit the shared skin gradient (a variant reuses the base one) */
  readonly withGradient?: boolean;
}

/** Variant symbol id: "lan" (stand, neutral) or "lan--wave-smile". */
export function variantId(id: string, pose: DrawPose = "stand", expression: Expression = "neutral"): string {
  return pose === "stand" && expression === "neutral" ? id : `${id}--${pose}-${expression}`;
}

/** Walk leg swing (degrees) and the resulting step: the hip moves one step per stride frame. */
export const WALK_SWING_DEG = 16;

/** Where the face is in the symbol's viewBox (400×600) for a pose/expression: blink + lip-sync overlays. */
export interface FaceAnchors {
  readonly eyes: ReadonlyArray<{ x: number; y: number; rx: number; ry: number }>;
  readonly mouth: { x: number; y: number; w: number };
  readonly skin: string;
  /** the expression already has closed eyes (laugh, sleepy): no blink */
  readonly eyesClosed: boolean;
  /** step length (viewBox units) between walk_a and walk_b, 0 for other poses */
  readonly step: number;
  /** where the hands meet in the `hold` pose (viewBox units): a held prop goes here */
  readonly hands: { readonly x: number; readonly y: number };
}

/**
 * Per-pose body geometry, shared by the drawing and the face anchors (blink +
 * lip-sync overlays), so the overlays always land on the drawn face.
 *  - sit: hips drop to a stool, thighs go sideways (a visible knee bend), shins down
 *  - kneel: seiza, hips on the heels, legs folded into a wide base
 *  - bow: shoulders drop and the head sinks forward, so the crown shows and the eyes look down
 *  - look-left/right: a 3/4 head turn (head offset, face shifted, far ear hidden, back hair shows)
 */
function poseGeometry(f: Frame, pose: DrawPose) {
  const leg = f.footY - f.hipY;
  const dy = pose === "sit" ? leg * 0.42 : pose === "kneel" ? leg * 0.62 : 0;
  const look = pose === "look-left" ? -1 : pose === "look-right" ? 1 : 0;
  const bow = pose === "bow";
  const sy = f.shoulderY + dy + (bow ? 34 : 0);
  return {
    look,
    sy,
    hp: f.hipY + dy,
    hy: bow ? sy - f.headR * 0.42 : f.headY + dy,
    headDx: look * f.headR * 0.14,
    faceDx: look * f.headR * 0.3,
    faceDy: bow ? f.headR * 0.3 : 0,
    downcast: bow,
  };
}

/** One human character as a <symbol> (+ its gradient and clip path), ids prefixed by `id`. */
export function buildDoll(id: string, spec: DollSpec, opts: ActingOptions = {}): string {
  const pose: DrawPose = opts.pose ?? "stand";
  const expr: Expression = opts.expression ?? "neutral";
  const sid = opts.symbolId ?? variantId(id, pose, expr);
  const f = dollProportions(spec);
  const { cx, headR: R, footY: fy, shw, hhw, armW, legW } = f;
  const g = poseGeometry(f, pose);
  const { look, sy, hy, hp } = g;
  const headGroup = (on: boolean) => (g.headDx ? (on ? `<g transform="translate(${n(g.headDx)} 0)">` : "</g>") : "");
  const ky = f.kneeY;
  const skinLight = mix(spec.skin, "#ffffff", 0.28);
  const skinShade = mix(spec.skin, "#3a2418", 0.18);
  const bottomColor = spec.bottomColor ?? mix(spec.topColor, "#1d1a26", 0.45);
  const has = (a: (typeof ACCESSORIES)[number]) => spec.accessories.includes(a);
  const shoe = spec.shoeColor ?? "#2b2530";
  const longSkirt = spec.bottom === "long-skirt";
  const skirted = spec.bottom === "skirt" || longSkirt;
  const long = spec.top === "robe" || spec.top === "kimono" || spec.top === "aodai";
  const seated = pose === "sit" || pose === "kneel";
  const hem = pose === "sit" ? hp + 16 : pose === "kneel" ? hp + 10 : long ? fy - 46 : spec.top === "dress" ? ky + 10 : hp + 22;
  const hemHW = long ? hhw * 1.25 : spec.top === "dress" ? hhw * 1.55 : hhw + 6;
  const bulge = spec.build === "round" ? 18 : 0;
  const torso = `M${n(cx - shw)} ${n(sy + 10)} Q${n(cx - shw)} ${n(sy - 6)} ${n(cx - shw + 20)} ${n(sy - 8)} L${n(cx + shw - 20)} ${n(sy - 8)} Q${n(cx + shw)} ${n(sy - 6)} ${n(cx + shw)} ${n(sy + 10)} Q${n(cx + shw + bulge)} ${n((sy + hp) / 2)} ${n(cx + hemHW)} ${n(hem)} L${n(cx - hemHW)} ${n(hem)} Q${n(cx - shw - bulge)} ${n((sy + hp) / 2)} ${n(cx - shw)} ${n(sy + 10)} Z`;
  const legX = [cx - hhw * 0.45, cx + hhw * 0.45];
  const out: string[] = [];
  if (opts.withGradient !== false) out.push(`<radialGradient id="${id}-skin" cx="0.38" cy="0.32" r="0.75"><stop offset="0" stop-color="${skinLight}"/><stop offset="1" stop-color="${spec.skin}"/></radialGradient>`);
  out.push(`<symbol id="${sid}" viewBox="0 0 400 600">`);
  out.push(`<clipPath id="${sid}-torso"><path d="${torso}"/></clipPath>`);
  out.push(pose === "sit" ? `<ellipse cx="${n(cx + hhw * 0.7)}" cy="${fy + 2}" rx="${n(hhw * 2.7)}" ry="8" fill="#1d2233" fill-opacity="0.22"/>` : `<ellipse cx="${cx}" cy="${fy + 2}" rx="${n(hhw * (seated ? 2.1 : 1.7))}" ry="8" fill="#1d2233" fill-opacity="0.22"/>`);

  // Hair behind the head
  out.push(headGroup(true));
  if (spec.hairStyle === "long") out.push(`<path d="M${n(cx - R - 6)} ${n(hy)} Q${n(cx - R - 14)} ${n(sy + 70)} ${n(cx - R + 14)} ${n(sy + 84)} L${n(cx + R - 14)} ${n(sy + 84)} Q${n(cx + R + 14)} ${n(sy + 70)} ${n(cx + R + 6)} ${n(hy)} Z" fill="${spec.hairColor}"/>`);
  if (spec.hairStyle === "bob") out.push(`<path d="M${n(cx - R - 8)} ${n(hy - 6)} Q${n(cx - R - 12)} ${n(hy + R)} ${n(cx - R + 10)} ${n(hy + R * 1.02)} L${n(cx + R - 10)} ${n(hy + R * 1.02)} Q${n(cx + R + 12)} ${n(hy + R)} ${n(cx + R + 8)} ${n(hy - 6)} Z" fill="${spec.hairColor}"/>`);
  if (spec.hairStyle === "ponytail") out.push(`<ellipse cx="${n(cx + R * 0.95)}" cy="${n(hy + R * 0.45)}" rx="${n(R * 0.3)}" ry="${n(R * 0.85)}" fill="${spec.hairColor}" transform="rotate(-18 ${n(cx + R * 0.95)} ${n(hy + R * 0.45)})"/>`);
  if (spec.hairStyle === "low-bun") out.push(`<circle cx="${n(cx + (look ? -look : 1) * R * 0.66)}" cy="${n(hy + R * 0.66)}" r="${n(R * 0.36)}" fill="${spec.hairColor}"/><path d="M${n(cx + (look ? -look : 1) * R * 0.5)} ${n(hy + R * 0.5)} q${n(R * 0.16)} ${n(R * 0.16)} ${n(R * 0.32)} 0" fill="none" stroke="${mix(spec.hairColor, "#1d1a26", 0.3)}" stroke-width="3"/>`);
  if (spec.hairStyle === "braids") for (const s of [-1, 1]) out.push(`<rect x="${n(cx + s * R * 0.82 - 11)}" y="${n(hy)}" width="22" height="${n(sy + 90 - hy)}" rx="11" fill="${spec.hairColor}"/>`);
  out.push(headGroup(false));

  // Legs, shoes (drawn before the clothes so hems overlap them)
  const legTop = hp - 10;
  const legColor = spec.bottom === "pants" && !long && spec.top !== "dress" ? bottomColor : spec.skin;
  if (pose === "walk_a" || pose === "walk_b") {
    // both legs pivot at the hip centre, mirror images: the front foot of walk_a lands where the back foot of walk_b is after one step
    const L = fy - 8 - legTop;
    for (const [k, s] of [[0, 1], [1, -1]] as const) {
      const sign = pose === "walk_a" ? s : -s;
      const deg = sign * WALK_SWING_DEG;
      out.push(`<rect x="${n(cx - legW / 2)}" y="${n(legTop)}" width="${n(legW)}" height="${n(L)}" rx="${n(legW / 2)}" fill="${k === 0 ? legColor : mix(legColor, "#1d1a26", 0.18)}" transform="rotate(${-deg} ${n(cx)} ${n(legTop)})"/>`);
      const footX = cx + Math.sin((deg * Math.PI) / 180) * L;
      const footY = legTop + Math.cos((deg * Math.PI) / 180) * L;
      out.push(`<ellipse cx="${n(footX + 4)}" cy="${n(footY + 2)}" rx="${n(legW * 0.9)}" ry="11" fill="${shoe}"/>`);
    }
  } else if (pose === "sit") {
    // on a stool, seen 3/4: thighs go sideways from the hip to the knee (the bend reads in silhouette), shins drop to the floor
    const thighColor = long || spec.top === "dress" ? spec.topColor : skirted ? bottomColor : legColor;
    const shinColor = long ? spec.topColor : longSkirt ? bottomColor : legColor;
    const kx = cx + hhw * 2.05;
    const seatTop = hp + legW * 0.55;
    out.push(`<rect x="${n(cx - hhw * 1.35)}" y="${n(seatTop)}" width="${n(hhw * 3.2)}" height="18" rx="7" fill="#9a6a43"/>`);
    for (const x of [cx - hhw * 1.15, cx + hhw * 1.55]) out.push(`<rect x="${n(x - 7)}" y="${n(seatTop + 14)}" width="14" height="${n(fy - seatTop - 16)}" rx="5" fill="#7a5233"/>`);
    for (const [k, o] of [[0, -9], [1, 9]] as const) {
      const c = k === 0 ? mix(thighColor, "#1d1a26", 0.18) : thighColor;
      out.push(`<path d="M${n(cx - hhw * 0.2)} ${n(hp + o * 0.4)} L${n(kx + o * 0.3)} ${n(hp + 6 + o)}" fill="none" stroke="${c}" stroke-width="${n(legW + 10)}" stroke-linecap="round"/>`);
      out.push(`<path d="M${n(kx + o * 0.3)} ${n(hp + 6 + o)} L${n(kx + 6 + o * 0.3)} ${n(fy - 16)}" fill="none" stroke="${k === 0 ? mix(shinColor, "#1d1a26", 0.18) : shinColor}" stroke-width="${n(legW)}" stroke-linecap="round"/>`);
      out.push(`<ellipse cx="${n(kx + 22 + o * 0.3)}" cy="${n(fy - 6)}" rx="${n(legW * 0.95)}" ry="11" fill="${shoe}"/>`);
    }
  } else if (pose === "kneel") {
    // seiza: legs folded under the hips, seen from the front as a wide base with two knees
    const baseColor = long || spec.top === "dress" ? spec.topColor : skirted ? bottomColor : legColor;
    out.push(`<path d="M${n(cx - hhw * 1.6)} ${n(fy - 4)} Q${n(cx - hhw * 1.75)} ${n(hp + 4)} ${n(cx - hhw * 0.85)} ${n(hp - 10)} L${n(cx + hhw * 0.85)} ${n(hp - 10)} Q${n(cx + hhw * 1.75)} ${n(hp + 4)} ${n(cx + hhw * 1.6)} ${n(fy - 4)} Z" fill="${baseColor}"/>`);
    for (const s of [-1, 1]) out.push(`<ellipse cx="${n(cx + s * hhw * 0.78)}" cy="${n(fy - 20)}" rx="${n(legW * 1.15)}" ry="${n(legW * 0.6)}" fill="${mix(baseColor, "#ffffff", 0.12)}"/>`);
    if (spec.bottom === "shorts" && !long && spec.top !== "dress") out.push(`<path d="M${n(cx - hhw * 1.2)} ${n(hp + 34)} Q${n(cx - hhw * 1.3)} ${n(hp + 2)} ${n(cx - hhw * 0.85)} ${n(hp - 10)} L${n(cx + hhw * 0.85)} ${n(hp - 10)} Q${n(cx + hhw * 1.3)} ${n(hp + 2)} ${n(cx + hhw * 1.2)} ${n(hp + 34)} Z" fill="${bottomColor}"/>`);
  } else {
    for (const x of legX) {
      out.push(`<rect x="${n(x - legW / 2)}" y="${n(legTop)}" width="${n(legW)}" height="${n(fy - 8 - legTop)}" rx="${n(legW / 2)}" fill="${legColor}"/>`);
      out.push(`<ellipse cx="${n(x + 4)}" cy="${n(fy - 6)}" rx="${n(legW * 0.9)}" ry="11" fill="${shoe}"/>`);
    }
  }
  if (!seated && pose !== "walk_a" && pose !== "walk_b") {
    if (spec.bottom === "shorts" && !long && spec.top !== "dress") for (const x of legX) out.push(`<rect x="${n(x - legW / 2 - 3)}" y="${n(legTop)}" width="${n(legW + 6)}" height="${n((ky - legTop) * 0.7)}" rx="8" fill="${bottomColor}"/>`);
    if (spec.bottom === "skirt" && !long && spec.top !== "dress") out.push(`<path d="M${n(cx - hhw - 4)} ${n(hp - 12)} L${n(cx + hhw + 4)} ${n(hp - 12)} L${n(cx + hhw * 1.5)} ${n(ky)} L${n(cx - hhw * 1.5)} ${n(ky)} Z" fill="${bottomColor}"/>`);
  }
  // a long skirt falls to the ankles (walking too: it hides the top of the stride)
  if (longSkirt && !seated && !long && spec.top !== "dress") {
    const ankle = fy - 34;
    out.push(`<path d="M${n(cx - hhw - 4)} ${n(hp - 12)} L${n(cx + hhw + 4)} ${n(hp - 12)} Q${n(cx + hhw * 1.45)} ${n((hp + ankle) / 2)} ${n(cx + hhw * 1.6)} ${n(ankle)} L${n(cx - hhw * 1.6)} ${n(ankle)} Q${n(cx - hhw * 1.45)} ${n((hp + ankle) / 2)} ${n(cx - hhw - 4)} ${n(hp - 12)} Z" fill="${bottomColor}"/>`);
    for (const dx of [-0.6, 0, 0.6]) out.push(`<path d="M${n(cx + dx * hhw * 0.8)} ${n(hp + 10)} L${n(cx + dx * hhw * 1.3)} ${n(ankle - 4)}" stroke="${mix(bottomColor, "#1d1a26", 0.18)}" stroke-width="3" stroke-opacity="0.6"/>`);
  }
  if (pose === "kneel" && skirted && !long && spec.top !== "dress") {
    out.push(`<path d="M${n(cx - hhw - 4)} ${n(hp - 12)} L${n(cx + hhw + 4)} ${n(hp - 12)} L${n(cx + hhw * 1.6)} ${n(hp + 60)} L${n(cx - hhw * 1.6)} ${n(hp + 60)} Z" fill="${bottomColor}"/>`);
  }

  // Arms (sleeve + forearm) and hands, per pose: [shoulder, control, hand]
  const shortSleeve = spec.top === "tshirt" || spec.top === "dress";
  const hands: Array<[number, number]> = [];
  // arms that come in front of the body (hold, bow) are drawn after the torso, so the forearms reach the hands
  const armsInFront = pose === "hold" || pose === "bow";
  const sleeves: string[] = [];
  const swing = pose === "walk_a" ? 1 : pose === "walk_b" ? -1 : 0;
  for (const s of [-1, 1]) {
    const x0 = cx + s * (shw - 10);
    const y0 = sy + 12;
    let x1 = cx + s * (shw + 14);
    let y1 = hp - 8;
    let mx = cx + s * (shw + 16);
    let my = (y0 + y1) / 2 - 20;
    if (swing) {
      x1 = cx + s * (shw + 10) + s * swing * 22;
      mx = cx + s * (shw + 18);
    } else if (pose === "wave" && s === 1) {
      x1 = cx + shw + 52;
      y1 = hy - R * 0.2;
      mx = cx + shw + 70;
      my = sy - 10;
    } else if (pose === "point" && s === 1) {
      x1 = cx + shw + 112;
      y1 = sy + 26;
      mx = cx + shw + 56;
      my = sy + 6;
    } else if (pose === "hold" || pose === "bow") {
      x1 = cx + s * 22;
      y1 = pose === "bow" ? hp - 30 : sy + 70;
      mx = cx + s * (shw + 4);
      my = sy + 50;
    } else if (pose === "hug") {
      x1 = cx + s * (shw + 58);
      y1 = sy + 36;
      mx = cx + s * (shw + 40);
      my = sy + 46;
    } else if (pose === "sit") {
      // hands rest on the thighs
      x1 = cx + hhw * (s === -1 ? 0.35 : 1.15);
      y1 = hp - 6;
      mx = cx + s * (shw + 12);
      my = (y0 + y1) / 2;
    } else if (pose === "kneel") {
      // hands on the knees
      x1 = cx + s * hhw * 0.72;
      y1 = hp + 26;
      mx = cx + s * (shw + 12);
      my = (y0 + y1) / 2;
    }
    const arm = armsInFront ? sleeves : out;
    arm.push(`<path d="M${n(x0)} ${n(y0)} Q${n(mx)} ${n(my)} ${n(x1)} ${n(y1)}" fill="none" stroke="${shortSleeve ? spec.skin : spec.topColor}" stroke-width="${n(armW)}" stroke-linecap="round"/>`);
    if (armsInFront && !shortSleeve) arm.push(`<path d="M${n(x0)} ${n(y0)} Q${n(mx)} ${n(my)} ${n(x1)} ${n(y1)}" fill="none" stroke="${mix(spec.topColor, "#1d1a26", 0.22)}" stroke-width="2.5" stroke-opacity="0.6"/>`);
    if (shortSleeve) {
      const t = 0.42;
      const ex = (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * mx + t * t * x1;
      const ey = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * my + t * t * y1;
      arm.push(`<path d="M${n(x0)} ${n(y0)} L${n(ex)} ${n(ey)}" fill="none" stroke="${spec.topColor}" stroke-width="${n(armW + 6)}" stroke-linecap="round"/>`);
    }
    hands.push([x1, y1 + 4]);
  }

  // Torso + shading side + garment details
  out.push(`<path d="${torso}" fill="${spec.topColor}"/>`);
  out.push(`<rect x="${cx + 6}" y="${n(sy - 12)}" width="${n(hemHW + bulge + 30)}" height="${n(hem - sy + 14)}" fill="#1d1a26" fill-opacity="0.13" clip-path="url(#${sid}-torso)"/>`);
  if (spec.top === "shirt" || spec.top === "jacket") out.push(`<path d="M${cx} ${n(sy - 6)} L${cx} ${n(hem - 4)}" stroke="${spec.accent}" stroke-width="5"/>`);
  if (spec.top === "cardigan") {
    // open knit cardigan over a blouse: the blouse shows down the middle, a soft collar, knit ribs at the hem, buttons
    const inner = spec.innerColor ?? "#f6f2ea";
    const knit = mix(spec.topColor, "#1d1a26", 0.16);
    out.push(`<path d="M${n(cx - 22)} ${n(sy - 8)} L${n(cx + 22)} ${n(sy - 8)} L${n(cx + 13)} ${n(hem - 2)} L${n(cx - 13)} ${n(hem - 2)} Z" fill="${inner}"/>`);
    out.push(`<path d="M${n(cx - 22)} ${n(sy - 8)} L${n(cx - 4)} ${n(sy + 16)} L${n(cx - 16)} ${n(sy + 20)} Z M${n(cx + 22)} ${n(sy - 8)} L${n(cx + 4)} ${n(sy + 16)} L${n(cx + 16)} ${n(sy + 20)} Z" fill="${mix(inner, "#1d1a26", 0.06)}"/>`);
    out.push(`<path d="M${n(cx - 22)} ${n(sy - 8)} L${n(cx - 13)} ${n(hem - 2)} M${n(cx + 22)} ${n(sy - 8)} L${n(cx + 13)} ${n(hem - 2)}" stroke="${knit}" stroke-width="7" stroke-linecap="round"/>`);
    out.push(`<rect x="${n(cx - hemHW - bulge * 0.3)}" y="${n(hem - 16)}" width="${n(2 * (hemHW + bulge * 0.3))}" height="14" rx="5" fill="${knit}" clip-path="url(#${sid}-torso)"/>`);
    for (let k = 0; k < 4; k++) out.push(`<circle cx="${n(cx - 21 + k * 0.5)}" cy="${n(sy + 30 + k * ((hem - sy - 60) / 3))}" r="4" fill="${mix(spec.topColor, "#5a3a1a", 0.55)}"/>`);
    for (let k = -3; k <= 3; k++) if (k) out.push(`<path d="M${n(cx + k * shw * 0.26)} ${n(sy + 6)} L${n(cx + k * hemHW * 0.28)} ${n(hem - 18)}" stroke="${knit}" stroke-opacity="0.35" stroke-width="2.5" clip-path="url(#${sid}-torso)"/>`);
  }
  if (spec.top === "jacket") out.push(`<path d="M${n(cx - 26)} ${n(sy - 8)} L${cx} ${n(sy + 46)} L${n(cx + 26)} ${n(sy - 8)}" fill="none" stroke="${mix(spec.topColor, "#000000", 0.3)}" stroke-width="6"/>`);
  if (spec.top === "kimono") {
    out.push(`<path d="M${n(cx - 30)} ${n(sy - 8)} L${n(cx + 18)} ${n(sy + 70)}" stroke="${spec.accent}" stroke-width="9"/>`);
    out.push(`<rect x="${n(cx - hhw - 8)}" y="${n(hp - 46)}" width="${n(2 * hhw + 16)}" height="30" fill="${spec.accent}"/>`);
  }
  if (spec.top === "aodai") out.push(`<path d="M${n(cx - 16)} ${n(sy + 40)} L${n(cx - 26)} ${n(hem)} M${n(cx + 16)} ${n(sy + 40)} L${n(cx + 26)} ${n(hem)}" stroke="${spec.accent}" stroke-width="4"/>`);
  if (spec.top === "robe") out.push(`<rect x="${n(cx - hhw)}" y="${n(hp - 30)}" width="${n(2 * hhw)}" height="14" fill="${spec.accent}"/>`);
  if (has("apron")) {
    const apron = spec.apronColor ?? "#f4efe4";
    // a bib apron over a long skirt reaches below the knee; otherwise the waist apron of the kit
    const bottomY = longSkirt && !seated ? ky + 50 : Math.min(hem, seated ? hem : ky) - 6;
    if (longSkirt || spec.top === "cardigan") {
      out.push(`<path d="M${n(cx - hhw * 0.38)} ${n(sy + 30)} L${n(cx + hhw * 0.38)} ${n(sy + 30)} L${n(cx + hhw * 0.46)} ${n(hp - 18)} L${n(cx + hhw * 0.86)} ${n(hp - 12)} L${n(cx + hhw * 0.96)} ${n(bottomY)} L${n(cx - hhw * 0.96)} ${n(bottomY)} L${n(cx - hhw * 0.86)} ${n(hp - 12)} L${n(cx - hhw * 0.46)} ${n(hp - 18)} Z" fill="${apron}"/>`);
      out.push(`<path d="M${n(cx - hhw * 0.38)} ${n(sy + 30)} L${n(cx - shw * 0.5)} ${n(sy - 6)} M${n(cx + hhw * 0.38)} ${n(sy + 30)} L${n(cx + shw * 0.5)} ${n(sy - 6)}" stroke="${apron}" stroke-width="5"/>`);
      out.push(`<rect x="${n(cx - hhw * 0.34)}" y="${n(hp + 6)}" width="${n(hhw * 0.68)}" height="${n(Math.max(10, (bottomY - hp) * 0.28))}" rx="4" fill="none" stroke="${mix(apron, "#ffffff", 0.25)}" stroke-width="3"/>`);
    } else out.push(`<path d="M${n(cx - hhw * 0.8)} ${n(sy + 60)} L${n(cx + hhw * 0.8)} ${n(sy + 60)} L${n(cx + hhw)} ${n(bottomY)} L${n(cx - hhw)} ${n(bottomY)} Z" fill="${apron}"/>`);
  }
  if (has("bag")) {
    out.push(`<path d="M${n(cx - shw + 14)} ${n(sy)} L${n(cx + hhw + 10)} ${n(hp - 20)}" stroke="${spec.accent}" stroke-width="7"/>`);
    out.push(`<rect x="${n(cx + hhw - 6)}" y="${n(hp - 30)}" width="46" height="40" rx="8" fill="${spec.accent}"/>`);
  }
  if (spec.top !== "kimono" && spec.top !== "aodai") out.push(`<path d="M${n(cx - 24)} ${n(sy - 7)} Q${cx} ${n(sy + 18)} ${n(cx + 24)} ${n(sy - 7)}" fill="${skinShade}"/>`);

  out.push(...sleeves);
  for (const [x, y] of hands) out.push(`<circle cx="${n(x)}" cy="${n(y)}" r="${n(armW * 0.66)}" fill="url(#${id}-skin)"/>`);
  if (has("bangle")) out.push(`<circle cx="${n(hands[0][0])}" cy="${n(hands[0][1] - armW * 0.7)}" r="${n(armW * 0.55)}" fill="none" stroke="${spec.accent}" stroke-width="5"/>`);
  if (has("cane") && !seated && pose !== "wave" && pose !== "point") out.push(`<path d="M${n(hands[1][0])} ${n(hands[1][1] - 6)} L${n(hands[1][0] + 12)} ${n(fy - 4)}" stroke="#6b4a2b" stroke-width="8" stroke-linecap="round"/>`);

  // Neck, scarf, head
  out.push(`<rect x="${n(cx - R * 0.24)}" y="${n(hy + R * 0.8)}" width="${n(R * 0.48)}" height="${n(Math.max(4, sy - hy - R * 0.8 + 2))}" fill="${skinShade}"/>`);
  if (has("scarf")) {
    out.push(`<rect x="${n(cx - shw * 0.62)}" y="${n(sy - 18)}" width="${n(shw * 1.24)}" height="26" rx="13" fill="${spec.accent}"/>`);
    out.push(`<rect x="${n(cx + shw * 0.2)}" y="${n(sy)}" width="24" height="78" rx="10" fill="${mix(spec.accent, "#000000", 0.15)}"/>`);
  }
  out.push(headGroup(true));
  // ears: a turned head hides the far ear; the near ear moves toward the back of the head (drawn after the back hair)
  if (!look) for (const s of [-1, 1]) out.push(`<ellipse cx="${n(cx + s * R * 0.96)}" cy="${n(hy + R * 0.12)}" rx="${n(R * 0.16)}" ry="${n(R * 0.22)}" fill="${spec.skin}"/>`);
  out.push(`<circle cx="${cx}" cy="${n(hy)}" r="${R}" fill="url(#${id}-skin)"/>`);
  if (look) {
    if (spec.hairStyle !== "bald") out.push(`<ellipse cx="${n(cx - look * R * 0.66)}" cy="${n(hy - R * 0.06)}" rx="${n(R * 0.4)}" ry="${n(R * 0.88)}" fill="${spec.hairColor}"/>`);
    out.push(`<ellipse cx="${n(cx - look * R * 0.3)}" cy="${n(hy + R * 0.14)}" rx="${n(R * 0.15)}" ry="${n(R * 0.22)}" fill="${spec.skin}"/>`);
  }

  // Face (in the head group's coordinates)
  const fx = cx + g.faceDx;
  const face = { ...faceGeometry(spec, R, fx, hy + g.faceDy, expr), ...(g.downcast && { eyesClosed: true }) };
  const brow = spec.hairStyle === "bald" ? "#8a8a8a" : spec.hairColor;
  for (const [k, s] of [[0, -1], [1, 1]] as const) {
    const e = face.eyes[k];
    if (face.eyesClosed) {
      // happy (laugh) or sleepy closed eyes
      const up = expr === "laugh" && !g.downcast ? -1 : 1;
      out.push(`<path d="M${n(e.x - e.rx * 1.3)} ${n(e.y)} Q${n(e.x)} ${n(e.y + up * e.ry * 1.2)} ${n(e.x + e.rx * 1.3)} ${n(e.y)}" fill="none" stroke="#2a2233" stroke-width="${n(R * 0.06)}" stroke-linecap="round"/>`);
    } else {
      out.push(`<ellipse cx="${n(e.x)}" cy="${n(e.y)}" rx="${n(e.rx)}" ry="${n(e.ry)}" fill="#2a2233"/>`);
      if (spec.age !== "elder" || expr === "surprised") out.push(`<circle cx="${n(e.x + R * 0.035)}" cy="${n(e.y - R * 0.05)}" r="${n(R * 0.045)}" fill="#ffffff"/>`);
    }
    // brows: sad = inner ends up, surprised = raised
    const by = e.y - R * (expr === "surprised" ? 0.36 : 0.27);
    const inner = expr === "sad" ? -R * 0.08 : 0;
    const ix = e.x - s * R * 0.15;
    const ox = e.x + s * R * 0.15;
    out.push(`<path d="M${n(Math.min(ix, ox))} ${n(by + (s === 1 ? inner : 0))} Q${n(e.x)} ${n(by - R * 0.09)} ${n(Math.max(ix, ox))} ${n(by + (s === -1 ? inner : 0))}" fill="none" stroke="${brow}" stroke-width="${n(R * 0.07)}" stroke-linecap="round"/>`);
    if (s !== -look) out.push(`<circle cx="${n(fx + s * R * 0.56)}" cy="${n(e.y + R * 0.3)}" r="${n(R * (expr === "smile" || expr === "laugh" ? 0.19 : 0.16))}" fill="#ff8a80" fill-opacity="${expr === "smile" || expr === "laugh" ? 0.55 : 0.4}"/>`);
    if (spec.age === "elder") out.push(`<path d="M${n(e.x + s * R * 0.16)} ${n(e.y - R * 0.02)} l${n(s * R * 0.1)} ${n(-R * 0.05)} M${n(e.x + s * R * 0.16)} ${n(e.y + R * 0.06)} l${n(s * R * 0.1)} ${n(R * 0.03)}" stroke="${skinShade}" stroke-width="3" stroke-linecap="round"/>`);
  }
  out.push(`<ellipse cx="${n(fx + look * R * 0.05)}" cy="${n(hy + g.faceDy + R * 0.3)}" rx="${n(R * (look ? 0.09 : 0.07))}" ry="${n(R * 0.05)}" fill="${skinShade}"/>`);
  const m = face.mouth;
  if (expr === "laugh") out.push(`<path d="M${n(m.x - m.w / 2)} ${n(m.y - R * 0.04)} L${n(m.x + m.w / 2)} ${n(m.y - R * 0.04)} Q${n(m.x)} ${n(m.y + R * 0.3)} ${n(m.x - m.w / 2)} ${n(m.y - R * 0.04)} Z" fill="#7a2a22"/>`);
  else if (expr === "surprised") out.push(`<ellipse cx="${n(m.x)}" cy="${n(m.y + R * 0.04)}" rx="${n(R * 0.09)}" ry="${n(R * 0.12)}" fill="#7a2a22"/>`);
  else if (expr === "sad") out.push(`<path d="M${n(m.x - m.w / 2)} ${n(m.y + R * 0.08)} Q${n(m.x)} ${n(m.y - R * 0.08)} ${n(m.x + m.w / 2)} ${n(m.y + R * 0.08)}" fill="none" stroke="#8a3a2a" stroke-width="${n(R * 0.06)}" stroke-linecap="round"/>`);
  else if (expr === "sleepy") out.push(`<path d="M${n(m.x - m.w / 3)} ${n(m.y + R * 0.03)} L${n(m.x + m.w / 3)} ${n(m.y + R * 0.03)}" fill="none" stroke="#8a3a2a" stroke-width="${n(R * 0.05)}" stroke-linecap="round"/>`);
  else out.push(`<path d="M${n(m.x - m.w / 2)} ${n(m.y)} Q${n(m.x)} ${n(m.y + R * (expr === "smile" ? 0.24 : 0.15))} ${n(m.x + m.w / 2)} ${n(m.y)}" fill="none" stroke="#8a3a2a" stroke-width="${n(R * 0.06)}" stroke-linecap="round"/>`);
  const my = m.y;
  if (has("mustache")) out.push(`<path d="M${n(fx - R * 0.3)} ${n(my - R * 0.02)} Q${n(fx)} ${n(my - R * 0.2)} ${n(fx + R * 0.3)} ${n(my - R * 0.02)} Q${n(fx)} ${n(my - R * 0.08)} ${n(fx - R * 0.3)} ${n(my - R * 0.02)} Z" fill="${spec.hairColor}"/>`);
  const by0 = hy + g.faceDy;
  if (has("beard")) out.push(`<path d="M${n(fx - R * 0.7)} ${n(by0 + R * 0.35)} Q${n(fx - R * 0.5)} ${n(by0 + R * 1.35)} ${n(fx)} ${n(by0 + R * 1.4)} Q${n(fx + R * 0.5)} ${n(by0 + R * 1.35)} ${n(fx + R * 0.7)} ${n(by0 + R * 0.35)} Q${n(fx)} ${n(by0 + R * 0.9)} ${n(fx - R * 0.7)} ${n(by0 + R * 0.35)} Z" fill="${spec.hairColor}"/>`);
  if (has("round-glasses")) {
    // round tortoiseshell frames: a warm brown rim with lighter flecks, temples running to the ears
    for (const e of face.eyes) out.push(`<circle cx="${n(e.x)}" cy="${n(e.y)}" r="${n(R * 0.26)}" fill="#ffffff" fill-opacity="0.12" stroke="#6b3f22" stroke-width="${n(Math.max(3.5, R * 0.075))}"/><circle cx="${n(e.x)}" cy="${n(e.y)}" r="${n(R * 0.26)}" fill="none" stroke="#c08a4e" stroke-width="1.6" stroke-dasharray="3 5"/>`);
    out.push(`<path d="M${n(face.eyes[0].x + R * 0.26)} ${n(face.eyes[0].y - R * 0.03)} Q${n(fx)} ${n(face.eyes[0].y - R * 0.1)} ${n(face.eyes[1].x - R * 0.26)} ${n(face.eyes[1].y - R * 0.03)}" fill="none" stroke="#6b3f22" stroke-width="3.5"/>`);
    if (!look) for (const [k, s] of [[0, -1], [1, 1]] as const) out.push(`<path d="M${n(face.eyes[k].x + s * R * 0.26)} ${n(face.eyes[k].y)} L${n(cx + s * R * 0.94)} ${n(hy + R * 0.02)}" stroke="#6b3f22" stroke-width="3"/>`);
  }
  if (has("glasses")) {
    for (const e of face.eyes) out.push(`<circle cx="${n(e.x)}" cy="${n(e.y)}" r="${n(R * 0.22)}" fill="none" stroke="#2a2233" stroke-width="4"/>`);
    out.push(`<path d="M${n(face.eyes[0].x + R * 0.22)} ${n(face.eyes[0].y)} L${n(face.eyes[1].x - R * 0.22)} ${n(face.eyes[1].y)}" stroke="#2a2233" stroke-width="4"/>`);
  }

  // Hair in front
  if (spec.hairStyle !== "bald") {
    const top = hy - R - 10;
    const crown = g.downcast ? R * 0.4 : 0;
    const fringe =
      spec.hairStyle === "spiky"
        ? `M${n(cx - R - 4)} ${n(hy + 4)} L${n(cx - R * 0.8)} ${n(top + 8)} L${n(cx - R * 0.5)} ${n(top + 22)} L${n(cx - R * 0.2)} ${n(top - 4)} L${n(cx + R * 0.1)} ${n(top + 18)} L${n(cx + R * 0.45)} ${n(top - 2)} L${n(cx + R * 0.7)} ${n(top + 20)} L${n(cx + R + 4)} ${n(hy + 4)} Q${n(cx + R * 0.5)} ${n(hy - R * 0.45 + crown)} ${cx} ${n(hy - R * 0.5 + crown)} Q${n(cx - R * 0.5)} ${n(hy - R * 0.45 + crown)} ${n(cx - R - 4)} ${n(hy + 4)} Z`
        : `M${n(cx - R - 3)} ${n(hy + 6)} Q${n(cx - R - 2)} ${n(top)} ${cx} ${n(top)} Q${n(cx + R + 2)} ${n(top)} ${n(cx + R + 3)} ${n(hy + 6)} Q${n(cx + R * 0.55)} ${n(hy - R * 0.42 + crown)} ${n(cx + R * 0.05)} ${n(hy - R * 0.5 + crown)} Q${n(cx - R * 0.6)} ${n(hy - R * 0.4 + crown)} ${n(cx - R - 3)} ${n(hy + 6)} Z`;
    out.push(`<path d="${fringe}" fill="${spec.hairColor}"/>`);
    out.push(`<path d="M${n(cx - R * 0.5)} ${n(top + 14)} Q${n(cx - R * 0.1)} ${n(top + 4)} ${n(cx + R * 0.3)} ${n(top + 12)}" fill="none" stroke="#ffffff" stroke-opacity="0.25" stroke-width="6" stroke-linecap="round"/>`);
  } else if (spec.age === "elder") {
    for (const s of [-1, 1]) out.push(`<ellipse cx="${n(cx + s * R * 0.9)}" cy="${n(hy - R * 0.2)}" rx="${n(R * 0.14)}" ry="${n(R * 0.3)}" fill="${spec.hairColor}"/>`);
  }
  if (spec.hairStyle === "bun") out.push(`<circle cx="${cx}" cy="${n(hy - R - 12)}" r="${n(R * 0.36)}" fill="${spec.hairColor}"/>`);
  if (has("bow")) out.push(`<path d="M${n(cx + R * 0.5)} ${n(hy - R * 0.85)} l-26 -18 l0 36 Z M${n(cx + R * 0.5)} ${n(hy - R * 0.85)} l26 -18 l0 36 Z" fill="${spec.accent}"/>`);
  if (has("hat")) {
    out.push(`<ellipse cx="${cx}" cy="${n(hy - R * 0.55)}" rx="${n(R * 1.45)}" ry="${n(R * 0.22)}" fill="${spec.accent}"/>`);
    out.push(`<path d="M${n(cx - R * 0.8)} ${n(hy - R * 0.55)} Q${n(cx - R * 0.8)} ${n(hy - R * 1.45)} ${cx} ${n(hy - R * 1.45)} Q${n(cx + R * 0.8)} ${n(hy - R * 1.45)} ${n(cx + R * 0.8)} ${n(hy - R * 0.55)} Z" fill="${spec.accent}"/>`);
  }
  if (has("conical-hat")) {
    out.push(`<path d="M${n(cx - R * 1.75)} ${n(hy - R * 0.4)} L${cx} ${n(hy - R * 1.95)} L${n(cx + R * 1.75)} ${n(hy - R * 0.4)} Q${cx} ${n(hy - R * 0.22)} ${n(cx - R * 1.75)} ${n(hy - R * 0.4)} Z" fill="#e8d49a"/>`);
    out.push(`<path d="M${cx} ${n(hy - R * 1.95)} L${n(cx - R * 0.9)} ${n(hy - R * 0.32)} M${cx} ${n(hy - R * 1.95)} L${n(cx + R * 0.9)} ${n(hy - R * 0.32)}" stroke="#c9b273" stroke-width="3"/>`);
  }
  out.push(headGroup(false));
  out.push("</symbol>");
  return out.join("\n");
}

function faceGeometry(spec: { age: string }, R: number, fx: number, hy: number, expr: Expression) {
  const eyeY = hy + R * 0.12;
  const big = expr === "surprised" ? 1.3 : 1;
  const ry = R * (spec.age === "elder" && expr !== "surprised" ? 0.08 : 0.14) * big;
  const eyes = [-1, 1].map((s) => ({ x: fx + s * R * 0.36, y: eyeY, rx: R * 0.1 * big, ry: expr === "sleepy" ? ry * 0.5 : ry }));
  return { eyes, mouth: { x: fx, y: hy + R * 0.48, w: R * (expr === "smile" || expr === "laugh" ? 0.44 : 0.34) }, eyesClosed: expr === "laugh" || expr === "sleepy" };
}

/** Face anchors of a doll variant in its 400×600 viewBox (for blink + lip-sync overlays). */
export function dollFace(spec: DollSpec, pose: DrawPose = "stand", expr: Expression = "neutral"): FaceAnchors {
  const f = dollProportions(spec);
  const p = poseGeometry(f, pose);
  const g = faceGeometry(spec, f.headR, f.cx + p.headDx + p.faceDx, p.hy + p.faceDy, expr);
  const L = f.footY - 8 - (f.hipY - 10);
  // the hold pose brings both hands to (cx ± 22, sy + 70); hand circles are drawn 4 lower
  return { eyes: g.eyes, mouth: g.mouth, skin: spec.skin, eyesClosed: g.eyesClosed || p.downcast, step: 2 * L * Math.sin((WALK_SWING_DEG * Math.PI) / 180), hands: { x: f.cx, y: p.sy + 74 } };
}

// ---------- Critters: upright storybook animals from the same kind of spec ----------

export const EARS = ["pointy", "round", "long", "horns", "none"] as const;
export const TAILS = ["bushy", "thin", "round", "none"] as const;
export const MUZZLES = ["pointed", "round", "flat"] as const;
export const CRITTER_ACCESSORIES = ["scarf", "bow", "hat", "glasses", "bag", "apron"] as const;

export const critterSchema = z.object({
  fur: hex,
  belly: hex,
  ears: z.enum(EARS),
  tail: z.enum(TAILS),
  muzzle: z.enum(MUZZLES),
  accent: hex,
  size: z.enum(["small", "medium", "large"]).default("medium"),
  accessories: z.array(z.enum(CRITTER_ACCESSORIES)).max(3).default([]),
});
export type CritterSpec = z.infer<typeof critterSchema>;

/** Characters whose name/look names an animal (EN · VI · JA) must use the animal kit. */
export const ANIMAL_WORDS =
  /\b(fox|kitsune|cat|kitten|rabbit|bunny|hare|bear|tanuki|raccoon|dog|puppy|mouse|rat|buffalo|cow|ox|bull|goat|sheep|pig|monkey|squirrel|hedgehog|otter|wolf|deer|panda|koala|lion|tiger)\b|con cáo|cáo|mèo|thỏ|gấu|chó|chuột|trâu|bò|dê|cừu|lợn|heo|khỉ|sóc|hổ|狐|きつね|キツネ|猫|ねこ|兎|うさぎ|熊|くま|狸|たぬき|犬|いぬ|鼠|ねずみ|牛|うし|猿|さる|虎/i;

export const CRITTER_VOCABULARY = [
  `{"fur": "#rrggbb", "belly": "#rrggbb", "ears": "${EARS.join("|")}", "tail": "${TAILS.join("|")}", "muzzle": "${MUZZLES.join("|")}",`,
  ` "accent": "#rrggbb", "size": "small|medium|large", "accessories": [up to 3 of ${CRITTER_ACCESSORIES.map((a) => `"${a}"`).join(", ")}]}`,
  "(fox: pointy ears, bushy tail, pointed muzzle · cat: pointy, thin, round · rabbit: long, round, round · bear: round, round, round · tanuki: round, bushy, pointed · mouse: round, thin, pointed · buffalo/cow: horns, thin, flat)",
].join("\n");

/** An upright storybook animal as a <symbol> (viewBox 0 0 400 600, feet on y≈592), ids prefixed by `id`. */
export function buildCritter(id: string, spec: CritterSpec, opts: ActingOptions = {}): string {
  const pose: DrawPose = opts.pose ?? "stand";
  const expr: Expression = opts.expression ?? "neutral";
  const sid = opts.symbolId ?? variantId(id, pose, expr);
  const cx = 200;
  const k = spec.size === "small" ? 0.9 : spec.size === "large" ? 1.08 : 1;
  const cg = critterHead(spec, pose);
  const { R, hy, by, seated, look } = cg; // head radius, head centre (long ears stay inside the viewBox), body centre
  void k;
  const bry = Math.min(592 - 40 - by, R * 1.25); // body half-height
  const brx = R * 0.92;
  const fy = 592;
  const dark = mix(spec.fur, "#1d1a26", 0.35);
  const light = mix(spec.fur, "#ffffff", 0.25);
  const has = (a: (typeof CRITTER_ACCESSORIES)[number]) => spec.accessories.includes(a);
  const out: string[] = [];
  if (opts.withGradient !== false) out.push(`<radialGradient id="${id}-fur" cx="0.38" cy="0.32" r="0.8"><stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${spec.fur}"/></radialGradient>`);
  out.push(`<symbol id="${sid}" viewBox="0 0 400 600">`);
  out.push(`<ellipse cx="${cx}" cy="${fy + 2}" rx="${n(brx * 1.1)}" ry="8" fill="#1d2233" fill-opacity="0.22"/>`);

  // Tail (behind)
  const tx = cx + brx * 0.7;
  const ty = by + bry * 0.4;
  if (spec.tail === "bushy") {
    out.push(`<path d="M${n(tx)} ${n(ty)} Q${n(tx + R * 1.3)} ${n(ty - R * 0.2)} ${n(tx + R * 0.9)} ${n(ty - R * 1.5)} Q${n(tx + R * 0.35)} ${n(ty - R * 0.7)} ${n(tx - R * 0.1)} ${n(ty - R * 0.25)} Z" fill="${spec.fur}"/>`);
    out.push(`<path d="M${n(tx + R * 0.9)} ${n(ty - R * 1.5)} Q${n(tx + R * 1.05)} ${n(ty - R * 1.05)} ${n(tx + R * 0.95)} ${n(ty - R * 0.85)} Q${n(tx + R * 0.7)} ${n(ty - R * 1.0)} ${n(tx + R * 0.9)} ${n(ty - R * 1.5)} Z" fill="${spec.belly}"/>`);
  }
  if (spec.tail === "thin") out.push(`<path d="M${n(tx)} ${n(ty)} Q${n(tx + R * 1.1)} ${n(ty + R * 0.2)} ${n(tx + R * 0.9)} ${n(ty - R * 0.9)}" fill="none" stroke="${spec.fur}" stroke-width="${n(R * 0.16)}" stroke-linecap="round"/>`);
  if (spec.tail === "round") out.push(`<circle cx="${n(tx + R * 0.1)}" cy="${n(ty)}" r="${n(R * 0.3)}" fill="${spec.belly}"/>`);

  // Legs + feet, body, belly
  const legTop = by + bry * 0.4;
  if (seated) {
    // on its haunches: big folded hind legs at the sides, feet forward on the ground
    for (const s of [-1, 1]) {
      out.push(`<ellipse cx="${n(cx + s * brx * 0.78)}" cy="${n(fy - R * 0.5)}" rx="${n(R * 0.52)}" ry="${n(R * 0.44)}" fill="${mix(spec.fur, "#1d1a26", 0.08)}"/>`);
      out.push(`<ellipse cx="${n(cx + s * brx * 0.62)}" cy="${n(fy - 10)}" rx="${n(R * 0.36)}" ry="${n(R * 0.15)}" fill="${dark}"/>`);
    }
  }
  for (const s of seated ? [] : [-1, 1]) {
    const walking = pose === "walk_a" || pose === "walk_b";
    const lx = walking ? cx : cx + s * brx * 0.45;
    const L = Math.max(10, fy - 10 - legTop);
    const deg = walking ? (pose === "walk_a" ? s : -s) * WALK_SWING_DEG : 0;
    out.push(`<rect x="${n(lx - R * 0.2)}" y="${n(legTop)}" width="${n(R * 0.4)}" height="${n(L)}" rx="${n(R * 0.2)}" fill="${spec.fur}"${deg ? ` transform="rotate(${-deg} ${n(lx)} ${n(legTop)})"` : ""}/>`);
    const footX = lx + Math.sin((deg * Math.PI) / 180) * L;
    out.push(`<ellipse cx="${n(footX + s * 6)}" cy="${n(fy - 10)}" rx="${n(R * 0.32)}" ry="${n(R * 0.16)}" fill="${dark}"/>`);
  }
  out.push(`<ellipse cx="${cx}" cy="${n(by)}" rx="${n(brx)}" ry="${n(bry)}" fill="url(#${id}-fur)"/>`);
  out.push(`<ellipse cx="${cx}" cy="${n(by + bry * 0.12)}" rx="${n(brx * 0.6)}" ry="${n(bry * 0.72)}" fill="${spec.belly}"/>`);
  if (has("apron")) out.push(`<path d="M${n(cx - brx * 0.55)} ${n(by - bry * 0.3)} L${n(cx + brx * 0.55)} ${n(by - bry * 0.3)} L${n(cx + brx * 0.7)} ${n(by + bry * 0.85)} L${n(cx - brx * 0.7)} ${n(by + bry * 0.85)} Z" fill="#f4efe4"/>`);
  if (has("bag")) {
    out.push(`<path d="M${n(cx - brx * 0.7)} ${n(by - bry * 0.75)} L${n(cx + brx * 0.75)} ${n(by + bry * 0.3)}" stroke="${spec.accent}" stroke-width="7"/>`);
    out.push(`<rect x="${n(cx + brx * 0.55)}" y="${n(by + bry * 0.2)}" width="44" height="38" rx="8" fill="${spec.accent}"/>`);
  }
  // Arms + paws
  for (const s of [-1, 1]) {
    const x0 = cx + s * brx * 0.78;
    const y0 = by - bry * 0.55;
    let x1 = cx + s * brx * 1.1;
    let y1 = by + bry * 0.25;
    if (pose === "wave" && s === 1) {
      x1 = cx + brx * 1.25;
      y1 = hy - R * 0.1;
    } else if (pose === "point" && s === 1) {
      x1 = cx + brx * 1.75;
      y1 = by - bry * 0.4;
    } else if (pose === "hug") {
      x1 = cx + s * brx * 1.5;
      y1 = by - bry * 0.3;
    } else if (pose === "hold" || pose === "bow") {
      x1 = cx + s * R * 0.25;
      y1 = by - bry * 0.1;
    } else if (pose === "walk_a" || pose === "walk_b") {
      x1 = cx + s * brx * 1.1 + s * (pose === "walk_a" ? 1 : -1) * 14;
    }
    out.push(`<path d="M${n(x0)} ${n(y0)} Q${n(x1 + s * 10)} ${n((y0 + y1) / 2)} ${n(x1)} ${n(y1)}" fill="none" stroke="${spec.fur}" stroke-width="${n(R * 0.28)}" stroke-linecap="round"/>`);
    out.push(`<circle cx="${n(x1)}" cy="${n(y1 + 4)}" r="${n(R * 0.17)}" fill="${dark}"/>`);
  }
  if (has("scarf")) {
    out.push(`<rect x="${n(cx - R * 0.8)}" y="${n(hy + R * 0.82)}" width="${n(R * 1.6)}" height="${n(R * 0.3)}" rx="${n(R * 0.15)}" fill="${spec.accent}"/>`);
    out.push(`<rect x="${n(cx + R * 0.25)}" y="${n(hy + R * 0.95)}" width="${n(R * 0.26)}" height="${n(R * 0.75)}" rx="10" fill="${mix(spec.accent, "#000000", 0.15)}"/>`);
  }

  // Ears (behind the head outline, drawn first)
  for (const s of [-1, 1]) {
    const ex = cx + s * R * 0.62;
    const ey = hy - R * 0.62;
    if (spec.ears === "pointy") {
      out.push(`<path d="M${n(ex - R * 0.34)} ${n(ey + R * 0.2)} L${n(ex + s * R * 0.1)} ${n(ey - R * 0.72)} L${n(ex + R * 0.34)} ${n(ey + R * 0.2)} Z" fill="${spec.fur}"/>`);
      out.push(`<path d="M${n(ex - R * 0.17)} ${n(ey + R * 0.08)} L${n(ex + s * R * 0.08)} ${n(ey - R * 0.45)} L${n(ex + R * 0.17)} ${n(ey + R * 0.08)} Z" fill="${dark}"/>`);
    }
    if (spec.ears === "round") {
      out.push(`<circle cx="${n(ex)}" cy="${n(ey)}" r="${n(R * 0.32)}" fill="${spec.fur}"/>`);
      out.push(`<circle cx="${n(ex)}" cy="${n(ey)}" r="${n(R * 0.17)}" fill="${spec.belly}"/>`);
    }
    if (spec.ears === "long") {
      out.push(`<ellipse cx="${n(cx + s * R * 0.4)}" cy="${n(hy - R * 1.25)}" rx="${n(R * 0.2)}" ry="${n(R * 0.62)}" fill="${spec.fur}" transform="rotate(${s * 10} ${n(cx + s * R * 0.4)} ${n(hy - R * 1.25)})"/>`);
      out.push(`<ellipse cx="${n(cx + s * R * 0.4)}" cy="${n(hy - R * 1.22)}" rx="${n(R * 0.09)}" ry="${n(R * 0.45)}" fill="${spec.belly}" transform="rotate(${s * 10} ${n(cx + s * R * 0.4)} ${n(hy - R * 1.25)})"/>`);
    }
    if (spec.ears === "horns") {
      out.push(`<path d="M${n(cx + s * R * 0.55)} ${n(hy - R * 0.55)} Q${n(cx + s * R * 1.35)} ${n(hy - R * 0.75)} ${n(cx + s * R * 1.15)} ${n(hy - R * 1.35)} Q${n(cx + s * R * 1.05)} ${n(hy - R * 0.95)} ${n(cx + s * R * 0.62)} ${n(hy - R * 0.8)} Z" fill="#efe6d2"/>`);
      out.push(`<ellipse cx="${n(cx + s * R * 0.98)}" cy="${n(hy - R * 0.2)}" rx="${n(R * 0.26)}" ry="${n(R * 0.13)}" fill="${spec.fur}"/>`);
    }
  }

  // Head, muzzle, face
  out.push(`<circle cx="${cx}" cy="${n(hy)}" r="${n(R)}" fill="url(#${id}-fur)"/>`);
  const fx = cx + cg.faceDx;
  const eyeY = hy - R * 0.08;
  if (spec.muzzle === "pointed") {
    out.push(`<path d="M${n(fx - R * 0.72)} ${n(hy + R * 0.05)} Q${fx} ${n(hy - R * 0.12)} ${n(fx + R * 0.72)} ${n(hy + R * 0.05)} Q${n(fx + R * 0.35)} ${n(hy + R * 0.6)} ${fx} ${n(hy + R * 0.66)} Q${n(fx - R * 0.35)} ${n(hy + R * 0.6)} ${n(fx - R * 0.72)} ${n(hy + R * 0.05)} Z" fill="${spec.belly}"/>`);
  } else if (spec.muzzle === "round") {
    out.push(`<ellipse cx="${fx}" cy="${n(hy + R * 0.34)}" rx="${n(R * 0.42)}" ry="${n(R * 0.3)}" fill="${spec.belly}"/>`);
  } else {
    out.push(`<ellipse cx="${fx}" cy="${n(hy + R * 0.42)}" rx="${n(R * 0.55)}" ry="${n(R * 0.32)}" fill="${spec.belly}"/>`);
    for (const s of [-1, 1]) out.push(`<ellipse cx="${n(fx + s * R * 0.2)}" cy="${n(hy + R * 0.42)}" rx="${n(R * 0.06)}" ry="${n(R * 0.09)}" fill="${dark}"/>`);
  }
  const cf = { ...critterFaceGeometry(spec, R, fx, hy, expr), ...(cg.downcast && { eyesClosed: true }) };
  for (const [k, s] of [[0, -1], [1, 1]] as const) {
    const e = cf.eyes[k];
    if (cf.eyesClosed) out.push(`<path d="M${n(e.x - e.rx * 1.3)} ${n(e.y)} Q${n(e.x)} ${n(e.y + (expr === "laugh" && !cg.downcast ? -1 : 1) * e.ry * 1.2)} ${n(e.x + e.rx * 1.3)} ${n(e.y)}" fill="none" stroke="#1d1a26" stroke-width="${n(R * 0.05)}" stroke-linecap="round"/>`);
    else {
      out.push(`<ellipse cx="${n(e.x)}" cy="${n(e.y)}" rx="${n(e.rx)}" ry="${n(e.ry)}" fill="#1d1a26"/>`);
      out.push(`<circle cx="${n(e.x + R * 0.035)}" cy="${n(e.y - R * 0.045)}" r="${n(R * 0.042)}" fill="#ffffff"/>`);
    }
    if (expr === "sad") out.push(`<path d="M${n(e.x - s * R * 0.14)} ${n(e.y - R * 0.26)} L${n(e.x + s * R * 0.12)} ${n(e.y - R * 0.18)}" stroke="#1d1a26" stroke-width="${n(R * 0.04)}" stroke-linecap="round"/>`);
    if (s !== -look) out.push(`<circle cx="${n(fx + s * R * 0.6)}" cy="${n(e.y + R * 0.3)}" r="${n(R * 0.13)}" fill="#ff8a80" fill-opacity="${expr === "smile" || expr === "laugh" ? 0.5 : 0.35}"/>`);
  }
  const noseY = spec.muzzle === "pointed" ? hy + R * 0.55 : spec.muzzle === "round" ? hy + R * 0.22 : hy + R * 0.3;
  if (spec.muzzle !== "flat") out.push(`<ellipse cx="${fx}" cy="${n(noseY)}" rx="${n(R * 0.11)}" ry="${n(R * 0.08)}" fill="#1d1a26"/>`);
  const mw = R * (expr === "smile" || expr === "laugh" ? 0.18 : 0.12);
  if (expr === "laugh") out.push(`<path d="M${n(fx - mw)} ${n(noseY + R * 0.1)} L${n(fx + mw)} ${n(noseY + R * 0.1)} Q${fx} ${n(noseY + R * 0.34)} ${n(fx - mw)} ${n(noseY + R * 0.1)} Z" fill="#7a2a22"/>`);
  else if (expr === "surprised") out.push(`<ellipse cx="${fx}" cy="${n(noseY + R * 0.18)}" rx="${n(R * 0.06)}" ry="${n(R * 0.08)}" fill="#7a2a22"/>`);
  else if (expr === "sad") out.push(`<path d="M${n(fx - mw)} ${n(noseY + R * 0.2)} Q${fx} ${n(noseY + R * 0.1)} ${n(fx + mw)} ${n(noseY + R * 0.2)}" fill="none" stroke="#1d1a26" stroke-width="${n(R * 0.045)}" stroke-linecap="round"/>`);
  else out.push(`<path d="M${n(fx - mw)} ${n(noseY + R * 0.12)} Q${fx} ${n(noseY + R * (expr === "smile" ? 0.28 : 0.22))} ${n(fx + mw)} ${n(noseY + R * 0.12)}" fill="none" stroke="#1d1a26" stroke-width="${n(R * 0.045)}" stroke-linecap="round"/>`);
  if (has("glasses")) {
    for (const s of [-1, 1]) out.push(`<circle cx="${n(fx + s * R * 0.36)}" cy="${n(eyeY)}" r="${n(R * 0.2)}" fill="none" stroke="#2a2233" stroke-width="4"/>`);
    out.push(`<path d="M${n(fx - R * 0.16)} ${n(eyeY)} L${n(fx + R * 0.16)} ${n(eyeY)}" stroke="#2a2233" stroke-width="4"/>`);
  }
  if (has("bow")) out.push(`<path d="M${n(cx + R * 0.35)} ${n(hy - R * 0.78)} l-24 -16 l0 32 Z M${n(cx + R * 0.35)} ${n(hy - R * 0.78)} l24 -16 l0 32 Z" fill="${spec.accent}"/>`);
  if (has("hat")) {
    out.push(`<ellipse cx="${cx}" cy="${n(hy - R * 0.72)}" rx="${n(R * 1.05)}" ry="${n(R * 0.18)}" fill="${spec.accent}"/>`);
    out.push(`<path d="M${n(cx - R * 0.6)} ${n(hy - R * 0.72)} Q${n(cx - R * 0.6)} ${n(hy - R * 1.45)} ${cx} ${n(hy - R * 1.45)} Q${n(cx + R * 0.6)} ${n(hy - R * 1.45)} ${n(cx + R * 0.6)} ${n(hy - R * 0.72)} Z" fill="${spec.accent}"/>`);
  }
  out.push("</symbol>");
  return out.join("\n");
}

/**
 * Critter pose geometry, shared by the drawing and the face anchors. An animal
 * sits on its haunches (kneel is drawn the same way: animals don't kneel),
 * bows by dropping its head onto its chest with downcast eyes, and turns its
 * head by moving the muzzle and eyes toward the look direction.
 */
function critterHead(spec: CritterSpec, pose: DrawPose) {
  const k = spec.size === "small" ? 0.9 : spec.size === "large" ? 1.08 : 1;
  const R = 100 * k;
  const seated = pose === "sit" || pose === "kneel";
  const seatDrop = seated ? 70 : 0;
  const hy0 = Math.max(600 - 560 * (spec.size === "small" ? 0.86 : 1) + R + 20, spec.ears === "long" ? 1.9 * R + 8 : 0);
  const look = pose === "look-left" ? -1 : pose === "look-right" ? 1 : 0;
  return { R, hy: hy0 + seatDrop + (pose === "bow" ? R * 0.45 : 0), hy0, by: hy0 + R * 2.05 + seatDrop * 0.6, seated, look, faceDx: look * R * 0.3, downcast: pose === "bow" };
}

function critterFaceGeometry(spec: CritterSpec, R: number, cx: number, hy: number, expr: Expression) {
  const eyeY = hy - R * 0.08;
  const big = expr === "surprised" ? 1.3 : 1;
  const eyes = [-1, 1].map((s) => ({ x: cx + s * R * 0.36, y: eyeY, rx: R * 0.1 * big, ry: R * 0.13 * big * (expr === "sleepy" ? 0.5 : 1) }));
  const noseY = spec.muzzle === "pointed" ? hy + R * 0.55 : spec.muzzle === "round" ? hy + R * 0.22 : hy + R * 0.3;
  return { eyes, mouth: { x: cx, y: noseY + R * 0.17, w: R * 0.24 }, eyesClosed: expr === "laugh" || expr === "sleepy" };
}

/** Face anchors of a critter variant in its 400×600 viewBox (for blink + lip-sync overlays). */
export function critterFace(spec: CritterSpec, pose: DrawPose = "stand", expr: Expression = "neutral"): FaceAnchors {
  const { R, hy, by, faceDx, downcast } = critterHead(spec, pose);
  const g0 = critterFaceGeometry(spec, R, 200 + faceDx, hy, expr);
  const g = { ...g0, eyesClosed: g0.eyesClosed || downcast };
  const bry = Math.min(592 - 40 - by, R * 1.25);
  const L = Math.max(10, 592 - 10 - (by + bry * 0.4));
  return { eyes: g.eyes, mouth: g.mouth, skin: spec.fur, eyesClosed: g.eyesClosed, step: 2 * L * Math.sin((WALK_SWING_DEG * Math.PI) / 180), hands: { x: 200, y: by - bry * 0.1 + 4 } };
}
