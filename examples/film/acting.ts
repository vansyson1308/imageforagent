/**
 * Acting + prop helpers shared by the chapters: keyframe shorthand, gestures
 * (wave, hop, sit, hold the lantern, sadness), firefly swarms and the guide,
 * and the small hand-made props of the story.
 */
import { CAST, firefly, merge, mix, starLantern, type CastName, type Json, type Palette, type SetPiece, type Vec3 } from "./kit";
import { figureProportions } from "@/lib/services/construct/partFigure";
import type { Key } from "./shots";

// ---------------------------------------------------------------------------
// Little helpers for acting
// ---------------------------------------------------------------------------

/** Keyframes for one joint: [[t, [x,y,z]], …] (smooth in-between). */
export const K = (target: string, ...ks: [number, number | number[] | string][]) => ({
  target,
  keys: ks.map(([t, v], i): Key => ({ t, v, ...(i ? { ease: "inOut" } : {}) })),
});

/** Wave the right arm from t0 for n cycles. */
export function wave(t0: number, n = 3, per = 0.5) {
  const ks: [number, number[]][] = [[t0, [0, 0, 0]], [t0 + 0.4, [0, 0, -150]]];
  for (let i = 0; i < n; i++) ks.push([t0 + 0.4 + per * (i * 2 + 1) * 0.5, [0, 0, -120]], [t0 + 0.4 + per * (i + 1), [0, 0, -155]]);
  ks.push([t0 + 0.6 + per * n, [0, 0, 0]]);
  return K("pose.shoulderR", ...ks);
}

/** Hop: body up and down with a knee dip (joy). */
export function hop(t0: number, height = 30, times = 2): { target: string; keys: Key[]; blend?: "set" | "add" }[] {
  const up: Key[] = [{ t: t0, v: 0 }];
  const knee: Key[] = [{ t: t0, v: [0, 0, 0] }];
  for (let i = 0; i < times; i++) {
    const s = t0 + i * 0.6;
    up.push({ t: s + 0.12, v: -4, ease: "inOut" }, { t: s + 0.32, v: height, ease: "outBack" }, { t: s + 0.55, v: 0, ease: "in" });
    knee.push({ t: s + 0.12, v: [22, 0, 0], ease: "inOut" }, { t: s + 0.32, v: [0, 0, 0], ease: "out" }, { t: s + 0.55, v: [16, 0, 0], ease: "in" });
  }
  knee.push({ t: t0 + times * 0.6 + 0.2, v: [0, 0, 0], ease: "inOut" });
  return [
    { target: "at.1", keys: up, blend: "add" },
    { target: "pose.kneeL", keys: knee },
    { target: "pose.kneeR", keys: knee },
  ];
}

/** Sitting on a stool of height h (thighs forward, shins down, body lowered). */
export const SIT = { hipL: [-86, 0, 0], hipR: [-86, 0, 0], kneeL: [86, 0, 0], kneeR: [86, 0, 0] } as Record<string, Vec3>;
export const sitAt = (at: Vec3, drop: number): Vec3 => [at[0], at[1] - drop, at[2]];

/** Sitting on the ground: thighs forward, legs out. */
export const SIT_GROUND = { hipL: [-88, 0, 0], hipR: [-88, 0, 0], kneeL: [8, 0, 0], kneeR: [8, 0, 0] } as Record<string, Vec3>;

/** Where to place a figure so its hips rest on a seat of height `seatH` (0 ≈ the ground). */
export function seated(who: CastName, at: Vec3, seatH: number, height?: number): Vec3 {
  const m = CAST[who];
  const d = figureProportions(height ?? m.height, m.headCount);
  return [at[0], Math.round((seatH + d.legR * 0.6 - d.hipsY) * 10) / 10, at[2]];
}

export const HOLD_LANTERN = { shoulderR: [-35, 0, 8] as Vec3, elbowR: [-55, 0, 0] as Vec3 };
export const SAD = { neck: [16, 0, 0] as Vec3, spine: [10, 0, 0] as Vec3, shoulderL: [0, 0, 6] as Vec3, shoulderR: [0, 0, -6] as Vec3 };
export const LOOK_UP = { neck: [-22, 0, 0] as Vec3 };

/** A cloud of fireflies drifting around a centre (glow halos, seeded paths). */
export function swarm(id: string, centre: Vec3, n: number, radius: number, dur: number, o: { appearAt?: number; converge?: Vec3; convergeAt?: number } = {}): { solids: Json[]; tracks: Json[] } {
  const solids: Json[] = [];
  const tracks: Json[] = [];
  for (let i = 0; i < n; i++) {
    const fid = `${id}${i}`;
    const ang = (i / n) * Math.PI * 2;
    const r = radius * (0.5 + ((i * 37) % 10) / 20);
    const p0: Vec3 = [centre[0] + Math.cos(ang) * r, centre[1] + ((i * 53) % 7) * 12, centre[2] + Math.sin(ang) * r * 0.6];
    solids.push(...firefly(fid, p0));
    const keys: Key[] = [];
    const steps = Math.max(2, Math.ceil(dur / 1.5));
    for (let k = 0; k <= steps; k++) {
      const t = (dur * k) / steps;
      const a = ang + (k * 0.55 * (i % 2 ? 1 : -1));
      let p: Vec3 = [centre[0] + Math.cos(a) * r, p0[1] + Math.sin(k * 1.3 + i) * 18, centre[2] + Math.sin(a) * r * 0.6];
      if (o.converge && o.convergeAt !== undefined && t >= o.convergeAt) {
        const u = Math.min(1, (t - o.convergeAt) / Math.max(0.1, dur - o.convergeAt));
        const c = o.converge;
        p = [p[0] + (c[0] - p[0]) * u * 0.85, p[1] + (c[1] - p[1]) * u * 0.85, p[2] + (c[2] - p[2]) * u * 0.85];
      }
      keys.push({ t: Math.round(t * 1000) / 1000, v: p.map((x) => Math.round(x)), ...(k ? { ease: "smooth" } : {}) });
    }
    tracks.push({ target: `solids.${fid}.at`, keys });
    if (o.appearAt !== undefined) {
      const t0 = Math.min(dur - 0.2, o.appearAt + (i % 6) * 0.35);
      tracks.push({ target: `solids.${fid}.effects.glow.opacity`, keys: [{ t: 0, v: 0.01 }, { t: t0, v: 0.01 }, { t: t0 + 0.6, v: 0.5, ease: "out" }] });
      tracks.push({ target: `solids.${fid}.fill`, keys: [{ t: 0, v: "#1d2440" }, { t: t0, v: "#1d2440" }, { t: t0 + 0.4, v: "#fff7a1", ease: "out" }] });
    }
  }
  return { solids, tracks };
}

/** The guide firefly along a path of keyed points (smooth). */
export function guide(id: string, pts: [number, Vec3][]): { solids: Json[]; tracks: Json[] } {
  return {
    solids: firefly(id, pts[0][1], true),
    tracks: [
      { target: `solids.${id}.at`, keys: pts.map(([t, v], i) => ({ t, v, ...(i ? { ease: "smooth" } : {}) })) },
    ],
  };
}

export const withProps = (set: (p: Palette) => SetPiece, extra: (p: Palette) => Partial<SetPiece>) => (p: Palette) => merge(set(p), extra(p));

// ---------------------------------------------------------------------------
// Local props used above
// ---------------------------------------------------------------------------

export function riverBoat(p: Palette): Partial<SetPiece> {
  const b = { id: "boatHull", type: "box", size: [220, 30, 64], at: [0, 16, 0], fill: mix("#7a4a2c", p.tint, p.tintAmount), group: "boatG", shading: "faceted" };
  const roof = { id: "boatRoof", type: "cylinder", r: 30, h: 80, segments: 8, at: [0, 36, 0], rotate: [0, 0, 90], fill: mix("#c8a86a", p.tint, p.tintAmount), group: "boatG", shading: "faceted" };
  const rower = { id: "boatPole", type: "cylinder", r: 2.5, h: 180, segments: 5, at: [90, 90, 0], rotate: [0, 0, 20], fill: "#6a5030", group: "boatG", shading: "faceted" };
  return { solids: [b, roof, rower], groups: [{ id: "boatG", at: [-900, 0, 420] }] };
}

export function dragonfly(id: string, p: Palette, at: Vec3): Json {
  return { id, type: "box", size: [26, 3, 8], at, fill: mix("#4ab0d8", p.tint, p.tintAmount), shading: "none", shadow: false, effects: { glow: { mode: "halo", size: 1.4, opacity: 0.25 } } };
}

export function bambooStrips(id: string, p: Palette, at: Vec3): Json[] {
  return [0, 1, 2, 3, 4].map((i) => ({ id: `${id}${i}`, type: "cylinder", r: 1.6, h: 90, segments: 5, at: [at[0] + i * 6, at[1], at[2] + i * 4], rotate: [0, i * 12, 90], fill: mix("#c8b070", p.tint, p.tintAmount), shading: "faceted", shadow: false }));
}

/** The star frame on the table (grows while Bà bends it); `papered` = red paper glued. */
export function starFrame(id: string, p: Palette, at: Vec3, scale: number, papered = false): Partial<SetPiece> {
  const l = starLantern(id, null, p, { at, rotate: [-70, 0, 0], scale: 1 });
  const solid = { ...l.solids[0], scale, fill: papered ? "#e8412f" : mix("#c8b070", p.tint, p.tintAmount) };
  return { shapes: l.shapes, solids: [solid] };
}

/** Đèn cá chép — Lan's carp lantern (body + tail + fins), held on a stick. */
export function carpLantern(id: string, p: Palette, holder: string): Partial<SetPiece> {
  const at = { attach: { part: holder, joint: "wristR" } };
  const orange = mix("#f07a2a", p.tint, p.tintAmount * 0.5);
  return {
    solids: [
      { id: `${id}Stick`, type: "cylinder", r: 1.8, h: 60, segments: 6, at: [0, -4, 26], rotate: [90, 0, 0], fill: "#9a7a4a", shading: "faceted", shadow: false, ...at },
      { id: `${id}Body`, type: "sphere", r: 18, segments: 8, at: [0, -4, 58], scale: [1.6, 1, 0.7], fill: orange, shading: "faceted", shadow: false, ...at },
      { id: `${id}Tail`, type: "cone", r: 12, h: 22, segments: 5, at: [-30, -4, 58], rotate: [0, 0, 90], fill: mix(orange, "#f2c230", 0.4), shading: "faceted", shadow: false, ...at },
      { id: `${id}Eye`, type: "sphere", r: 3, segments: 6, at: [20, 0, 70], fill: "#1d1a22", shading: "none", shadow: false, ...at },
    ],
  };
}


// ---------------------------------------------------------------------------
// Extra villagers / children (looks applied over a cast body)
// ---------------------------------------------------------------------------

export const KIDS = {
  minh: { fills: { skin: "#eec09a", shirt: "#3a8fd0", pants: "#2a3a4a", shoes: "#2a2622" }, hair: { color: "#1d1a22", style: "short" as const } },
  hoa: { fills: { skin: "#f2c8a4", shirt: "#e86aa0", pants: "#4a3a6a", shoes: "#2a2622" }, hair: { color: "#2a1c18", style: "bob" as const } },
  nam: { fills: { skin: "#d9a57a", shirt: "#5aa05a", pants: "#3a3530", shoes: "#2a2622" }, hair: { color: "#1d1a22", style: "short" as const } },
};

export const VILLAGERS = {
  cuong: { fills: { skin: "#d9a57a", shirt: "#c8563a", pants: "#2c2a33", shoes: "#2a2622" }, hair: { color: "#1d1a22", style: "short" as const }, hat: "non-la" as const },
  mai: { fills: { skin: "#e8b890", shirt: "#e8c24a", pants: "#2c2a33", shoes: "#2a2622" }, hair: { color: "#1d1a22", style: "bun" as const }, hat: "non-la" as const, height: 158 },
  tu: { fills: { skin: "#d49a70", shirt: "#4a6ab0", pants: "#3a3530", shoes: "#2a2622" }, hair: { color: "#3a3a3a", style: "short" as const } },
};

/** A free (not held) star lantern — flying, floating, caught on a rock. */
export function looseLantern(id: string, p: Palette, at: Vec3, rotate: Vec3 = [0, 0, 0], kind: "dark" | "torn" | "lit" = "dark", scale = 1): Partial<SetPiece> {
  const l = starLantern(id, null, p, { at, rotate, torn: kind === "torn", lit: kind === "lit", scale });
  return { shapes: l.shapes, solids: l.solids };
}

/** An invisible handle a hand can follow with IK (a tiny solid hidden in a prop). */
export function handle(id: string, at: Vec3, fill = "#8a7048"): Json {
  return { id, type: "sphere", r: 1.5, segments: 6, at, fill, shading: "none", shadow: false };
}
