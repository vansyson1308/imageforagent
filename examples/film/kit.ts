/**
 * Film kit — reusable building blocks for "Đèn Ông Sao" (and any film made
 * with this engine): colour script (time-of-day palettes), sky backdrops,
 * low-poly sets, characters with hair/hats/props (solid `attach`), and exact
 * camera framing helpers built on the engine's own projection.
 *
 * Everything here is pure and deterministic (seeded hashing, no Math.random),
 * so the same screenplay always produces the same film.
 */
import { viewMatrix } from "@/lib/services/construct/camera";
import { transformPoint } from "@/lib/services/construct/math3d";
import { figureProportions } from "@/lib/services/construct/partFigure";

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Json = Record<string, unknown>;

/** DCI Flat logical canvas (1.85:1) — the film is authored at native cinema size. */
export const CANVAS = { w: 1998, h: 1080 } as const;

// ---------------------------------------------------------------------------
// Deterministic helpers
// ---------------------------------------------------------------------------

/** Hash → [0,1): stable across runs/platforms (xorshift on a string seed). */
export function rand(seed: string, i = 0): number {
  let h = 2166136261 ^ i;
  for (let k = 0; k < seed.length; k++) h = Math.imul(h ^ seed.charCodeAt(k), 16777619);
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export const r1 = (v: number) => Math.round(v * 10) / 10;
export const r3 = (v: number) => Math.round(v * 1000) / 1000;

const hexToRgb = (hex: string): Vec3 => {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};
const toLin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (l: number) => Math.round(255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055));

/** Mix two colours in linear light (t = 0 → a, 1 → b). */
export function mix(a: string, b: string, t: number): string {
  const [ca, cb] = [hexToRgb(a), hexToRgb(b)];
  const out = ca.map((c, i) => toSrgb(toLin(c) * (1 - t) + toLin(cb[i]) * t));
  return `#${out.map((c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, "0")).join("")}`;
}

// ---------------------------------------------------------------------------
// Colour script — one palette per time of day
// ---------------------------------------------------------------------------

export interface Palette {
  readonly name: string;
  /** Sky gradient top → horizon. */
  readonly sky: readonly [string, string, string];
  /** Global tint every set colour is pulled toward, and how much. */
  readonly tint: string;
  readonly tintAmount: number;
  readonly light: { direction: Vec3; ambient: number; tones: number };
  /** Aerial perspective colour (depthFade). */
  readonly haze: string;
  readonly hazeStrength: number;
  readonly sun?: { at: Vec2; r: number; color: string; halo: string };
  readonly moon?: { at: Vec2; r: number; color: string; halo: string };
  readonly stars: number;
  readonly mountains: readonly [string, string];
  readonly vignette: number;
}

export const PALETTES = {
  dawn: {
    name: "dawn",
    sky: ["#5d6fa3", "#e8a2a0", "#f7d3a1"],
    tint: "#f2b7a0",
    tintAmount: 0.12,
    light: { direction: [0.7, -1.1, -0.6], ambient: 0.5, tones: 4 },
    haze: "#f0c0b0",
    hazeStrength: 0.22,
    sun: { at: [1500, 640], r: 58, color: "#fff1c9", halo: "#ffd29a" },
    stars: 0,
    mountains: ["#9a86a8", "#c49aa6"],
    vignette: 0.25,
  },
  day: {
    name: "day",
    sky: ["#4f8fd0", "#8fc2ea", "#dcefff"],
    tint: "#fff4dc",
    tintAmount: 0.06,
    light: { direction: [-0.45, -1.6, -0.7], ambient: 0.38, tones: 4 },
    haze: "#cfe3f2",
    hazeStrength: 0.16,
    sun: { at: [380, 170], r: 50, color: "#fffbe8", halo: "#fff2b8" },
    stars: 0,
    mountains: ["#7fa3b8", "#a7c3cf"],
    vignette: 0.18,
  },
  dusk: {
    name: "dusk",
    sky: ["#3a3f78", "#c96f6a", "#f6b26b"],
    tint: "#ffa0a0",
    tintAmount: 0.12,
    light: { direction: [-0.9, -0.5, -0.4], ambient: 0.36, tones: 4 },
    haze: "#e59a7a",
    hazeStrength: 0.26,
    sun: { at: [420, 700], r: 64, color: "#ffe2a8", halo: "#ff9f5a" },
    stars: 12,
    mountains: ["#6b4f7a", "#9a6477"],
    vignette: 0.3,
  },
  night: {
    name: "night",
    sky: ["#0b1030", "#1c2a5a", "#34487a"],
    tint: "#3a5296",
    tintAmount: 0.36,
    light: { direction: [0.5, -1.0, -0.8], ambient: 0.4, tones: 4 },
    haze: "#34487e",
    hazeStrength: 0.26,
    moon: { at: [1560, 190], r: 62, color: "#fbf3d2", halo: "#f7e7a8" },
    stars: 90,
    mountains: ["#141d42", "#1f2c58"],
    vignette: 0.4,
  },
  festival: {
    name: "festival",
    sky: ["#0d1236", "#2a2860", "#5a3a6a"],
    tint: "#f08a48",
    tintAmount: 0.22,
    light: { direction: [0.3, -1.2, -1.0], ambient: 0.4, tones: 4 },
    haze: "#5a3a60",
    hazeStrength: 0.22,
    moon: { at: [1000, 150], r: 78, color: "#fff4cf", halo: "#ffdf8a" },
    stars: 60,
    mountains: ["#1a1a44", "#2c2556"],
    vignette: 0.35,
  },
} satisfies Record<string, Palette>;

export type PaletteName = keyof typeof PALETTES;

/** Set colour under the palette's light. */
export const tone = (hex: string, p: Palette) => mix(hex, p.tint, p.tintAmount);

// ---------------------------------------------------------------------------
// Sky backdrop (static SVG layer under the 3D scene)
// ---------------------------------------------------------------------------

function ridge(seed: string, baseY: number, amp: number, step: number): string {
  const pts: string[] = [];
  for (let x = -40, i = 0; x <= CANVAS.w + 40; x += step, i++) {
    const y = baseY - amp * (0.35 + 0.65 * rand(seed, i)) * (0.6 + 0.4 * Math.sin(i * 0.9 + rand(seed, 99) * 6));
    pts.push(`${x} ${r1(y)}`);
  }
  return `M -40 ${CANVAS.h} L ${pts.join(" L ")} L ${CANVAS.w + 40} ${CANVAS.h} Z`;
}

export interface SkyOptions {
  /** Screen y of the far mountains' foot (≈ horizon). */
  horizon?: number;
  mountains?: boolean;
  /** Move the moon/sun (e.g. moonrise across shots). */
  moonAt?: Vec2;
  sunAt?: Vec2;
  clouds?: number;
  /** Extra SVG drawn over the sky (e.g. lantern glows far away). */
  extra?: string;
  /** Scale the moon/sun disc (legend + hero shots). */
  moonScale?: number;
}

export function sky(p: Palette, o: SkyOptions = {}): string {
  const id = `sky-${p.name}`;
  const horizon = o.horizon ?? 620;
  const parts: string[] = [
    `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="${p.sky[0]}"/><stop offset="0.62" stop-color="${p.sky[1]}"/>` +
      `<stop offset="1" stop-color="${p.sky[2]}"/></linearGradient>` +
      `<radialGradient id="${id}-halo"><stop offset="0" stop-color="#ffffff" stop-opacity="0.55"/>` +
      `<stop offset="0.35" stop-color="#ffffff" stop-opacity="0.18"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>` +
      `<radialGradient id="${id}-glow"><stop offset="0" stop-color="${(p.moon ?? p.sun)?.halo ?? "#ffffff"}" stop-opacity="0.35"/>` +
      `<stop offset="1" stop-color="${(p.moon ?? p.sun)?.halo ?? "#ffffff"}" stop-opacity="0"/></radialGradient></defs>`,
    `<rect width="${CANVAS.w}" height="${CANVAS.h}" fill="url(#${id})"/>`,
  ];
  for (let i = 0; i < p.stars; i++) {
    const x = r1(rand(`${id}-sx`, i) * CANVAS.w);
    const y = r1(rand(`${id}-sy`, i) * horizon * 0.8);
    const r = r1(0.8 + rand(`${id}-sr`, i) * 1.8);
    parts.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="#fff8e0" opacity="${r3(0.35 + 0.6 * rand(`${id}-so`, i))}"/>`);
  }
  let orb = p.moon ?? p.sun;
  if (orb) {
    const [cx, cy] = (p.moon ? o.moonAt : o.sunAt) ?? orb.at;
    const k = o.moonScale ?? 1;
    orb = { ...orb, r: orb.r * k };
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${orb.r * 4.2}" fill="url(#${id}-glow)"/>`);
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${orb.r * 2}" fill="url(#${id}-halo)"/>`);
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${orb.r}" fill="${orb.color}"/>`);
    if (p.moon) {
      // the silhouette of the banyan tree + chú Cuội on the moon (legend)
      parts.push(
        `<path transform="translate(${cx} ${cy}) scale(${r3(k)})" d="M -8 22 q 3 -14 1 -24 q -14 -2 -18 -12 q 10 2 16 -2 q -2 -10 8 -14 q 10 6 6 16 q 10 -2 14 6 q -8 6 -18 6 q 0 12 4 24 Z" fill="${mix(orb.color, "#b8a878", 0.45)}" opacity="0.55"/>`,
      );
    }
  }
  for (let i = 0; i < (o.clouds ?? (p.name === "day" ? 5 : p.name === "night" || p.name === "festival" ? 2 : 3)); i++) {
    const x = r1(120 + rand(`${id}-cx`, i) * (CANVAS.w - 240));
    const y = r1(90 + rand(`${id}-cy`, i) * horizon * 0.45);
    const w = 90 + rand(`${id}-cw`, i) * 140;
    const c = p.name === "night" || p.name === "festival" ? mix(p.sky[1], "#8090c0", 0.3) : mix(p.sky[2], "#ffffff", 0.6);
    const op = p.name === "night" || p.name === "festival" ? 0.35 : 0.85;
    parts.push(
      `<g fill="${c}" opacity="${op}"><ellipse cx="${x}" cy="${y}" rx="${r1(w)}" ry="${r1(w * 0.28)}"/>` +
        `<ellipse cx="${r1(x - w * 0.35)}" cy="${r1(y - w * 0.12)}" rx="${r1(w * 0.45)}" ry="${r1(w * 0.3)}"/>` +
        `<ellipse cx="${r1(x + w * 0.25)}" cy="${r1(y - w * 0.18)}" rx="${r1(w * 0.5)}" ry="${r1(w * 0.36)}"/></g>`,
    );
  }
  if (o.mountains !== false) {
    parts.push(`<path d="${ridge(`${id}-m1`, horizon - 40, 170, 120)}" fill="${p.mountains[0]}"/>`);
    parts.push(`<path d="${ridge(`${id}-m2`, horizon + 10, 110, 90)}" fill="${p.mountains[1]}"/>`);
  }
  if (o.extra) parts.push(o.extra);
  return parts.join("");
}

// ---------------------------------------------------------------------------
// Camera — exact framing with the engine's own projection
// ---------------------------------------------------------------------------

export interface Cam {
  readonly az: number;
  readonly el: number;
  readonly zoom: number;
}

/** World point → screen offset from `place.at` (orthographic). */
export function project(cam: Cam, p: Vec3): Vec2 {
  const v = transformPoint(viewMatrix({ azimuth: cam.az, elevation: cam.el, roll: 0 }), p);
  return [v[0] * cam.zoom, -v[1] * cam.zoom];
}

/** Screen y of the ground's far edge (z = farZ) — where the backdrop horizon must sit. */
export function horizonFor(cam: Cam, place: Vec2, farZ = GROUND_FAR_Z): number {
  return r1(place[1] + project(cam, [0, 0, farZ])[1]);
}

/** `place.at` that puts world point `p` at screen point `screen`. */
export function placeFor(cam: Cam, p: Vec3, screen: Vec2): Vec2 {
  const s = project(cam, p);
  return [r1(screen[0] - s[0]), r1(screen[1] - s[1])];
}

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

export interface CastMember {
  readonly id: string;
  readonly height: number;
  readonly headCount: number;
  readonly fills: { skin: string; shirt: string; pants: string; shoes: string };
  readonly hair: { color: string; style: "bob" | "bun" | "short" | "none" };
  readonly hat?: "non-la";
}

export const CAST = {
  ti: {
    id: "ti",
    height: 118,
    headCount: 3,
    fills: { skin: "#f2c49b", shirt: "#d94a38", pants: "#2e4a6b", shoes: "#3a2a22" },
    hair: { color: "#1d1a22", style: "bob" },
  },
  ba: {
    id: "ba",
    height: 150,
    headCount: 4.2,
    fills: { skin: "#e3b48c", shirt: "#7a5a8c", pants: "#2c2a33", shoes: "#3a2a22" },
    hair: { color: "#cfcfd6", style: "bun" },
  },
  lan: {
    id: "lan",
    height: 112,
    headCount: 3,
    fills: { skin: "#f0c7a0", shirt: "#f2b632", pants: "#6a4c93", shoes: "#3a2a22" },
    hair: { color: "#2a1c18", style: "bun" },
  },
  bo: {
    id: "bo",
    height: 176,
    headCount: 5,
    fills: { skin: "#d9a57a", shirt: "#3f7f6a", pants: "#3a3530", shoes: "#2a2622" },
    hair: { color: "#1d1a22", style: "short" },
    hat: "non-la",
  },
} satisfies Record<string, CastMember>;

export type CastName = keyof typeof CAST;

export interface Placed {
  at: Vec3;
  rotate?: Vec3;
  pose?: Record<string, number | Vec3>;
  face?: { mouthOpen?: number; blink?: number };
  /** Rim/soft effects on the hero (costs effect budget — heroes only). */
  hero?: boolean;
}

/** Figure part + hair/hat solids attached to its head joint. */
export function character(m: CastMember, pl: Placed, p: Palette, id: string = m.id): { part: Json; solids: Json[] } {
  const headR = figureProportions(m.height, m.headCount).head * 0.5;
  const solids: Json[] = [];
  const hair = tone(m.hair.color, p);
  if (m.hair.style !== "none") {
    solids.push({
      id: `${id}Hair`,
      type: "sphere",
      r: r1(headR * 1.06),
      segments: 14,
      at: [0, r1(headR * 0.14), r1(-headR * 0.22)],
      scale: [1, m.hair.style === "short" ? 0.9 : 0.97, 1],
      fill: hair,
      attach: { part: id, joint: "head" },
    });
    if (m.hair.style === "bun") {
      solids.push({
        id: `${id}Bun`,
        type: "sphere",
        r: r1(headR * 0.42),
        segments: 10,
        at: [0, r1(headR * 0.55), r1(-headR * 0.95)],
        fill: hair,
        attach: { part: id, joint: "head" },
      });
    }
  }
  if (m.hat === "non-la") {
    solids.push({
      id: `${id}Hat`,
      type: "cone",
      r: r1(headR * 2.1),
      h: r1(headR * 1.25),
      segments: 16,
      at: [0, r1(headR * 0.62), 0],
      fill: tone("#e8d49a", p),
      attach: { part: id, joint: "head" },
    });
  }
  const f = m.fills;
  const part: Json = {
    id,
    type: "figure",
    height: m.height,
    headCount: m.headCount,
    at: pl.at,
    rotate: pl.rotate ?? [0, 0, 0],
    pose: pl.pose ?? {},
    fills: { skin: tone(f.skin, p), shirt: tone(f.shirt, p), pants: tone(f.pants, p), shoes: tone(f.shoes, p) },
    face: { mouthOpen: pl.face?.mouthOpen ?? 0, blink: pl.face?.blink ?? 0 },
  };
  if (pl.hero) part.effects = { rim: { color: p.name === "night" || p.name === "festival" ? "#9fb8ff" : "#fff1d0" } };
  return { part, solids };
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** 2D star profile for the star lantern (đèn ông sao). */
export function starShape(id: string, rOuter = 26): Json {
  return { id, type: "star", points: 5, rOuter, rInner: r1(rOuter * 0.45) };
}

/**
 * Star lantern on a stick, held in the right hand of `holder`. `lit` makes
 * it glow (candle inside). `torn` = the broken lantern after the storm.
 */
export function starLantern(
  id: string,
  holder: string | null,
  p: Palette,
  o: { lit?: boolean; torn?: boolean; at?: Vec3; rotate?: Vec3; scale?: number; grip?: "fist" | "raised" } = {},
): { shapes: Json[]; solids: Json[] } {
  const paper = o.torn ? mix("#b3473a", "#6b5a4a", 0.45) : "#e8412f";
  const shapes = [starShape(`${id}Profile`, 26 * (o.scale ?? 1))];
  const attach = holder ? { attach: { part: holder, joint: "wristR" } } : {};
  const stickLen = 64;
  // Wrist frame: forearm runs along local −y. "fist" (forearm forward) → local +z is world up;
  // "raised" (arm overhead) → the stick continues the arm along −y.
  const raised = o.grip === "raised";
  const solids: Json[] = [];
  if (holder) {
    solids.push({
      id: `${id}Stick`,
      type: "cylinder",
      r: 1.8,
      h: stickLen,
      segments: 6,
      at: raised ? [0, -stickLen * 0.42, 0] : [0, -4, stickLen * 0.42],
      rotate: raised ? [0, 0, 0] : [90, 0, 0],
      fill: tone("#9a7a4a", p),
      shading: "faceted",
      shadow: false,
      ...attach,
    });
  }
  solids.push({
    id,
    type: "extrude",
    profile: `${id}Profile`,
    depth: 7,
    at: holder ? (raised ? [0, -stickLen * 0.95, 0] : [0, -4, stickLen * 0.9]) : (o.at ?? [0, 0, 0]),
    rotate: holder ? (raised ? [0, 0, 180] : [90, 0, 0]) : (o.rotate ?? [0, 0, 0]),
    fill: o.lit ? "#ff6a3d" : tone(paper, p),
    shading: "faceted",
    shadow: false,
    ...(o.lit ? { effects: { glow: { mode: "halo", color: "#ffb347", size: 2.6, opacity: 0.55 } } } : {}),
    ...attach,
  });
  return { shapes, solids };
}

/** A round paper lantern hanging (festival strings). */
export function paperLantern(id: string, at: Vec3, color: string, lit: boolean): Json {
  return {
    id,
    type: "sphere",
    r: 11,
    segments: 8,
    at,
    scale: [1, 1.25, 1],
    fill: color,
    shading: "faceted",
    shadow: false,
    ...(lit ? { effects: { glow: { mode: "halo", color: mix(color, "#ffd28a", 0.5), size: 2.4, opacity: 0.45 } } } : {}),
  };
}

/** The firefly spirit (Đom Đóm): a glowing mote with two tiny wings. */
export function firefly(id: string, at: Vec3, big = false): Json[] {
  const r = big ? 9 : 4.5;
  return [
    {
      id,
      type: "sphere",
      r,
      segments: 8,
      at,
      fill: "#fff7a1",
      shading: "none",
      shadow: false,
      effects: { glow: { mode: "halo", color: "#e8ff8a", size: big ? 4 : 3.4, opacity: big ? 0.7 : 0.5 } },
    },
  ];
}

// ---------------------------------------------------------------------------
// Sets (low-poly, quantized light — cheap to render, compress well)
// ---------------------------------------------------------------------------

export interface SetPiece {
  shapes: Json[];
  solids: Json[];
  parts: Json[];
  /** FK frames (a house rotates as one). */
  groups: Json[];
}

export const emptySet = (): SetPiece => ({ shapes: [], solids: [], parts: [], groups: [] });

export function merge(...xs: Partial<SetPiece>[]): SetPiece {
  const out = emptySet();
  for (const x of xs) {
    out.shapes.push(...(x.shapes ?? []));
    out.solids.push(...(x.solids ?? []));
    out.parts.push(...(x.parts ?? []));
    out.groups.push(...(x.groups ?? []));
  }
  return out;
}

/** Ground slab: far edge at GROUND_FAR_Z (hidden by the backdrop mountains), near edge far behind the lens. */
export const GROUND_FAR_Z = -2600;

export function ground(p: Palette, color = "#6f9a52", width = 9000): SetPiece {
  const near = 9000;
  const size: Vec2 = [width, near - GROUND_FAR_Z];
  const at: Vec3 = [0, -6, (near + GROUND_FAR_Z) / 2];
  return merge({ solids: [{ id: "ground", type: "box", size: [size[0], 12, size[1]], at, fill: tone(color, p), shadow: false, shading: "faceted" }] });
}

/** Vietnamese village house: ochre walls, tiled gable roof, door + windows. */
export function house(id: string, p: Palette, at: Vec3, o: { rotY?: number; wall?: string; roof?: string; w?: number; d?: number; lit?: boolean } = {}): SetPiece {
  const w = o.w ?? 240;
  const d = o.d ?? 170;
  const h = 120;
  const wall = tone(o.wall ?? "#e9cf8f", p);
  const roof = tone(o.roof ?? "#a9442e", p);
  const rot: Vec3 = [0, o.rotY ?? 0, 0];
  const g = `${id}G`;
  const lit = o.lit ? "#ffcf6a" : tone("#4a3a30", p);
  return merge({
    shapes: [{ id: `${id}RoofP`, type: "polygon", points: [[-w * 0.62, 0], [w * 0.62, 0], [0, -h * 0.72]] }],
    solids: [
      { id: `${id}Wall`, type: "box", size: [w, h, d], at: [0, h / 2, 0], fill: wall, group: g, shading: "faceted" },
      { id: `${id}Roof`, type: "extrude", profile: `${id}RoofP`, depth: d * 1.18, at: [0, h, 0], fill: roof, group: g, shading: "faceted" },
      { id: `${id}Door`, type: "box", size: [w * 0.2, h * 0.62, 4], at: [0, h * 0.31, d / 2 + 1], fill: tone("#6b3f26", p), group: g, shadow: false, shading: "faceted" },
      { id: `${id}WinL`, type: "box", size: [w * 0.16, h * 0.26, 4], at: [-w * 0.3, h * 0.55, d / 2 + 1], fill: lit, group: g, shadow: false, shading: "none", ...(o.lit ? { effects: { glow: { mode: "halo", color: "#ffb45a", size: 1.8, opacity: 0.35 } } } : {}) },
      { id: `${id}WinR`, type: "box", size: [w * 0.16, h * 0.26, 4], at: [w * 0.3, h * 0.55, d / 2 + 1], fill: lit, group: g, shadow: false, shading: "none" },
    ],
    groups: [{ id: g, at, rotate: rot }],
  });
}

export function tree(id: string, p: Palette, at: Vec3, kind: "blob" | "cone" | "layered" | "areca" | "banana" = "blob", size = 1): SetPiece {
  if (kind === "areca" || kind === "banana") {
    // cây cau (tall trunk, crown of fronds) / cây chuối (short trunk, broad leaves)
    const areca = kind === "areca";
    const trunkH = (areca ? 300 : 95) * size;
    const solids: Json[] = [
      { id: `${id}Trunk`, type: "cylinder", r: (areca ? 7 : 11) * size, h: r1(trunkH), segments: 6, at: [at[0], r1(trunkH / 2), at[2]], fill: tone(areca ? "#a8967a" : "#8aa052", p), shading: "faceted" },
    ];
    const n = areca ? 7 : 5;
    const len = (areca ? 95 : 110) * size;
    for (let i = 0; i < n; i++) {
      const yaw = (360 / n) * i + rand(id, i) * 20;
      const droop = areca ? 28 + rand(`${id}d`, i) * 18 : 12 + rand(`${id}d`, i) * 30;
      const rad = (yaw * Math.PI) / 180;
      solids.push({
        id: `${id}F${i}`,
        type: "box",
        size: [r1(len), 5, r1((areca ? 22 : 38) * size)],
        at: [r1(at[0] + Math.cos(rad) * len * 0.45), r1(trunkH + (areca ? 4 : 10) * size), r1(at[2] - Math.sin(rad) * len * 0.45)],
        rotate: [0, r1(yaw), r1(-droop)],
        fill: tone(mix(areca ? "#4f8a3c" : "#6fae45", "#8fc25a", rand(`${id}c`, i) * 0.5), p),
        shading: "faceted",
      });
    }
    return merge({ solids });
  }
  const canopy = kind === "cone" ? "#3f7a4a" : kind === "layered" ? "#4b8a4a" : "#5c9a48";
  return merge({
    parts: [
      {
        id,
        type: "tree",
        at,
        trunkH: 80 * size,
        trunkR: 11 * size,
        canopyR: 70 * size,
        style: kind,
        fills: { trunk: tone("#7a5a3c", p), canopy: tone(canopy, p) },
      },
    ],
  });
}

/** The great banyan (cây đa) at the village gate / festival square. */
export function banyan(id: string, p: Palette, at: Vec3): SetPiece {
  const leaf = tone("#3f7a3c", p);
  return merge({
    solids: [
      { id: `${id}Trunk`, type: "cylinder", r: 34, h: 220, segments: 8, at: [at[0], 110, at[2]], fill: tone("#6e5238", p), shading: "faceted" },
      { id: `${id}RootL`, type: "cone", r: 60, h: 60, segments: 8, at: [at[0], 30, at[2]], fill: tone("#634a33", p), shading: "faceted" },
      { id: `${id}C1`, type: "sphere", r: 150, segments: 9, at: [at[0], 300, at[2]], scale: [1.4, 0.7, 1.2], fill: leaf, shading: "faceted" },
      { id: `${id}C2`, type: "sphere", r: 110, segments: 8, at: [at[0] - 150, 250, at[2] + 30], scale: [1.2, 0.65, 1], fill: mix(leaf, "#2a5a30", 0.2), shading: "faceted" },
      { id: `${id}C3`, type: "sphere", r: 110, segments: 8, at: [at[0] + 160, 260, at[2] - 20], scale: [1.2, 0.65, 1], fill: mix(leaf, "#5a9a48", 0.2), shading: "faceted" },
    ],
  });
}

export function river(p: Palette, z: number, width = 360, o: { x?: number; length?: number; color?: string } = {}): SetPiece {
  const water = tone(o.color ?? "#4c8fb8", p);
  const len = o.length ?? 5200;
  const x = o.x ?? 0;
  const solids: Json[] = [
    { id: "riverWater", type: "box", size: [len, 4, width], at: [x, 1, z], fill: water, shadow: false, shading: "none" },
    { id: "riverBankN", type: "box", size: [len, 10, 26], at: [x, 3, z - width / 2 - 10], fill: tone("#8a7a52", p), shadow: false, shading: "faceted" },
    { id: "riverBankS", type: "box", size: [len, 10, 26], at: [x, 3, z + width / 2 + 10], fill: tone("#8a7a52", p), shadow: false, shading: "faceted" },
  ];
  for (let i = 0; i < 7; i++) {
    solids.push({
      id: `ripple${i}`,
      type: "box",
      size: [r1(80 + rand("rip-w", i) * 160), 1, 5],
      at: [r1(x - len * 0.35 + rand("rip-x", i) * len * 0.7), 3.5, r1(z - width * 0.35 + rand("rip-z", i) * width * 0.7)],
      fill: mix(water, "#ffffff", 0.35),
      shadow: false,
      shading: "none",
    });
  }
  return merge({ solids });
}

export function riceField(id: string, p: Palette, at: Vec3, cols = 4, rows = 3, cell: Vec2 = [300, 220]): SetPiece {
  const solids: Json[] = [];
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const g = mix("#8dbf4a", "#b8c95a", rand("rice", c * 17 + r));
      solids.push({
        id: `${id}${c}_${r}`,
        type: "box",
        size: [cell[0] - 26, 14, cell[1] - 26],
        at: [r1(at[0] + (c - (cols - 1) / 2) * cell[0]), 7, r1(at[2] + (r - (rows - 1) / 2) * cell[1])],
        fill: tone(g, p),
        shadow: false,
        shading: "faceted",
      });
    }
  }
  return merge({
    solids: [
      { id: `${id}Water`, type: "box", size: [cols * cell[0] + 20, 3, rows * cell[1] + 20], at: [at[0], 1.5, at[2]], fill: tone("#7fb0c0", p), shadow: false, shading: "none" },
      ...solids,
    ],
  });
}

export function bamboo(id: string, p: Palette, at: Vec3, n = 7, spread = 120, leafClusters = 5): SetPiece {
  const solids: Json[] = [];
  for (let i = 0; i < n; i++) {
    const h = 260 + rand(`${id}h`, i) * 180;
    const x = at[0] + (rand(`${id}x`, i) - 0.5) * spread;
    const z = at[2] + (rand(`${id}z`, i) - 0.5) * spread * 0.6;
    solids.push({
      id: `${id}S${i}`,
      type: "cylinder",
      r: 5 + rand(`${id}r`, i) * 3,
      h: r1(h),
      segments: 6,
      at: [r1(x), r1(h / 2), r1(z)],
      rotate: [r1((rand(`${id}t`, i) - 0.5) * 8), 0, r1((rand(`${id}u`, i) - 0.5) * 10)],
      fill: tone(mix("#7fae4a", "#a8c060", rand(`${id}c`, i)), p),
      shading: "faceted",
    });
  }
  // leaf clusters near the tops of the culms (reads as bamboo, not a canopy tree)
  for (let i = 0; i < leafClusters; i++) {
    solids.push({
      id: `${id}Leaves${i}`,
      type: "sphere",
      r: r1(spread * (0.24 + rand(`${id}lr`, i) * 0.12)),
      segments: 7,
      at: [r1(at[0] + (rand(`${id}lx`, i) - 0.5) * spread * 1.3), r1(270 + rand(`${id}ly`, i) * 170), r1(at[2] + (rand(`${id}lz`, i) - 0.5) * spread * 0.6)],
      scale: [1.25, 0.8, 0.9],
      fill: tone(mix("#5a8f3c", "#7aa84a", rand(`${id}lc`, i)), p),
      shading: "faceted",
    });
  }
  return merge({ solids });
}

export function rock(id: string, p: Palette, at: Vec3, r = 40): Json {
  return { id, type: "sphere", r, segments: 6, at: [at[0], at[1] + r * 0.4, at[2]], scale: [1.2, 0.7, 1], fill: tone("#8a8a92", p), shading: "faceted" };
}

export function hill(id: string, p: Palette, at: Vec3, r = 700, h = 0.28, color = "#6c9a50"): Json {
  return { id, type: "sphere", r, segments: 12, at, scale: [1, h, 0.8], fill: tone(color, p), shading: "faceted", shadow: false };
}

export function fence(id: string, p: Palette, from: Vec3, to: Vec3, posts = 8): SetPiece {
  const solids: Json[] = [];
  for (let i = 0; i < posts; i++) {
    const t = i / (posts - 1);
    solids.push({
      id: `${id}P${i}`,
      type: "box",
      size: [6, 56, 6],
      at: [r1(from[0] + (to[0] - from[0]) * t), 28, r1(from[2] + (to[2] - from[2]) * t)],
      fill: tone("#a88a5a", p),
      shading: "faceted",
      shadow: false,
    });
  }
  const len = Math.hypot(to[0] - from[0], to[2] - from[2]);
  const yaw = (Math.atan2(to[0] - from[0], to[2] - from[2]) * 180) / Math.PI - 90;
  for (const [k, y] of [["A", 22], ["B", 42]] as const) {
    solids.push({
      id: `${id}Rail${k}`,
      type: "box",
      size: [r1(len), 4, 4],
      at: [r1((from[0] + to[0]) / 2), y, r1((from[2] + to[2]) / 2)],
      rotate: [0, r1(yaw), 0],
      fill: tone("#b89a6a", p),
      shading: "faceted",
      shadow: false,
    });
  }
  return merge({ solids });
}

export function boat(id: string, p: Palette, at: Vec3, rotY = 0): SetPiece {
  return merge({
    shapes: [{ id: `${id}HullP`, type: "polygon", points: [[-110, 0], [110, 0], [80, 28], [-80, 28]] }],
    solids: [
      { id: `${id}Hull`, type: "extrude", profile: `${id}HullP`, depth: 60, at: [at[0], at[1] + 26, at[2]], rotate: [0, rotY, 0], fill: tone("#7a4a2c", p), shading: "faceted" },
      { id: `${id}Roof`, type: "cylinder", r: 30, h: 70, segments: 8, at: [at[0], at[1] + 36, at[2]], rotate: [0, rotY, 90], scale: [1, 1, 0.9], fill: tone("#c8a86a", p), shading: "faceted" },
    ],
  });
}

// ---------------------------------------------------------------------------
// Scene assembly
// ---------------------------------------------------------------------------

export interface SceneInput {
  palette: Palette;
  cam: Cam;
  place: Vec2;
  set: SetPiece;
  extraSolids?: Json[];
  extraParts?: Json[];
  extraShapes?: Json[];
  extraGroups?: Json[];
  shadow?: boolean;
  depthFade?: number;
}

export function scene(i: SceneInput): Json {
  const p = i.palette;
  const groups = [...i.set.groups, ...(i.extraGroups ?? [])];
  return {
    version: 1,
    camera: { orbit: { azimuth: i.cam.az, elevation: i.cam.el }, zoom: i.cam.zoom },
    place: { at: i.place },
    light: { direction: p.light.direction, ambient: p.light.ambient, tones: p.light.tones, mode: "quantized" },
    shadow: i.shadow === false ? { style: "none" } : { style: "blob", opacity: p.name === "night" ? 0.18 : 0.26 },
    shapes: [...i.set.shapes, ...(i.extraShapes ?? [])],
    solids: [...i.set.solids, ...(i.extraSolids ?? [])],
    parts: [...i.set.parts, ...(i.extraParts ?? [])],
    groups,
    atmosphere: {
      depthFade: { color: p.haze, strength: i.depthFade ?? p.hazeStrength, desaturate: 0.2 },
      vignette: { strength: p.vignette },
    },
  };
}
