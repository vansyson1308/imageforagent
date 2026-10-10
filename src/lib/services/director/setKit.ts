import { z } from "zod";

/**
 * Set kit (D41): the Cast describes a set as a small spec and the engine draws
 * it, like the character kit (D22/D24). Hosted runs showed hand-drawn sets as
 * the weakest part of a film ("abstract purple structure", "plain beige
 * background", "flat lighting"). A kit set always has a sky or a wall with
 * light, far / middle / near layers, texture instead of flat blocks, light
 * sources for its time of day, weather, and up to 6 props on fixed slots.
 * Deterministic (no randomness: positions come from a hash of the id).
 */

export const INTERIOR_PLACES = ["kitchen", "living-room", "bedroom", "tea-room", "kissaten", "classroom", "shop", "workshop", "hall"] as const;
export const EXTERIOR_PLACES = ["veranda", "beach", "street", "park", "forest", "countryside", "mountains", "riverside", "garden", "harbor", "village", "market", "snowfield"] as const;
export const SET_TIMES = ["dawn", "day", "golden", "dusk", "night"] as const;
export const SET_WEATHER = ["clear", "cloudy", "rain", "snow", "fog"] as const;
export const SET_PROPS = [
  // interior
  "table", "low-table", "chair", "window", "shelf", "lamp", "stove", "plant", "rug", "door", "clock", "painting", "bed", "counter", "teapot", "siphon", "radio", "stool", "cafe-table", "lantern", "shoji", "bookcase", "sofa", "desk", "blackboard",
  // exterior
  "tree", "cherry-tree", "pine", "house", "boat", "pier", "fence", "streetlamp", "stall", "bench", "rocks", "bridge", "lighthouse", "temple-gate", "flowers",
] as const;
export type SetPlace = (typeof INTERIOR_PLACES)[number] | (typeof EXTERIOR_PLACES)[number];
export type SetTime = (typeof SET_TIMES)[number];
export type SetProp = (typeof SET_PROPS)[number];

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const setSchema = z.object({
  place: z.enum([...INTERIOR_PLACES, ...EXTERIOR_PLACES]),
  time: z.enum(SET_TIMES).default("day"),
  weather: z.enum(SET_WEATHER).default("clear"),
  /** interior: wall colour · exterior: main land colour (hills, grass, sand) */
  main: hex,
  accent: hex,
  /** interior floor / exterior near ground (default: derived from main) */
  ground: hex.optional(),
  props: z.array(z.enum(SET_PROPS)).max(6).default([]),
  /**
   * Culturally specific elements the kit can't draw (an ancestor altar, a stone well, a fūrin, a kite in the sky):
   * the Cast draws each one as a prop symbol `<set-id>-d<n>` and the engine places it in the set (owner QC 2026-10-10).
   */
  dressing: z.array(z.string().trim().min(2).max(60)).max(4).default([]),
});
export type SetSpec = z.infer<typeof setSchema>;

/* Words the Cast used for a place, hour, weather or prop the kit has under another name (showcase v2-banh-chung: a kitchen
   spec with three props outside the list was rejected whole, and the Cast hand-drew a flat set instead). */
const PLACE_ALIASES: Record<string, (typeof INTERIOR_PLACES)[number] | (typeof EXTERIOR_PLACES)[number]> = {
  "living room": "living-room", room: "living-room", home: "living-room", house: "living-room", "family room": "living-room",
  "tea room": "tea-room", tearoom: "tea-room", "tea house": "tea-room", teahouse: "tea-room", washitsu: "tea-room",
  school: "classroom", store: "shop", bakery: "shop", cafe: "kissaten", café: "kissaten", "coffee shop": "kissaten", coffeehouse: "kissaten", "coffee house": "kissaten", "喫茶店": "kissaten", "喫茶": "kissaten", "quán cà phê": "kissaten", restaurant: "shop", studio: "workshop", office: "workshop", temple: "hall",
  courtyard: "garden", yard: "garden", backyard: "garden", porch: "veranda", engawa: "veranda", "縁側": "veranda", "back veranda": "veranda", deck: "veranda", terrace: "veranda",
  sea: "beach", ocean: "beach", shore: "beach", coast: "beach", seaside: "beach", river: "riverside", lake: "riverside", pond: "riverside",
  port: "harbor", harbour: "harbor", dock: "harbor", pier: "harbor", city: "street", town: "street", alley: "street", road: "street",
  field: "countryside", fields: "countryside", farm: "countryside", "rice field": "countryside", "rice paddy": "countryside", meadow: "countryside",
  woods: "forest", jungle: "forest", hill: "mountains", hills: "mountains", mountain: "mountains", snow: "snowfield",
};
const TIME_ALIASES: Record<string, (typeof SET_TIMES)[number]> = { morning: "dawn", sunrise: "dawn", noon: "day", afternoon: "day", daytime: "day", sunset: "golden", evening: "dusk", twilight: "dusk", midnight: "night" };
const WEATHER_ALIASES: Record<string, (typeof SET_WEATHER)[number]> = { sunny: "clear", fair: "clear", overcast: "cloudy", rainy: "rain", storm: "rain", stormy: "rain", drizzle: "rain", snowy: "snow", snowing: "snow", foggy: "fog", mist: "fog", misty: "fog" };
const PROP_ALIASES: Record<string, (typeof SET_PROPS)[number]> = {
  altar: "shelf", cabinet: "shelf", cupboard: "shelf", dresser: "shelf", oven: "stove", fireplace: "stove", hearth: "stove", "cooking pot": "stove", sink: "counter", kettle: "teapot", pot: "teapot",
  couch: "sofa", curtain: "window", curtains: "window", picture: "painting", photo: "painting", frame: "painting", candle: "lantern", lanterns: "lantern", "paper lantern": "lantern",
  books: "bookcase", bookshelf: "bookcase", chalkboard: "blackboard", stool: "stool", "bar stool": "stool", "counter stool": "stool", "cafe table": "cafe-table", "café table": "cafe-table", "small table": "cafe-table", "round table": "cafe-table", "coffee table": "cafe-table", mat: "rug", carpet: "rug", tatami: "rug", flower: "flowers", vase: "flowers",
  "lamp post": "streetlamp", lamppost: "streetlamp", "street lamp": "streetlamp", gate: "temple-gate", torii: "temple-gate", shrine: "temple-gate", ship: "boat", dock: "pier",
  "siphon coffee maker": "siphon", "coffee siphon": "siphon", "coffee maker": "siphon", "tube radio": "radio", "old radio": "radio", "vintage radio": "radio", "wall clock": "clock", "potted plant": "plant", "potted plants": "plant",
  rock: "rocks", stones: "rocks", sakura: "cherry-tree", "cherry blossom": "cherry-tree", stand: "stall", booth: "stall", trees: "tree", houses: "house", plants: "plant",
};

/**
 * A Cast set spec, made usable: names outside the kit's lists are mapped to
 * the kit's word for them, and props the kit has no word for are dropped (a
 * kitchen without its altar is still a lit kitchen; a hand-drawn fallback is a
 * flat one). Returns what changed so the run can say it.
 */
export function normalizeSetSpec(raw: unknown): { spec: unknown; notes: string[] } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { spec: raw, notes: [] };
  const spec: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  const notes: string[] = [];
  const key = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase().replace(/[_]+/g, " ") : "");
  const fix = <T extends string>(field: string, allowed: readonly T[], aliases: Record<string, T>) => {
    const v = key(spec[field]);
    if (!v) return;
    if ((allowed as readonly string[]).includes(v)) {
      spec[field] = v;
      return;
    }
    const mapped = (allowed as readonly string[]).includes(v.replace(/ /g, "-")) ? v.replace(/ /g, "-") : aliases[v];
    if (mapped) {
      notes.push(`${field} "${spec[field]}" → "${mapped}"`);
      spec[field] = mapped;
    }
  };
  fix("place", [...INTERIOR_PLACES, ...EXTERIOR_PLACES], PLACE_ALIASES);
  fix("time", SET_TIMES, TIME_ALIASES);
  fix("weather", SET_WEATHER, WEATHER_ALIASES);
  if (Array.isArray(spec.props)) {
    const kept: string[] = [];
    const dropped: string[] = [];
    for (const p of spec.props) {
      const v = key(p);
      const known = (SET_PROPS as readonly string[]).includes(v) ? v : (SET_PROPS as readonly string[]).includes(v.replace(/ /g, "-")) ? v.replace(/ /g, "-") : PROP_ALIASES[v];
      if (known && !kept.includes(known)) {
        if (known !== p) notes.push(`prop "${p}" → "${known}"`);
        kept.push(known);
      } else if (!known) dropped.push(String(p));
    }
    if (dropped.length) {
      // never dropped silently: they become set dressing, drawn by the Cast and placed by the engine
      const dressing = [...(Array.isArray(spec.dressing) ? (spec.dressing as unknown[]).map(String) : []), ...dropped];
      spec.dressing = [...new Set(dressing)].slice(0, 4);
      notes.push(`props the kit doesn't draw go to the set dressing (the Cast draws them): ${dropped.join(", ")}`);
    }
    if (kept.length > 6) notes.push(`kept the first 6 props of ${kept.length}`);
    spec.props = kept.slice(0, 6);
  }
  return { spec, notes };
}

export const SET_VOCABULARY = [
  `{"place": "${[...INTERIOR_PLACES, ...EXTERIOR_PLACES].join("|")}", "time": "${SET_TIMES.join("|")}", "weather": "${SET_WEATHER.join("|")}",`,
  ` "main": "#rrggbb (interior wall / exterior land)", "accent": "#rrggbb", "ground": "#rrggbb (floor / near ground, optional)",`,
  ` "props": [up to 6 of ${SET_PROPS.map((p) => `"${p}"`).join(", ")}],`,
  ` "dressing": [up to 4 culturally specific elements the kit can't draw, e.g. "ancestor altar with incense", "stone well", "fūrin wind chime", "kite on a string in the sky"]}`,
  `For each dressing item n (1-based) of a set, ALSO draw it in the \`\`\`svg block as <symbol id="<set-id>-d<n>" viewBox="0 0 400 400"> (the object centred, resting on y=400, 5–30 shapes); the engine places it in the set.`,
].join("\n");

export const isInterior = (p: SetPlace) => (INTERIOR_PLACES as readonly string[]).includes(p);

// ---------- helpers ----------

const n = (x: number) => String(Math.round(x * 10) / 10);
function rgb(h: string) {
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
}
function mix(a: string, b: string, t: number): string {
  const pa = rgb(a);
  const pb = rgb(b);
  return `#${pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}
/** deterministic 0..1 from a string and an index */
function rand(seed: string, i: number): number {
  let h = 2166136261 ^ i;
  for (let k = 0; k < seed.length; k++) h = Math.imul(h ^ seed.charCodeAt(k), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Sky colours (top, horizon), sun/moon, light tint per time of day. */
const SKY: Record<SetTime, { top: string; horizon: string; light: string; tint: string; tintOpacity: number; sun: string | null; moon: boolean }> = {
  dawn: { top: "#7d8fc7", horizon: "#f6c6b0", light: "#ffd9b8", tint: "#ff9e80", tintOpacity: 0.1, sun: "#ffe2b8", moon: false },
  day: { top: "#7fb6e8", horizon: "#d9ecf7", light: "#fff6dc", tint: "#ffffff", tintOpacity: 0, sun: "#fff4c9", moon: false },
  golden: { top: "#e7a76a", horizon: "#fbe0a6", light: "#ffd27f", tint: "#ffb347", tintOpacity: 0.12, sun: "#ffe08a", moon: false },
  dusk: { top: "#3d3a72", horizon: "#e48b7d", light: "#ffb08a", tint: "#6a4c93", tintOpacity: 0.18, sun: "#ff9f7a", moon: false },
  night: { top: "#0b1330", horizon: "#283a6e", light: "#ffc870", tint: "#0b1330", tintOpacity: 0.38, sun: null, moon: true },
};

interface Ctx {
  id: string;
  W: number;
  H: number;
  spec: SetSpec;
  defs: string[];
  out: string[];
  sky: (typeof SKY)[SetTime];
  night: boolean;
}

function grad(c: Ctx, name: string, stops: Array<[number, string, number?]>, vertical = true): string {
  const id = `${c.id}-${name}`;
  c.defs.push(`<linearGradient id="${id}" x1="0" y1="0" x2="${vertical ? 0 : 1}" y2="${vertical ? 1 : 0}">${stops.map(([o, col, op]) => `<stop offset="${o}" stop-color="${col}"${op !== undefined ? ` stop-opacity="${op}"` : ""}/>`).join("")}</linearGradient>`);
  return `url(#${id})`;
}
function radial(c: Ctx, name: string, color: string, opacity = 0.8): string {
  const id = `${c.id}-${name}`;
  c.defs.push(`<radialGradient id="${id}"><stop offset="0" stop-color="${color}" stop-opacity="${opacity}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`);
  return `url(#${id})`;
}

// ---------- props ----------

/** Floor/ground props stand on (x, baseY) with a scale; wall props hang at (x, y). */
function drawProp(c: Ctx, p: SetProp, x: number, base: number, s: number): void {
  const o = c.out;
  const wood = mix(c.spec.accent, "#6b4a2b", 0.55);
  const dark = mix(wood, "#1d1a26", 0.35);
  const glow = (gx: number, gy: number, r: number) => o.push(`<circle cx="${n(gx)}" cy="${n(gy)}" r="${n(r)}" fill="${radial(c, `glow-${p}-${Math.round(gx)}`, c.sky.light, c.night ? 0.75 : 0.35)}"/>`);
  switch (p) {
    case "table":
    case "desk":
      o.push(`<rect x="${n(x - 170 * s)}" y="${n(base - 150 * s)}" width="${n(340 * s)}" height="${n(26 * s)}" rx="${n(6 * s)}" fill="${wood}"/>`);
      o.push(`<rect x="${n(x - 170 * s)}" y="${n(base - 128 * s)}" width="${n(340 * s)}" height="${n(8 * s)}" fill="${dark}" fill-opacity="0.5"/>`);
      for (const dx of [-150, 135]) o.push(`<rect x="${n(x + dx * s)}" y="${n(base - 126 * s)}" width="${n(16 * s)}" height="${n(126 * s)}" fill="${dark}"/>`);
      if (p === "desk") o.push(`<rect x="${n(x + 40 * s)}" y="${n(base - 126 * s)}" width="${n(110 * s)}" height="${n(80 * s)}" fill="${wood}"/><circle cx="${n(x + 95 * s)}" cy="${n(base - 88 * s)}" r="${n(5 * s)}" fill="${dark}"/>`);
      break;
    case "low-table":
      o.push(`<ellipse cx="${n(x)}" cy="${n(base - 4 * s)}" rx="${n(190 * s)}" ry="${n(14 * s)}" fill="#000" fill-opacity="0.12"/>`);
      o.push(`<rect x="${n(x - 180 * s)}" y="${n(base - 70 * s)}" width="${n(360 * s)}" height="${n(22 * s)}" rx="${n(5 * s)}" fill="${wood}"/>`);
      for (const dx of [-160, 145]) o.push(`<rect x="${n(x + dx * s)}" y="${n(base - 50 * s)}" width="${n(14 * s)}" height="${n(48 * s)}" fill="${dark}"/>`);
      break;
    case "chair":
      o.push(`<rect x="${n(x - 45 * s)}" y="${n(base - 230 * s)}" width="${n(14 * s)}" height="${n(230 * s)}" fill="${dark}"/>`);
      o.push(`<rect x="${n(x - 45 * s)}" y="${n(base - 110 * s)}" width="${n(100 * s)}" height="${n(16 * s)}" fill="${wood}"/>`);
      o.push(`<rect x="${n(x + 41 * s)}" y="${n(base - 96 * s)}" width="${n(14 * s)}" height="${n(96 * s)}" fill="${dark}"/>`);
      for (let k = 0; k < 3; k++) o.push(`<rect x="${n(x - 45 * s)}" y="${n(base - (220 - k * 34) * s)}" width="${n(14 * s)}" height="${n(6 * s)}" fill="${wood}"/>`);
      break;
    case "stove":
    case "counter":
      o.push(`<rect x="${n(x - 160 * s)}" y="${n(base - 190 * s)}" width="${n(320 * s)}" height="${n(190 * s)}" rx="${n(8 * s)}" fill="${grad(c, `${p}-body-${Math.round(x)}`, [[0, mix(c.spec.accent, "#ffffff", 0.25)], [1, mix(c.spec.accent, "#1d1a26", 0.2)]])}"/>`);
      o.push(`<rect x="${n(x - 170 * s)}" y="${n(base - 200 * s)}" width="${n(340 * s)}" height="${n(18 * s)}" rx="${n(4 * s)}" fill="${mix(c.spec.main, "#ffffff", 0.5)}"/>`);
      for (const dx of [-150, -2]) o.push(`<rect x="${n(x + dx * s)}" y="${n(base - 165 * s)}" width="${n(142 * s)}" height="${n(150 * s)}" rx="${n(6 * s)}" fill="none" stroke="${dark}" stroke-opacity="0.45" stroke-width="${n(4 * s)}"/><circle cx="${n(x + (dx + 125) * s)}" cy="${n(base - 90 * s)}" r="${n(5 * s)}" fill="${dark}"/>`);
      if (p === "stove") {
        for (const dx of [-70, 70]) o.push(`<ellipse cx="${n(x + dx * s)}" cy="${n(base - 205 * s)}" rx="${n(50 * s)}" ry="${n(10 * s)}" fill="#2b2530"/>`);
        o.push(`<path d="M${n(x - 100 * s)} ${n(base - 214 * s)} h${n(80 * s)} v${n(-60 * s)} a${n(40 * s)} ${n(20 * s)} 0 0 0 ${n(-80 * s)} 0 Z" fill="${mix(c.spec.accent, "#3a3a46", 0.6)}"/>`);
        o.push(`<path d="M${n(x - 60 * s)} ${n(base - 300 * s)} q${n(14 * s)} ${n(-20 * s)} 0 ${n(-40 * s)} q${n(-14 * s)} ${n(-20 * s)} 0 ${n(-40 * s)}" fill="none" stroke="#ffffff" stroke-opacity="0.5" stroke-width="${n(5 * s)}" stroke-linecap="round"/>`);
      }
      break;
    case "teapot":
      o.push(`<ellipse cx="${n(x)}" cy="${n(base - 40 * s)}" rx="${n(48 * s)}" ry="${n(40 * s)}" fill="${mix(c.spec.accent, "#3a2a20", 0.3)}"/><path d="M${n(x + 44 * s)} ${n(base - 50 * s)} q${n(36 * s)} ${n(-6 * s)} ${n(44 * s)} ${n(-34 * s)}" fill="none" stroke="${mix(c.spec.accent, "#3a2a20", 0.3)}" stroke-width="${n(10 * s)}" stroke-linecap="round"/><rect x="${n(x - 16 * s)}" y="${n(base - 86 * s)}" width="${n(32 * s)}" height="${n(12 * s)}" rx="${n(5 * s)}" fill="${dark}"/>`);
      o.push(`<path d="M${n(x - 6 * s)} ${n(base - 96 * s)} q${n(10 * s)} ${n(-16 * s)} 0 ${n(-32 * s)}" fill="none" stroke="#ffffff" stroke-opacity="0.45" stroke-width="${n(4 * s)}" stroke-linecap="round"/>`);
      break;
    case "siphon": {
      // siphon coffee maker: stand, lower glass bulb with coffee, upper funnel, a small burner glow
      o.push(`<rect x="${n(x - 46 * s)}" y="${n(base - 12 * s)}" width="${n(92 * s)}" height="${n(12 * s)}" rx="${n(4 * s)}" fill="${dark}"/><rect x="${n(x + 34 * s)}" y="${n(base - 230 * s)}" width="${n(9 * s)}" height="${n(224 * s)}" fill="#8b8f96"/><rect x="${n(x - 4 * s)}" y="${n(base - 160 * s)}" width="${n(46 * s)}" height="${n(7 * s)}" fill="#8b8f96"/>`);
      o.push(`<ellipse cx="${n(x)}" cy="${n(base - 30 * s)}" rx="${n(16 * s)}" ry="${n(10 * s)}" fill="#ffb347" fill-opacity="0.85"/>`);
      o.push(`<circle cx="${n(x)}" cy="${n(base - 82 * s)}" r="${n(44 * s)}" fill="#dfeef5" fill-opacity="0.55" stroke="#ffffff" stroke-opacity="0.8" stroke-width="${n(3 * s)}"/><path d="M${n(x - 42 * s)} ${n(base - 74 * s)} A${n(44 * s)} ${n(44 * s)} 0 0 0 ${n(x + 42 * s)} ${n(base - 74 * s)} Z" fill="#5b3420"/>`);
      o.push(`<rect x="${n(x - 7 * s)}" y="${n(base - 160 * s)}" width="${n(14 * s)}" height="${n(46 * s)}" fill="#dfeef5" fill-opacity="0.7"/><path d="M${n(x - 34 * s)} ${n(base - 250 * s)} L${n(x + 34 * s)} ${n(base - 250 * s)} L${n(x + 20 * s)} ${n(base - 160 * s)} L${n(x - 20 * s)} ${n(base - 160 * s)} Z" fill="#dfeef5" fill-opacity="0.6" stroke="#ffffff" stroke-opacity="0.8" stroke-width="${n(3 * s)}"/>`);
      o.push(`<path d="M${n(x - 18 * s)} ${n(base - 236 * s)} v${n(60 * s)}" stroke="#ffffff" stroke-opacity="0.7" stroke-width="${n(4 * s)}" stroke-linecap="round"/>`);
      break;
    }
    case "radio": {
      // old tube radio: arched wooden cabinet, cloth speaker grille, amber dial, two knobs
      const cab = mix(wood, "#8a5a2e", 0.4);
      o.push(`<path d="M${n(x - 90 * s)} ${n(base)} V${n(base - 120 * s)} Q${n(x - 90 * s)} ${n(base - 190 * s)} ${n(x)} ${n(base - 190 * s)} Q${n(x + 90 * s)} ${n(base - 190 * s)} ${n(x + 90 * s)} ${n(base - 120 * s)} V${n(base)} Z" fill="${cab}"/>`);
      o.push(`<path d="M${n(x - 66 * s)} ${n(base - 70 * s)} V${n(base - 120 * s)} Q${n(x - 66 * s)} ${n(base - 166 * s)} ${n(x)} ${n(base - 166 * s)} Q${n(x + 66 * s)} ${n(base - 166 * s)} ${n(x + 66 * s)} ${n(base - 120 * s)} V${n(base - 70 * s)} Z" fill="#c9b48a"/>`);
      for (let k = -4; k <= 4; k++) o.push(`<path d="M${n(x + k * 13 * s)} ${n(base - 150 * s + Math.abs(k) * 3 * s)} V${n(base - 74 * s)}" stroke="${mix(cab, "#1d1a26", 0.2)}" stroke-opacity="0.45" stroke-width="${n(3 * s)}"/>`);
      o.push(`<rect x="${n(x - 56 * s)}" y="${n(base - 58 * s)}" width="${n(112 * s)}" height="${n(20 * s)}" rx="${n(5 * s)}" fill="#f2c46b"/><path d="M${n(x - 10 * s)} ${n(base - 58 * s)} v${n(20 * s)}" stroke="#7a3a1a" stroke-width="${n(3 * s)}"/>`);
      for (const dx of [-60, 60]) o.push(`<circle cx="${n(x + dx * s)}" cy="${n(base - 22 * s)}" r="${n(11 * s)}" fill="${mix(cab, "#1d1a26", 0.35)}"/>`);
      if (c.night) glow(x, base - 48 * s, 90 * s);
      break;
    }
    case "stool":
      // counter stool: round padded seat on one post, a footrest ring, a round foot
      o.push(`<ellipse cx="${n(x)}" cy="${n(base - 4 * s)}" rx="${n(46 * s)}" ry="${n(10 * s)}" fill="${dark}"/><rect x="${n(x - 6 * s)}" y="${n(base - 190 * s)}" width="${n(12 * s)}" height="${n(186 * s)}" fill="#8b8f96"/>`);
      o.push(`<ellipse cx="${n(x)}" cy="${n(base - 70 * s)}" rx="${n(34 * s)}" ry="${n(8 * s)}" fill="none" stroke="#8b8f96" stroke-width="${n(5 * s)}"/>`);
      o.push(`<rect x="${n(x - 52 * s)}" y="${n(base - 212 * s)}" width="${n(104 * s)}" height="${n(26 * s)}" rx="${n(13 * s)}" fill="${mix(c.spec.accent, "#7a2e22", 0.45)}"/><rect x="${n(x - 48 * s)}" y="${n(base - 192 * s)}" width="${n(96 * s)}" height="${n(8 * s)}" rx="${n(4 * s)}" fill="${dark}"/>`);
      break;
    case "cafe-table":
      // a small round table (pedestal) with a cup and saucer on it
      o.push(`<ellipse cx="${n(x)}" cy="${n(base - 4 * s)}" rx="${n(60 * s)}" ry="${n(12 * s)}" fill="${dark}"/><rect x="${n(x - 9 * s)}" y="${n(base - 150 * s)}" width="${n(18 * s)}" height="${n(146 * s)}" fill="${dark}"/>`);
      o.push(`<ellipse cx="${n(x)}" cy="${n(base - 150 * s)}" rx="${n(120 * s)}" ry="${n(24 * s)}" fill="${wood}"/><ellipse cx="${n(x)}" cy="${n(base - 156 * s)}" rx="${n(116 * s)}" ry="${n(20 * s)}" fill="${mix(wood, "#ffffff", 0.15)}"/>`);
      o.push(`<ellipse cx="${n(x + 20 * s)}" cy="${n(base - 160 * s)}" rx="${n(26 * s)}" ry="${n(6 * s)}" fill="#f6f0e2"/><path d="M${n(x + 6 * s)} ${n(base - 186 * s)} h${n(28 * s)} l${n(-3 * s)} ${n(24 * s)} h${n(-22 * s)} Z" fill="#f6f0e2"/>`);
      break;
    case "plant":
    case "flowers":
      o.push(`<path d="M${n(x - 40 * s)} ${n(base - 80 * s)} L${n(x + 40 * s)} ${n(base - 80 * s)} L${n(x + 30 * s)} ${n(base)} L${n(x - 30 * s)} ${n(base)} Z" fill="${p === "plant" ? mix(c.spec.accent, "#a0522d", 0.5) : "#6b8e4e"}"/>`);
      for (let k = 0; k < 7; k++) {
        const a = -Math.PI / 2 + (k - 3) * 0.32;
        const L = (110 + 40 * rand(c.id, k)) * s;
        const ex = x + Math.cos(a) * L;
        const ey = base - 80 * s + Math.sin(a) * L;
        o.push(`<path d="M${n(x)} ${n(base - 80 * s)} Q${n((x + ex) / 2 + 10 * s)} ${n((base - 80 * s + ey) / 2)} ${n(ex)} ${n(ey)}" fill="none" stroke="${mix("#3f7d4e", c.spec.main, 0.15)}" stroke-width="${n(9 * s)}" stroke-linecap="round"/>`);
        if (p === "flowers") o.push(`<circle cx="${n(ex)}" cy="${n(ey)}" r="${n(13 * s)}" fill="${k % 2 ? c.spec.accent : "#f4c4d0"}"/>`);
      }
      break;
    case "lamp":
    case "lantern": {
      if (p === "lamp") o.push(`<rect x="${n(x - 5 * s)}" y="${n(base - 330 * s)}" width="${n(10 * s)}" height="${n(330 * s)}" fill="${dark}"/><path d="M${n(x - 60 * s)} ${n(base - 330 * s)} L${n(x + 60 * s)} ${n(base - 330 * s)} L${n(x + 36 * s)} ${n(base - 400 * s)} L${n(x - 36 * s)} ${n(base - 400 * s)} Z" fill="${mix(c.spec.accent, "#fff3d6", 0.5)}"/>`);
      else o.push(`<path d="M${n(x)} ${n(base - 330 * s)} v${n(40 * s)}" stroke="${dark}" stroke-width="${n(4 * s)}"/><ellipse cx="${n(x)}" cy="${n(base - 250 * s)}" rx="${n(42 * s)}" ry="${n(56 * s)}" fill="${c.night ? "#ffcf6e" : mix(c.spec.accent, "#ffffff", 0.3)}"/><path d="M${n(x - 42 * s)} ${n(base - 250 * s)} h${n(84 * s)} M${n(x - 38 * s)} ${n(base - 275 * s)} h${n(76 * s)} M${n(x - 38 * s)} ${n(base - 225 * s)} h${n(76 * s)}" stroke="${dark}" stroke-opacity="0.35" stroke-width="${n(3 * s)}"/>`);
      if (c.night || c.spec.time === "dusk") glow(x, base - (p === "lamp" ? 360 : 250) * s, 190 * s);
      break;
    }
    case "rug":
      o.push(`<ellipse cx="${n(x)}" cy="${n(base + 30 * s)}" rx="${n(300 * s)}" ry="${n(46 * s)}" fill="${mix(c.spec.accent, "#ffffff", 0.2)}"/><ellipse cx="${n(x)}" cy="${n(base + 30 * s)}" rx="${n(250 * s)}" ry="${n(34 * s)}" fill="none" stroke="${mix(c.spec.accent, "#1d1a26", 0.2)}" stroke-width="${n(6 * s)}"/>`);
      break;
    case "bed":
      o.push(`<rect x="${n(x - 230 * s)}" y="${n(base - 260 * s)}" width="${n(30 * s)}" height="${n(260 * s)}" rx="${n(8 * s)}" fill="${wood}"/><rect x="${n(x - 210 * s)}" y="${n(base - 130 * s)}" width="${n(440 * s)}" height="${n(80 * s)}" rx="${n(18 * s)}" fill="${mix(c.spec.accent, "#ffffff", 0.45)}"/><rect x="${n(x - 200 * s)}" y="${n(base - 160 * s)}" width="${n(110 * s)}" height="${n(42 * s)}" rx="${n(18 * s)}" fill="#ffffff"/><rect x="${n(x - 60 * s)}" y="${n(base - 140 * s)}" width="${n(290 * s)}" height="${n(92 * s)}" rx="${n(20 * s)}" fill="${c.spec.accent}"/>`);
      for (const dx of [-205, 210]) o.push(`<rect x="${n(x + dx * s)}" y="${n(base - 50 * s)}" width="${n(16 * s)}" height="${n(50 * s)}" fill="${dark}"/>`);
      break;
    case "sofa":
      o.push(`<rect x="${n(x - 240 * s)}" y="${n(base - 210 * s)}" width="${n(480 * s)}" height="${n(120 * s)}" rx="${n(30 * s)}" fill="${mix(c.spec.accent, "#1d1a26", 0.1)}"/><rect x="${n(x - 260 * s)}" y="${n(base - 130 * s)}" width="${n(520 * s)}" height="${n(100 * s)}" rx="${n(26 * s)}" fill="${c.spec.accent}"/>`);
      for (const dx of [-120, 120]) o.push(`<rect x="${n(x + dx * s - 100 * s)}" y="${n(base - 150 * s)}" width="${n(200 * s)}" height="${n(40 * s)}" rx="${n(16 * s)}" fill="${mix(c.spec.accent, "#ffffff", 0.25)}"/>`);
      break;
    case "bookcase":
    case "shelf": {
      const h = p === "bookcase" ? 380 : 40;
      const top = p === "bookcase" ? base - 380 * s : base;
      if (p === "bookcase") o.push(`<rect x="${n(x - 120 * s)}" y="${n(top)}" width="${n(240 * s)}" height="${n(h * s)}" rx="${n(6 * s)}" fill="${dark}"/>`);
      const rows = p === "bookcase" ? 4 : 1;
      for (let r = 0; r < rows; r++) {
        const ry = top + (r + 1) * (p === "bookcase" ? 90 : 0) * s;
        o.push(`<rect x="${n(x - 110 * s)}" y="${n(ry)}" width="${n(220 * s)}" height="${n(10 * s)}" fill="${wood}"/>`);
        for (let k = 0; k < 7; k++) {
          const bh = (50 + 25 * rand(c.id, r * 9 + k)) * s;
          o.push(`<rect x="${n(x - 100 * s + k * 28 * s)}" y="${n(ry - bh)}" width="${n(22 * s)}" height="${n(bh)}" fill="${[c.spec.accent, "#5b7aa6", "#c9a24b", "#8a5a7a", "#6b8e4e"][(k + r) % 5]}"/>`);
        }
      }
      break;
    }
    case "clock":
      o.push(`<circle cx="${n(x)}" cy="${n(base)}" r="${n(46 * s)}" fill="#fbf6ea" stroke="${dark}" stroke-width="${n(8 * s)}"/><path d="M${n(x)} ${n(base)} v${n(-30 * s)} M${n(x)} ${n(base)} h${n(22 * s)}" stroke="#2b2530" stroke-width="${n(5 * s)}" stroke-linecap="round"/>`);
      break;
    case "painting":
      o.push(`<rect x="${n(x - 110 * s)}" y="${n(base - 80 * s)}" width="${n(220 * s)}" height="${n(160 * s)}" fill="${wood}"/><rect x="${n(x - 96 * s)}" y="${n(base - 66 * s)}" width="${n(192 * s)}" height="${n(132 * s)}" fill="${grad(c, `paint-${Math.round(x)}`, [[0, "#9fc5e8"], [0.6, "#f6e3c0"], [1, "#7fa36b"]])}"/><path d="M${n(x - 96 * s)} ${n(base + 40 * s)} Q${n(x - 30 * s)} ${n(base - 30 * s)} ${n(x + 20 * s)} ${n(base + 10 * s)} T${n(x + 96 * s)} ${n(base)} L${n(x + 96 * s)} ${n(base + 66 * s)} L${n(x - 96 * s)} ${n(base + 66 * s)} Z" fill="#6b8e4e"/>`);
      break;
    case "door":
      o.push(`<rect x="${n(x - 110 * s)}" y="${n(base - 470 * s)}" width="${n(220 * s)}" height="${n(470 * s)}" rx="${n(6 * s)}" fill="${wood}"/><rect x="${n(x - 85 * s)}" y="${n(base - 440 * s)}" width="${n(170 * s)}" height="${n(190 * s)}" rx="${n(6 * s)}" fill="none" stroke="${dark}" stroke-width="${n(5 * s)}"/><rect x="${n(x - 85 * s)}" y="${n(base - 220 * s)}" width="${n(170 * s)}" height="${n(190 * s)}" rx="${n(6 * s)}" fill="none" stroke="${dark}" stroke-width="${n(5 * s)}"/><circle cx="${n(x + 75 * s)}" cy="${n(base - 240 * s)}" r="${n(9 * s)}" fill="#e0b84a"/>`);
      break;
    case "blackboard":
      o.push(`<rect x="${n(x - 300 * s)}" y="${n(base - 100 * s)}" width="${n(600 * s)}" height="${n(230 * s)}" rx="${n(6 * s)}" fill="${wood}"/><rect x="${n(x - 285 * s)}" y="${n(base - 85 * s)}" width="${n(570 * s)}" height="${n(200 * s)}" fill="#2f4a3a"/><path d="M${n(x - 240 * s)} ${n(base - 40 * s)} q${n(60 * s)} ${n(-30 * s)} ${n(120 * s)} 0 t${n(120 * s)} 0 M${n(x - 240 * s)} ${n(base + 20 * s)} h${n(260 * s)} M${n(x + 60 * s)} ${n(base + 60 * s)} h${n(150 * s)}" fill="none" stroke="#f1efe6" stroke-opacity="0.7" stroke-width="${n(5 * s)}" stroke-linecap="round"/>`);
      break;
    case "shoji":
      for (let k = 0; k < 3; k++) {
        const sx = x - 300 * s + k * 200 * s;
        o.push(`<rect x="${n(sx)}" y="${n(base - 520 * s)}" width="${n(190 * s)}" height="${n(520 * s)}" fill="${c.night ? "#ffe2a8" : "#f7f1e1"}" fill-opacity="${c.night ? 0.92 : 1}" stroke="${wood}" stroke-width="${n(10 * s)}"/>`);
        for (let r = 1; r < 6; r++) o.push(`<path d="M${n(sx)} ${n(base - 520 * s + r * 86 * s)} h${n(190 * s)}" stroke="${wood}" stroke-width="${n(4 * s)}"/>`);
        o.push(`<path d="M${n(sx + 95 * s)} ${n(base - 520 * s)} v${n(520 * s)}" stroke="${wood}" stroke-width="${n(4 * s)}"/>`);
      }
      if (c.night) glow(x, base - 260 * s, 380 * s);
      break;
    case "window":
      // the room draws its own window; as a wall prop it adds a second one centred on the slot
      drawWindow(c, x, base, 280 * s, 220 * s);
      break;
    // ---- exterior ----
    case "tree":
    case "cherry-tree":
    case "pine": {
      o.push(`<path d="M${n(x - 18 * s)} ${n(base)} L${n(x - 10 * s)} ${n(base - 220 * s)} L${n(x + 10 * s)} ${n(base - 220 * s)} L${n(x + 18 * s)} ${n(base)} Z" fill="${mix("#6b4a2b", c.sky.top, c.night ? 0.4 : 0.1)}"/>`);
      if (p === "pine") for (let k = 0; k < 4; k++) o.push(`<path d="M${n(x - (120 - k * 22) * s)} ${n(base - (150 + k * 70) * s)} L${n(x)} ${n(base - (260 + k * 70) * s)} L${n(x + (120 - k * 22) * s)} ${n(base - (150 + k * 70) * s)} Z" fill="${mix("#2f5d3f", c.sky.top, c.night ? 0.45 : 0.08 + k * 0.03)}"/>`);
      else {
        const leaf = p === "cherry-tree" ? "#f4b6c8" : mix("#4f8a4b", c.spec.main, 0.2);
        for (let k = 0; k < 6; k++) o.push(`<circle cx="${n(x + (rand(c.id, k + 40) - 0.5) * 200 * s)}" cy="${n(base - (240 + rand(c.id, k + 50) * 110) * s)}" r="${n((70 + rand(c.id, k + 60) * 40) * s)}" fill="${mix(leaf, k % 2 ? "#ffffff" : "#1d1a26", c.night ? 0.45 : 0.1)}"/>`);
      }
      break;
    }
    case "house": {
      const wall = mix(c.spec.accent, "#f3e6cf", 0.55);
      o.push(`<rect x="${n(x - 150 * s)}" y="${n(base - 220 * s)}" width="${n(300 * s)}" height="${n(220 * s)}" fill="${mix(wall, c.sky.top, c.night ? 0.5 : 0.05)}"/><path d="M${n(x - 180 * s)} ${n(base - 215 * s)} L${n(x)} ${n(base - 340 * s)} L${n(x + 180 * s)} ${n(base - 215 * s)} Z" fill="${mix(c.spec.accent, "#3a2a20", 0.35)}"/>`);
      for (const dx of [-90, 50]) o.push(`<rect x="${n(x + dx * s)}" y="${n(base - 170 * s)}" width="${n(56 * s)}" height="${n(56 * s)}" fill="${c.night || c.spec.time === "dusk" ? "#ffcf6e" : "#bfd8ea"}" stroke="${mix(wall, "#3a2a20", 0.4)}" stroke-width="${n(5 * s)}"/>`);
      o.push(`<rect x="${n(x - 25 * s)}" y="${n(base - 100 * s)}" width="${n(50 * s)}" height="${n(100 * s)}" fill="${mix(c.spec.accent, "#3a2a20", 0.5)}"/>`);
      if (c.night) glow(x, base - 140 * s, 170 * s);
      break;
    }
    case "boat":
      o.push(`<path d="M${n(x - 150 * s)} ${n(base - 60 * s)} L${n(x + 150 * s)} ${n(base - 60 * s)} L${n(x + 110 * s)} ${n(base)} L${n(x - 110 * s)} ${n(base)} Z" fill="${mix(c.spec.accent, "#3a2a20", 0.2)}"/><path d="M${n(x)} ${n(base - 60 * s)} V${n(base - 280 * s)}" stroke="${mix("#6b4a2b", "#000", 0.2)}" stroke-width="${n(8 * s)}"/><path d="M${n(x + 6 * s)} ${n(base - 270 * s)} L${n(x + 130 * s)} ${n(base - 80 * s)} L${n(x + 6 * s)} ${n(base - 80 * s)} Z" fill="#f7f1e1"/>`);
      break;
    case "pier":
      o.push(`<rect x="${n(x - 320 * s)}" y="${n(base - 70 * s)}" width="${n(640 * s)}" height="${n(22 * s)}" fill="${wood}"/>`);
      for (let k = 0; k < 7; k++) o.push(`<rect x="${n(x - 310 * s + k * 100 * s)}" y="${n(base - 70 * s)}" width="${n(16 * s)}" height="${n(110 * s)}" fill="${dark}"/><rect x="${n(x - 310 * s + k * 100 * s)}" y="${n(base - 130 * s)}" width="${n(12 * s)}" height="${n(60 * s)}" fill="${dark}"/>`);
      o.push(`<path d="M${n(x - 320 * s)} ${n(base - 120 * s)} H${n(x + 320 * s)}" stroke="${wood}" stroke-width="${n(8 * s)}"/>`);
      break;
    case "fence":
      for (let k = 0; k < 9; k++) o.push(`<path d="M${n(x - 280 * s + k * 70 * s)} ${n(base)} v${n(-110 * s)} l${n(12 * s)} ${n(-16 * s)} l${n(12 * s)} ${n(16 * s)} v${n(110 * s)} Z" fill="${mix("#f3ead8", c.sky.top, c.night ? 0.5 : 0.1)}"/>`);
      o.push(`<path d="M${n(x - 290 * s)} ${n(base - 80 * s)} h${n(600 * s)} M${n(x - 290 * s)} ${n(base - 35 * s)} h${n(600 * s)}" stroke="${mix("#e6dcc4", c.sky.top, 0.2)}" stroke-width="${n(10 * s)}"/>`);
      break;
    case "streetlamp":
      o.push(`<rect x="${n(x - 7 * s)}" y="${n(base - 420 * s)}" width="${n(14 * s)}" height="${n(420 * s)}" fill="#2b2f3a"/><path d="M${n(x - 30 * s)} ${n(base - 420 * s)} h${n(60 * s)} l${n(-12 * s)} ${n(-40 * s)} h${n(-36 * s)} Z" fill="${c.night || c.spec.time === "dusk" ? "#ffd27f" : "#d7dbe2"}"/>`);
      if (c.night || c.spec.time === "dusk") glow(x, base - 410 * s, 230 * s);
      break;
    case "stall":
      o.push(`<rect x="${n(x - 170 * s)}" y="${n(base - 120 * s)}" width="${n(340 * s)}" height="${n(120 * s)}" fill="${wood}"/><rect x="${n(x - 160 * s)}" y="${n(base - 300 * s)}" width="${n(10 * s)}" height="${n(180 * s)}" fill="${dark}"/><rect x="${n(x + 150 * s)}" y="${n(base - 300 * s)}" width="${n(10 * s)}" height="${n(180 * s)}" fill="${dark}"/>`);
      for (let k = 0; k < 6; k++) o.push(`<path d="M${n(x - 190 * s + k * 63 * s)} ${n(base - 300 * s)} h${n(63 * s)} v${n(50 * s)} q${n(-31 * s)} ${n(26 * s)} ${n(-63 * s)} 0 Z" fill="${k % 2 ? "#f7f1e1" : c.spec.accent}"/>`);
      for (let k = 0; k < 5; k++) o.push(`<circle cx="${n(x - 120 * s + k * 60 * s)}" cy="${n(base - 140 * s)}" r="${n(22 * s)}" fill="${["#e2571b", "#f4b23c", "#6b8e4e", "#c0392b", "#e8c06a"][k]}"/>`);
      break;
    case "bench":
      o.push(`<rect x="${n(x - 160 * s)}" y="${n(base - 70 * s)}" width="${n(320 * s)}" height="${n(18 * s)}" rx="${n(5 * s)}" fill="${wood}"/><rect x="${n(x - 160 * s)}" y="${n(base - 130 * s)}" width="${n(320 * s)}" height="${n(14 * s)}" rx="${n(5 * s)}" fill="${wood}"/>`);
      for (const dx of [-140, 125]) o.push(`<rect x="${n(x + dx * s)}" y="${n(base - 130 * s)}" width="${n(14 * s)}" height="${n(130 * s)}" fill="${dark}"/>`);
      break;
    case "rocks":
      for (let k = 0; k < 4; k++) o.push(`<ellipse cx="${n(x + (k - 1.5) * 70 * s)}" cy="${n(base - 20 * s)}" rx="${n((50 + 20 * rand(c.id, k + 70)) * s)}" ry="${n((30 + 14 * rand(c.id, k + 80)) * s)}" fill="${mix("#8a8f99", c.sky.top, c.night ? 0.4 : 0.1 + k * 0.05)}"/>`);
      break;
    case "bridge":
      o.push(`<path d="M${n(x - 340 * s)} ${n(base)} Q${n(x)} ${n(base - 220 * s)} ${n(x + 340 * s)} ${n(base)}" fill="none" stroke="${mix(c.spec.accent, "#3a2a20", 0.2)}" stroke-width="${n(28 * s)}"/>`);
      for (let k = 1; k < 8; k++) {
        const t = k / 8;
        const bx = x - 340 * s + 680 * s * t;
        const by = base - 4 * 220 * s * t * (1 - t) / 2 - 220 * s * 2 * t * (1 - t);
        o.push(`<path d="M${n(bx)} ${n(by)} v${n(-60 * s)}" stroke="${mix(c.spec.accent, "#3a2a20", 0.35)}" stroke-width="${n(8 * s)}"/>`);
      }
      break;
    case "lighthouse":
      o.push(`<path d="M${n(x - 50 * s)} ${n(base)} L${n(x - 32 * s)} ${n(base - 400 * s)} L${n(x + 32 * s)} ${n(base - 400 * s)} L${n(x + 50 * s)} ${n(base)} Z" fill="#f7f1e1"/>`);
      for (let k = 0; k < 3; k++) o.push(`<path d="M${n(x - 46 * s + k * 6 * s)} ${n(base - (60 + k * 120) * s)} L${n(x + 46 * s - k * 6 * s)} ${n(base - (60 + k * 120) * s)} L${n(x + 43 * s - k * 6 * s)} ${n(base - (110 + k * 120) * s)} L${n(x - 43 * s + k * 6 * s)} ${n(base - (110 + k * 120) * s)} Z" fill="${c.spec.accent}"/>`);
      o.push(`<rect x="${n(x - 30 * s)}" y="${n(base - 450 * s)}" width="${n(60 * s)}" height="${n(50 * s)}" fill="${c.night ? "#ffd27f" : "#d7e6f2"}"/><path d="M${n(x - 40 * s)} ${n(base - 450 * s)} L${n(x)} ${n(base - 490 * s)} L${n(x + 40 * s)} ${n(base - 450 * s)} Z" fill="${mix(c.spec.accent, "#1d1a26", 0.3)}"/>`);
      if (c.night) glow(x, base - 425 * s, 260 * s);
      break;
    case "temple-gate":
      o.push(`<rect x="${n(x - 180 * s)}" y="${n(base - 360 * s)}" width="${n(26 * s)}" height="${n(360 * s)}" fill="#c0392b"/><rect x="${n(x + 154 * s)}" y="${n(base - 360 * s)}" width="${n(26 * s)}" height="${n(360 * s)}" fill="#c0392b"/><path d="M${n(x - 250 * s)} ${n(base - 380 * s)} Q${n(x)} ${n(base - 410 * s)} ${n(x + 250 * s)} ${n(base - 380 * s)} L${n(x + 240 * s)} ${n(base - 350 * s)} Q${n(x)} ${n(base - 375 * s)} ${n(x - 240 * s)} ${n(base - 350 * s)} Z" fill="#2b2530"/><rect x="${n(x - 200 * s)}" y="${n(base - 300 * s)}" width="${n(400 * s)}" height="${n(22 * s)}" fill="#c0392b"/>`);
      break;
  }
}

function drawWindow(c: Ctx, x: number, y: number, w: number, h: number): void {
  const o = c.out;
  const view = grad(c, `win-${Math.round(x)}`, [[0, c.sky.top], [1, c.sky.horizon]]);
  o.push(`<rect x="${n(x - w / 2 - 14)}" y="${n(y - h / 2 - 14)}" width="${n(w + 28)}" height="${n(h + 28)}" rx="6" fill="${mix(c.spec.accent, "#6b4a2b", 0.55)}"/>`);
  o.push(`<rect x="${n(x - w / 2)}" y="${n(y - h / 2)}" width="${n(w)}" height="${n(h)}" fill="${view}"/>`);
  if (c.night) {
    o.push(`<circle cx="${n(x + w * 0.22)}" cy="${n(y - h * 0.18)}" r="${n(h * 0.12)}" fill="#f6f1d8"/>`);
    for (let k = 0; k < 5; k++) o.push(`<circle cx="${n(x - w / 2 + w * rand(c.id, k + 90))}" cy="${n(y - h / 2 + h * 0.6 * rand(c.id, k + 95))}" r="2.5" fill="#ffffff"/>`);
  } else o.push(`<path d="M${n(x - w / 2)} ${n(y + h * 0.28)} Q${n(x - w * 0.1)} ${n(y + h * 0.05)} ${n(x + w * 0.2)} ${n(y + h * 0.25)} T${n(x + w / 2)} ${n(y + h * 0.2)} V${n(y + h / 2)} H${n(x - w / 2)} Z" fill="${mix("#7fa36b", c.sky.horizon, 0.3)}"/>`);
  o.push(`<path d="M${n(x)} ${n(y - h / 2)} V${n(y + h / 2)} M${n(x - w / 2)} ${n(y)} H${n(x + w / 2)}" stroke="${mix(c.spec.accent, "#6b4a2b", 0.55)}" stroke-width="10"/>`);
  o.push(`<rect x="${n(x - w / 2 - 24)}" y="${n(y + h / 2 + 10)}" width="${n(w + 48)}" height="14" rx="4" fill="${mix(c.spec.accent, "#6b4a2b", 0.4)}"/>`);
}

// ---------- rooms ----------

function room(c: Ctx): void {
  if (c.spec.place === "kissaten") return kissaten(c);
  const { W, H, spec, out: o } = c;
  const floorY = H * 0.7;
  const wall = spec.main;
  const floor = spec.ground ?? mix(spec.accent, "#8a6a4a", 0.6);
  const tea = spec.place === "tea-room";
  o.push(`<rect width="${W}" height="${n(floorY + 2)}" fill="${grad(c, "wall", [[0, mix(wall, "#1d1a26", 0.12)], [0.55, wall], [1, mix(wall, "#ffffff", 0.08)]])}"/>`);
  // wall texture: vertical paper/plank lines + a wainscot
  for (let k = 1; k < 16; k++) o.push(`<path d="M${n((W / 16) * k)} 0 V${n(floorY * 0.62)}" stroke="${mix(wall, "#1d1a26", 0.3)}" stroke-opacity="${c.night ? 0.5 : 0.25}" stroke-width="4"/>`);
  o.push(`<rect y="${n(floorY * 0.62)}" width="${W}" height="${n(floorY * 0.38)}" fill="${grad(c, "wainscot", [[0, mix(wall, spec.accent, 0.35)], [1, mix(wall, "#1d1a26", 0.25)]])}"/>`);
  o.push(`<rect y="${n(floorY * 0.62 - 8)}" width="${W}" height="14" fill="${mix(spec.accent, "#6b4a2b", 0.5)}"/>`);
  for (let k = 1; k < 24; k++) o.push(`<path d="M${n((W / 24) * k)} ${n(floorY * 0.62 + 6)} V${n(floorY)}" stroke="${mix(wall, "#1d1a26", 0.3)}" stroke-opacity="0.35" stroke-width="3"/>`);
  // ceiling beam
  o.push(`<rect width="${W}" height="38" fill="${mix(spec.accent, "#3a2a20", 0.45)}"/>`);
  // floor with perspective boards (tatami grid in a tea room)
  o.push(`<rect y="${n(floorY)}" width="${W}" height="${n(H - floorY)}" fill="${grad(c, "floor", [[0, mix(floor, "#1d1a26", 0.15)], [1, mix(floor, "#ffffff", 0.12)]])}"/>`);
  o.push(`<rect y="${n(floorY)}" width="${W}" height="10" fill="${mix(floor, "#1d1a26", 0.35)}"/>`);
  if (tea) {
    // tatami weave: fine rows that read as rush matting (and keep the cells from being flat blocks)
    for (let k = 1; k < 18; k++) o.push(`<path d="M0 ${n(floorY + ((H - floorY) * k) / 18)} H${W}" stroke="${mix(floor, "#1d1a26", 0.35)}" stroke-opacity="${c.night ? 0.55 : 0.3}" stroke-width="3"/>`);
    for (let k = 0; k < 5; k++) o.push(`<path d="M${n(W * (0.1 + k * 0.2))} ${n(floorY)} L${n(W * (k * 0.25 - 0.0))} ${n(H)}" stroke="#2e3a2a" stroke-opacity="0.5" stroke-width="5"/>`);
    o.push(`<path d="M0 ${n(floorY + (H - floorY) * 0.45)} H${W}" stroke="#2e3a2a" stroke-opacity="0.5" stroke-width="5"/>`);
  } else for (let k = -6; k <= 6; k++) o.push(`<path d="M${n(W / 2 + k * 90)} ${n(floorY)} L${n(W / 2 + k * 260)} ${n(H)}" stroke="${mix(floor, "#1d1a26", 0.3)}" stroke-opacity="0.4" stroke-width="3"/>`);
  // the room's window (shoji in a tea room) and its light on the floor
  const wx = W * 0.5;
  if (tea) drawProp(c, "shoji", wx, floorY - 10, 0.85);
  else drawWindow(c, wx, floorY * 0.33, 380, 300);
  if (!c.night) o.push(`<path d="M${n(wx - 190)} ${n(floorY * 0.33 + 150)} L${n(wx + 190)} ${n(floorY * 0.33 + 150)} L${n(wx + 420)} ${n(H)} L${n(wx - 120)} ${n(H)} Z" fill="${c.sky.light}" fill-opacity="${c.spec.time === "golden" ? 0.22 : 0.14}"/>`);
  // props on slots: wall props on the wall, floor props along the floor line
  const wallProps: SetProp[] = ["clock", "painting", "shelf", "blackboard", "window"];
  const floorSlots = [0.17, 0.83, 0.34, 0.66];
  const wallSlots = [0.18, 0.82, 0.32];
  let f = 0;
  let w = 0;
  for (const p of spec.props) {
    if (p === "rug") drawProp(c, p, W * 0.5, floorY + (H - floorY) * 0.45, 1);
    else if (wallProps.includes(p)) drawProp(c, p, W * wallSlots[w++ % wallSlots.length], floorY * (p === "blackboard" ? 0.36 : 0.3), 1);
    else drawProp(c, p, W * floorSlots[f++ % floorSlots.length], floorY + 90, p === "teapot" ? 1.3 : 1.55);
  }
}

/**
 * A small Showa-era kissaten (owner decision C, 2026-10-10): warm cream walls
 * over dark wood, a large window with the light of the hour, a wooden counter
 * with a siphon coffee maker and teapots, a shelf with cups and an old tube
 * radio, a round wall clock and potted plants. The furniture is built in; the
 * spec's props add to it. Scaled to the canvas, so 9:16 Shorts work too.
 */
function kissaten(c: Ctx): void {
  const { W, H, spec, out: o } = c;
  const floorY = H * 0.72;
  const k = Math.min(W / 1920, H / 1080);
  const wall = spec.main;
  const wood = mix(spec.accent, "#5a3a22", 0.6);
  const floor = spec.ground ?? mix(wood, "#a07850", 0.45);
  o.push(`<rect width="${W}" height="${n(floorY + 2)}" fill="${grad(c, "wall", [[0, mix(wall, "#3a2a20", 0.14)], [0.6, wall], [1, mix(wall, "#ffffff", 0.06)]])}"/>`);
  // plaster texture, a dark wood wainscot and picture rail, ceiling beams
  for (let i = 0; i < 26; i++) o.push(`<path d="M${n(W * rand(c.id, i + 3000))} ${n(floorY * 0.1 + floorY * 0.4 * rand(c.id, i + 3100))} q${n(30 * k)} ${n(-6 * k)} ${n(60 * k)} 0" fill="none" stroke="${mix(wall, "#3a2a20", 0.2)}" stroke-opacity="0.18" stroke-width="3"/>`);
  o.push(`<rect y="${n(floorY * 0.64)}" width="${W}" height="${n(floorY * 0.36)}" fill="${grad(c, "wainscot", [[0, mix(wood, "#ffffff", 0.08)], [1, mix(wood, "#1d1a26", 0.2)]])}"/>`);
  for (let i = 1; i < 20; i++) o.push(`<path d="M${n((W / 20) * i)} ${n(floorY * 0.64 + 8)} V${n(floorY)}" stroke="${mix(wood, "#1d1a26", 0.35)}" stroke-opacity="0.5" stroke-width="3"/>`);
  o.push(`<rect y="${n(floorY * 0.64 - 10)}" width="${W}" height="16" fill="${mix(wood, "#1d1a26", 0.2)}"/>`);
  o.push(`<rect width="${W}" height="${n(46 * Math.max(k, 0.7))}" fill="${mix(wood, "#1d1a26", 0.3)}"/>`);
  for (const bx of [0.18, 0.5, 0.82]) o.push(`<rect x="${n(W * bx - 22 * k)}" y="0" width="${n(44 * k)}" height="${n(floorY * 0.06)}" fill="${mix(wood, "#1d1a26", 0.38)}"/>`);
  // wooden floor boards
  o.push(`<rect y="${n(floorY)}" width="${W}" height="${n(H - floorY)}" fill="${grad(c, "floor", [[0, mix(floor, "#1d1a26", 0.18)], [1, mix(floor, "#ffffff", 0.1)]])}"/>`);
  for (let i = -8; i <= 8; i++) o.push(`<path d="M${n(W / 2 + i * 70 * k)} ${n(floorY)} L${n(W / 2 + i * 240 * k)} ${H}" stroke="${mix(floor, "#1d1a26", 0.35)}" stroke-opacity="0.4" stroke-width="3"/>`);
  // the large window and its light (warm in the afternoon)
  const wx = W * (W > H ? 0.62 : 0.6);
  const ww = W * (W > H ? 0.4 : 0.66);
  const wh = floorY * (W > H ? 0.5 : 0.36);
  const wy = floorY * (W > H ? 0.36 : 0.3);
  drawWindow(c, wx, wy, ww, wh);
  if (!c.night) {
    o.push(`<path d="M${n(wx - ww / 2)} ${n(wy + wh / 2)} L${n(wx + ww / 2)} ${n(wy + wh / 2)} L${n(wx + ww * 0.95)} ${n(H)} L${n(wx - ww * 0.15)} ${n(H)} Z" fill="${c.sky.light}" fill-opacity="${spec.time === "golden" ? 0.26 : 0.16}"/>`);
    o.push(`<rect x="${n(wx - ww / 2)}" y="${n(wy - wh / 2)}" width="${n(ww)}" height="${n(wh)}" fill="${radial(c, "winglow", c.sky.light, 0.35)}"/>`);
  }
  drawProp(c, "plant", wx + ww * 0.38, wy + wh / 2 + 4, 0.55 * k);
  // the round wall clock, a shelf with cups and the tube radio
  const clockX = W > H ? W * 0.9 : W * 0.16;
  drawProp(c, "clock", clockX, floorY * (W > H ? 0.24 : 0.14), 1.1 * Math.max(k, 0.75));
  const shelfX = W > H ? W * 0.2 : W * 0.3;
  const shelfY = floorY * (W > H ? 0.3 : 0.56);
  o.push(`<rect x="${n(shelfX - 230 * k)}" y="${n(shelfY)}" width="${n(460 * k)}" height="${n(16 * k)}" fill="${mix(wood, "#1d1a26", 0.15)}"/>`);
  for (let i = 0; i < 4; i++) {
    const cx = shelfX + (60 + i * 46) * k;
    o.push(`<path d="M${n(cx - 16 * k)} ${n(shelfY - 30 * k)} h${n(32 * k)} l${n(-4 * k)} ${n(30 * k)} h${n(-24 * k)} Z" fill="${["#f6f0e2", "#c96f4a", "#f6f0e2", "#7f9a7a"][i]}"/>`);
  }
  drawProp(c, "radio", shelfX - 110 * k, shelfY, 1.0 * k);
  // the counter along the back wall: siphon and teapots on top
  const cX = W > H ? W * 0.26 : W * 0.3;
  const cs = 1.45 * k * (W > H ? 1 : 1.6);
  const cBase = floorY + 30 * k;
  drawProp(c, "counter", cX, cBase, cs);
  const top = cBase - 200 * cs;
  drawProp(c, "siphon", cX - 70 * cs, top, 0.75 * cs);
  drawProp(c, "teapot", cX + 50 * cs, top, 0.75 * cs);
  drawProp(c, "teapot", cX + 125 * cs, top, 0.6 * cs);
  // a tall potted plant in the corner
  drawProp(c, "plant", W * 0.92, floorY + 70 * k, 1.3 * Math.max(k, 0.7));
  // customer seating (owner QC 2026-10-10: the stories seat guests): two stools at the counter, a small table for two by the window
  for (const dx of [-90, 75]) drawProp(c, "stool", cX + dx * cs, floorY + 70 * k, 0.95 * cs);
  const ts = 1.15 * k * (W > H ? 1 : 1.5);
  const tX = W * (W > H ? 0.74 : 0.72);
  const tBase = floorY + (W > H ? 150 : 260) * k;
  cafeChair(c, tX - 165 * ts, tBase - 10 * ts, ts, 1);
  cafeChair(c, tX + 165 * ts, tBase - 10 * ts, ts, -1);
  drawProp(c, "cafe-table", tX, tBase, ts);
  // the spec's own props on the free floor slots
  const built = new Set<SetProp>(["counter", "siphon", "teapot", "radio", "clock", "plant", "window", "stool", "cafe-table", "chair"]);
  const slots = [0.66, 0.5, 0.08];
  let f = 0;
  for (const p of spec.props) if (!built.has(p)) drawProp(c, p, W * slots[f++ % slots.length], floorY + 90 * k, (p === "rug" ? 1 : 1.4) * k);
}

/** A wooden café chair seen from the side, its back away from the table (`facing` 1 = the table is to the right). */
function cafeChair(c: Ctx, x: number, base: number, s: number, facing: 1 | -1): void {
  const wood = mix(c.spec.accent, "#6b4a2b", 0.55);
  const dark = mix(wood, "#1d1a26", 0.35);
  const bx = x - facing * 48 * s;
  c.out.push(`<rect x="${n(bx - 7 * s)}" y="${n(base - 230 * s)}" width="${n(14 * s)}" height="${n(230 * s)}" rx="${n(4 * s)}" fill="${dark}"/>`);
  for (let k = 0; k < 3; k++) c.out.push(`<rect x="${n(Math.min(bx, bx + facing * 20 * s) - 7 * s)}" y="${n(base - (220 - k * 32) * s)}" width="${n(34 * s)}" height="${n(8 * s)}" rx="${n(3 * s)}" fill="${wood}"/>`);
  c.out.push(`<rect x="${n(Math.min(bx, x + facing * 50 * s) - 7 * s)}" y="${n(base - 112 * s)}" width="${n(Math.abs(x + facing * 50 * s - bx) + 14 * s)}" height="${n(16 * s)}" rx="${n(5 * s)}" fill="${wood}"/>`);
  c.out.push(`<rect x="${n(x + facing * 44 * s - 6 * s)}" y="${n(base - 98 * s)}" width="${n(12 * s)}" height="${n(98 * s)}" fill="${dark}"/>`);
}

/** A back veranda (縁側) at the hour: the garden beyond, wooden deck boards in front, the eaves above, a shoji edge. */
function veranda(c: Ctx): void {
  const { W, H, spec, out: o } = c;
  landscape({ ...c, spec: { ...spec, props: [] } });
  const k = Math.min(W / 1920, H / 1080);
  // the garden beyond: low shrubs with a lit rim and clumps of susuki (owner QC 2026-10-10: no dark blobs)
  const groundY = H * 0.74;
  const leaf = mix(spec.main, c.night ? "#1b2a3a" : "#3f6b4a", c.night ? 0.55 : 0.25);
  const rim = c.night ? "#c9d3e6" : mix(spec.main, "#ffffff", 0.35);
  for (let i = 0; i < 6; i++) {
    const sx = W * (0.12 + i * 0.16 + 0.04 * (rand(c.id, i + 1500) - 0.5));
    const sw = (170 + 90 * rand(c.id, i + 1510)) * k * (W > H ? 1 : 1.4);
    const sh = (70 + 40 * rand(c.id, i + 1520)) * k * (W > H ? 1 : 1.4);
    const top = groundY + 10 * k - sh;
    let d = `M${n(sx - sw / 2)} ${n(groundY + 30 * k)}`;
    for (let j = 0; j <= 4; j++) d += ` Q${n(sx - sw / 2 + (sw * (j + 0.5)) / 5)} ${n(top - 18 * k * rand(c.id, i * 10 + j))} ${n(sx - sw / 2 + (sw * (j + 1)) / 5)} ${n(top + 12 * k + 10 * k * rand(c.id, i * 10 + j + 5))}`;
    o.push(`<path d="${d} L${n(sx + sw / 2)} ${n(groundY + 30 * k)} Z" fill="${leaf}"/>`);
    o.push(`<path d="M${n(sx - sw * 0.35)} ${n(top + 8 * k)} Q${n(sx)} ${n(top - 10 * k)} ${n(sx + sw * 0.3)} ${n(top + 10 * k)}" fill="none" stroke="${rim}" stroke-opacity="${c.night ? 0.45 : 0.35}" stroke-width="${n(4 * Math.max(k, 0.6))}" stroke-linecap="round"/>`);
  }
  const plume = c.night ? "#d8d2bc" : "#e2cf9e";
  for (const [i, fx] of [[0, 0.3], [1, 0.62], [2, 0.88]] as const) {
    const bx = W * fx;
    const by = groundY + 40 * k;
    const tall = 300 * k * (W > H ? 1 : 1.4);
    for (let j = 0; j < 9; j++) {
      const a = (j - 4) * 0.11 + (rand(c.id, i * 20 + j + 1600) - 0.5) * 0.08;
      const L = tall * (0.7 + 0.3 * rand(c.id, i * 20 + j + 1620));
      const tx = bx + Math.sin(a) * L + 30 * k;
      const ty = by - Math.cos(a) * L;
      o.push(`<path d="M${n(bx)} ${n(by)} Q${n(bx + Math.sin(a) * L * 0.5)} ${n(by - L * 0.55)} ${n(tx)} ${n(ty)}" fill="none" stroke="${mix(leaf, plume, 0.35)}" stroke-width="${n(3 * Math.max(k, 0.6))}"/>`);
      o.push(`<path d="M${n(tx)} ${n(ty)} q${n(18 * k)} ${n(14 * k)} ${n(40 * k)} ${n(48 * k)}" fill="none" stroke="${plume}" stroke-opacity="0.85" stroke-width="${n(9 * Math.max(k, 0.6))}" stroke-linecap="round"/>`);
    }
  }
  const deckY = H * 0.8;
  const wood = mix(spec.accent, "#7a5233", 0.55);
  const lit = c.night ? mix(wood, "#0b1330", 0.35) : wood;
  o.push(`<rect y="${n(deckY)}" width="${W}" height="${n(H - deckY)}" fill="${grad(c, "deck", [[0, mix(lit, "#ffffff", 0.08)], [1, mix(lit, "#1d1a26", 0.22)]])}"/>`);
  for (let i = 1; i < 6; i++) o.push(`<path d="M0 ${n(deckY + ((H - deckY) * i) / 6)} H${W}" stroke="${mix(lit, "#1d1a26", 0.4)}" stroke-opacity="0.55" stroke-width="3"/>`);
  o.push(`<rect y="${n(deckY - 10)}" width="${W}" height="14" fill="${mix(lit, "#1d1a26", 0.3)}"/>`);
  // eaves and a post, a shoji panel at the house side (warm at night)
  o.push(`<path d="M0 0 H${W} V${n(H * 0.07)} Q${n(W / 2)} ${n(H * 0.1)} 0 ${n(H * 0.07)} Z" fill="${mix(lit, "#1d1a26", 0.45)}"/>`);
  o.push(`<rect x="${n(W * 0.08)}" y="${n(H * 0.06)}" width="${n(34 * Math.max(k, 0.6))}" height="${n(deckY - H * 0.06)}" fill="${mix(lit, "#1d1a26", 0.35)}"/>`);
  drawProp(c, "shoji", -40 * k, deckY, 0.9 * Math.max(k, 0.6));
  const slots = [0.55, 0.78, 0.35];
  spec.props.forEach((p, i) => drawProp(c, p, W * slots[i % slots.length], deckY + 40 * k, 1.1 * k));
}

// ---------- exteriors ----------

function landscape(c: Ctx): void {
  const { W, H, spec, out: o, sky } = c;
  const horizon = H * (spec.place === "mountains" ? 0.58 : 0.52);
  o.push(`<rect width="${W}" height="${n(horizon + 40)}" fill="${grad(c, "sky", [[0, sky.top], [1, sky.horizon]])}"/>`);
  if (sky.sun) {
    const sx = spec.time === "dawn" ? W * 0.2 : spec.time === "dusk" || spec.time === "golden" ? W * 0.78 : W * 0.72;
    const sy = spec.time === "day" ? H * 0.16 : horizon - 70;
    o.push(`<circle cx="${n(sx)}" cy="${n(sy)}" r="260" fill="${radial(c, "sunglow", sky.sun, 0.55)}"/><circle cx="${n(sx)}" cy="${n(sy)}" r="62" fill="${sky.sun}"/>`);
  }
  if (sky.moon) {
    o.push(`<circle cx="${n(W * 0.8)}" cy="${n(H * 0.17)}" r="200" fill="${radial(c, "moonglow", "#f6f1d8", 0.3)}"/><circle cx="${n(W * 0.8)}" cy="${n(H * 0.17)}" r="54" fill="#f6f1d8"/>`);
    for (let k = 0; k < 40; k++) o.push(`<circle cx="${n(W * rand(c.id, k))}" cy="${n(horizon * 0.8 * rand(c.id, k + 200))}" r="${n(1.5 + 2 * rand(c.id, k + 400))}" fill="#ffffff" fill-opacity="${n(0.5 + 0.5 * rand(c.id, k + 600))}"/>`);
  }
  // clouds
  const cloudy = spec.weather !== "clear";
  for (let k = 0; k < (cloudy ? 6 : 3); k++) {
    const cx = W * (0.08 + 0.18 * k + 0.05 * rand(c.id, k + 10));
    const cy = H * (0.1 + 0.12 * rand(c.id, k + 20));
    const col = c.night ? "#3a4a7a" : cloudy ? "#d8dde6" : "#ffffff";
    o.push(`<g fill="${col}" fill-opacity="${c.night ? 0.6 : 0.85}"><ellipse cx="${n(cx)}" cy="${n(cy)}" rx="110" ry="34"/><ellipse cx="${n(cx + 60)}" cy="${n(cy - 22)}" rx="70" ry="38"/><ellipse cx="${n(cx - 50)}" cy="${n(cy - 12)}" rx="60" ry="30"/></g>`);
  }
  // far layer: hills / mountains in aerial perspective
  const far = mix(spec.main, sky.horizon, 0.6);
  if (spec.place === "mountains" || spec.place === "snowfield" || spec.place === "village") {
    o.push(`<path d="M0 ${n(horizon)} L${n(W * 0.12)} ${n(horizon - 260)} L${n(W * 0.25)} ${n(horizon - 120)} L${n(W * 0.42)} ${n(horizon - 340)} L${n(W * 0.6)} ${n(horizon - 140)} L${n(W * 0.78)} ${n(horizon - 300)} L${W} ${n(horizon - 90)} L${W} ${n(horizon + 40)} L0 ${n(horizon + 40)} Z" fill="${far}"/>`);
    o.push(`<path d="M${n(W * 0.42 - 70)} ${n(horizon - 250)} L${n(W * 0.42)} ${n(horizon - 340)} L${n(W * 0.42 + 80)} ${n(horizon - 240)} Z M${n(W * 0.78 - 60)} ${n(horizon - 225)} L${n(W * 0.78)} ${n(horizon - 300)} L${n(W * 0.78 + 66)} ${n(horizon - 220)} Z" fill="#f7f9fc" fill-opacity="${c.night ? 0.5 : 0.9}"/>`);
  } else o.push(`<path d="M0 ${n(horizon - 40)} Q${n(W * 0.2)} ${n(horizon - 150)} ${n(W * 0.42)} ${n(horizon - 60)} T${n(W * 0.8)} ${n(horizon - 90)} T${W} ${n(horizon - 50)} L${W} ${n(horizon + 40)} L0 ${n(horizon + 40)} Z" fill="${far}"/>`);
  // middle layer per place (always on a filled middle ground: no transparent band)
  const water = ["beach", "harbor", "riverside"].includes(spec.place);
  const groundY = H * 0.74;
  if (!water) o.push(`<rect y="${n(horizon - 10)}" width="${W}" height="${n(groundY - horizon + 60)}" fill="${grad(c, "midground", [[0, mix(spec.place === "snowfield" ? "#e9eef5" : spec.main, sky.horizon, 0.5)], [1, mix(spec.place === "snowfield" ? "#e9eef5" : spec.main, sky.horizon, 0.2)]])}"/>`);
  if (water) {
    const sea = c.night ? "#1f3560" : spec.time === "golden" || spec.time === "dusk" ? mix("#3d78b5", sky.horizon, 0.35) : "#3d86c6";
    o.push(`<rect y="${n(horizon)}" width="${W}" height="${n(groundY - horizon + 30)}" fill="${grad(c, "sea", [[0, mix(sea, sky.horizon, 0.35)], [1, sea]])}"/>`);
    for (let k = 0; k < 9; k++) {
      const wy = horizon + 18 + k * ((groundY - horizon) / 9);
      o.push(`<path d="M${n(W * rand(c.id, k + 300) * 0.4)} ${n(wy)} q40 -10 80 0 t80 0 t80 0 M${n(W * 0.5 + W * rand(c.id, k + 320) * 0.4)} ${n(wy + 6)} q40 -10 80 0 t80 0" fill="none" stroke="#ffffff" stroke-opacity="${n(0.25 + 0.04 * k)}" stroke-width="3"/>`);
    }
    if (sky.sun && spec.time !== "day") o.push(`<path d="M${n(W * 0.74)} ${n(horizon)} L${n(W * 0.82)} ${n(horizon)} L${n(W * 0.9)} ${n(groundY)} L${n(W * 0.66)} ${n(groundY)} Z" fill="${sky.sun}" fill-opacity="0.25"/>`);
  } else if (spec.place === "street" || spec.place === "village" || spec.place === "market") {
    for (let k = 0; k < 7; k++) {
      const hx = k * (W / 6.5) - 40;
      const hh = 220 + 120 * rand(c.id, k + 500);
      const col = mix([spec.accent, "#e8d8c0", "#c9a27a", "#b5c7d3"][k % 4], sky.horizon, c.night ? 0.55 : 0.25);
      o.push(`<rect x="${n(hx)}" y="${n(groundY - hh)}" width="${n(W / 6.5 - 12)}" height="${n(hh)}" fill="${col}"/><path d="M${n(hx - 12)} ${n(groundY - hh)} L${n(hx + W / 13 - 6)} ${n(groundY - hh - 70)} L${n(hx + W / 6.5)} ${n(groundY - hh)} Z" fill="${mix(col, "#3a2a20", 0.35)}"/>`);
      for (let r = 0; r < 2; r++) for (let q = 0; q < 2; q++) o.push(`<rect x="${n(hx + 40 + q * 120)}" y="${n(groundY - hh + 40 + r * 90)}" width="54" height="54" fill="${c.night || spec.time === "dusk" ? (rand(c.id, k * 4 + r * 2 + q) > 0.3 ? "#ffcf6e" : "#2b3150") : mix("#bfd8ea", sky.top, 0.2)}"/>`);
    }
  } else if (spec.place === "forest" || spec.place === "park" || spec.place === "garden") {
    const count = spec.place === "forest" ? 14 : 7;
    for (let k = 0; k < count; k++) {
      const tx = W * ((k + 0.5) / count) + 40 * (rand(c.id, k + 700) - 0.5);
      const r = (spec.place === "forest" ? 90 : 70) + 30 * rand(c.id, k + 710);
      o.push(`<circle cx="${n(tx)}" cy="${n(groundY - 120 - 40 * rand(c.id, k + 720))}" r="${n(r)}" fill="${mix(mix("#3f7d4e", spec.main, 0.3), sky.horizon, c.night ? 0.55 : 0.3)}"/>`);
    }
  } else if (spec.place !== "veranda") {
    // countryside / mountains / snowfield: rolling fields
    for (let k = 0; k < 3; k++) o.push(`<path d="M0 ${n(groundY - 120 + k * 40)} Q${n(W * 0.3)} ${n(groundY - 190 + k * 50)} ${n(W * 0.6)} ${n(groundY - 110 + k * 40)} T${W} ${n(groundY - 130 + k * 40)} L${W} ${n(groundY + 40)} L0 ${n(groundY + 40)} Z" fill="${mix(spec.place === "snowfield" ? "#e9eef5" : spec.main, sky.horizon, 0.45 - k * 0.15)}"/>`);
  }
  // near ground with texture
  const ground = spec.ground ?? (spec.place === "beach" ? "#ecd9b0" : spec.place === "snowfield" ? "#f2f5fa" : spec.place === "street" || spec.place === "market" ? "#b9b1a6" : mix(spec.main, "#3f7d4e", 0.3));
  const g0 = c.night ? mix(ground, "#0b1330", 0.45) : ground;
  o.push(`<path d="M0 ${n(groundY)} Q${n(W * 0.35)} ${n(groundY - 26)} ${n(W * 0.6)} ${n(groundY - 6)} T${W} ${n(groundY - 14)} L${W} ${H} L0 ${H} Z" fill="${grad(c, "ground", [[0, mix(g0, "#ffffff", 0.08)], [1, mix(g0, "#1d1a26", 0.18)]])}"/>`);
  for (let k = 0; k < 46; k++) {
    const gx = W * rand(c.id, k + 800);
    const gy = groundY + 20 + (H - groundY - 30) * rand(c.id, k + 850);
    if (spec.place === "beach" || spec.place === "snowfield") o.push(`<circle cx="${n(gx)}" cy="${n(gy)}" r="${n(2 + 3 * rand(c.id, k + 900))}" fill="${mix(g0, "#1d1a26", 0.2)}" fill-opacity="0.5"/>`);
    else if (spec.place === "street" || spec.place === "market") o.push(`<path d="M${n(gx)} ${n(gy)} h${n(40 + 40 * rand(c.id, k + 900))}" stroke="${mix(g0, "#1d1a26", 0.25)}" stroke-opacity="0.45" stroke-width="3"/>`);
    else o.push(`<path d="M${n(gx)} ${n(gy)} l-6 -18 M${n(gx)} ${n(gy)} l4 -22 M${n(gx)} ${n(gy)} l10 -14" stroke="${mix(g0, "#1d1a26", 0.3)}" stroke-width="3" stroke-linecap="round"/>`);
  }
  // props on ground slots (far ones smaller)
  const slots: Array<[number, number, number]> = [
    [0.14, groundY + 10, 1],
    [0.86, groundY + 10, 1],
    [0.32, groundY - 20, 0.7],
    [0.68, groundY - 20, 0.7],
    [0.5, groundY - 40, 0.55],
    [0.05, groundY + 60, 1.15],
  ];
  spec.props.forEach((p, i) => {
    const [sx, sy, sc] = slots[i % slots.length];
    if (p === "boat" && water) drawProp(c, p, W * sx, (horizon + groundY) / 2 + 40, sc * 0.9);
    else drawProp(c, p, W * sx, sy, sc);
  });
}

function weather(c: Ctx): void {
  const { W, H, spec, out: o } = c;
  if (spec.weather === "rain") for (let k = 0; k < 90; k++) o.push(`<path d="M${n(W * rand(c.id, k + 1000))} ${n(H * rand(c.id, k + 1100))} l-12 34" stroke="#cfdcef" stroke-opacity="0.55" stroke-width="3" stroke-linecap="round"/>`);
  if (spec.weather === "snow") for (let k = 0; k < 110; k++) o.push(`<circle cx="${n(W * rand(c.id, k + 1200))}" cy="${n(H * rand(c.id, k + 1300))}" r="${n(3 + 4 * rand(c.id, k + 1400))}" fill="#ffffff" fill-opacity="0.85"/>`);
  if (spec.weather === "fog") o.push(`<rect y="${n(H * 0.35)}" width="${W}" height="${n(H * 0.45)}" fill="${grad(c, "fog", [[0, "#ffffff", 0], [0.5, "#eef1f5", 0.55], [1, "#ffffff", 0]])}"/>`);
}

/** One set as a <symbol> (viewBox = the canvas) with its gradients, ids prefixed by `id`. */
/** Dressing that belongs in the sky (a kite, the moon, fireworks), hanging from the ceiling (a fūrin, a lantern), or stands on the ground. */
export function dressingSpot(name: string): "sky" | "hanging" | "ground" {
  const n = name.toLowerCase();
  // hanging first: "chime" contains "chim" (bird)
  if (/chime|fūrin|furin|風鈴|lantern|lồng đèn|đèn lồng|提灯|bell|chuông|mobile|garland/.test(n)) return "hanging";
  if (/kite|diều|凧|moon|trăng|月|firework|pháo hoa|花火|balloon|\bbird|\bchim\b|鳥|\bstar|\bsao\b|星|cloud/.test(n)) return "sky";
  return "ground";
}

/**
 * The dressing items' <use>s, placed by kind: sky items high in the sky, hanging items under the ceiling (or a
 * branch), ground items against the back wall or on the far ground, centred on free slots, behind the characters.
 */
function dressingLayer(c: Ctx, items: ReadonlyArray<{ id: string; name: string }>): void {
  const { W, H } = c;
  const interior = isInterior(c.spec.place);
  const base = interior ? H * 0.7 + 30 : H * 0.74 + 20;
  const slots = { sky: [0.3, 0.62, 0.45], hanging: [0.3, 0.7, 0.5], ground: interior ? [0.25, 0.75, 0.12, 0.88] : [0.24, 0.76, 0.42, 0.58] };
  const used = { sky: 0, hanging: 0, ground: 0 };
  for (const it of items) {
    const spot = dressingSpot(it.name);
    const x = W * slots[spot][used[spot]++ % slots[spot].length];
    const size = spot === "sky" ? H * 0.17 : spot === "hanging" ? H * 0.18 : H * (interior ? 0.3 : 0.24);
    const top = spot === "sky" ? H * 0.1 : spot === "hanging" ? 40 : base - size;
    c.out.push(`<use href="#${it.id}" x="${n(x - size / 2)}" y="${n(top)}" width="${n(size)}" height="${n(size)}"/>`);
  }
}

export function buildSet(id: string, spec: SetSpec, canvas: { w: number; h: number } = { w: 1920, h: 1080 }, dressing: ReadonlyArray<{ id: string; name: string }> = []): string {
  const sky = SKY[spec.time];
  const c: Ctx = { id, W: canvas.w, H: canvas.h, spec, defs: [], out: [], sky, night: spec.time === "night" };
  if (isInterior(spec.place)) room(c);
  else if (spec.place === "veranda") veranda(c);
  else landscape(c);
  // culturally specific elements drawn by the Cast, under the light of the hour like the rest of the set
  dressingLayer(c, dressing);
  weather(c);
  // light of the hour over everything, then a soft vignette
  if (sky.tintOpacity) c.out.push(`<rect width="${c.W}" height="${c.H}" fill="${sky.tint}" fill-opacity="${sky.tintOpacity}"/>`);
  const vid = `${id}-vignette`;
  c.defs.push(`<radialGradient id="${vid}" cx="0.5" cy="0.5" r="0.75"><stop offset="0.6" stop-color="#1d1a26" stop-opacity="0"/><stop offset="1" stop-color="#1d1a26" stop-opacity="${c.night ? 0.45 : 0.22}"/></radialGradient>`);
  c.out.push(`<rect width="${c.W}" height="${c.H}" fill="url(#${vid})"/>`);
  return [...c.defs, `<symbol id="${id}" viewBox="0 0 ${c.W} ${c.H}">`, ...c.out, "</symbol>"].join("\n");
}
