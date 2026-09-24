/**
 * The film's locations. Each set is a pure function of the palette, so the
 * same place can be shot at dawn, dusk or under the festival moon, and a
 * `MARKS` table gives the staging positions the screenplay blocks actors on.
 */
import {
  bamboo,
  banyan,
  boat,
  fence,
  ground,
  hill,
  house,
  merge,
  mix,
  paperLantern,
  r1,
  rand,
  river,
  riceField,
  rock,
  tone,
  tree,
  type Json,
  type Palette,
  type SetPiece,
  type Vec3,
} from "./kit";

// ---------------------------------------------------------------------------
// Staging marks (world units; the child is ~118 tall)
// ---------------------------------------------------------------------------

export const MARKS = {
  village: { door: [-420, 0, -300] as Vec3, yard: [-300, 0, -60] as Vec3, banyan: [900, 0, -380] as Vec3, bank: [0, 0, 300] as Vec3 },
  yard: { table: [0, 0, 0] as Vec3, stoolBa: [-80, 0, 20] as Vec3, stoolTi: [85, 0, 25] as Vec3, door: [-40, 0, -250] as Vec3 },
  river: { waterZ: 220, bank: [0, 0, 20] as Vec3 },
  field: { dikeZ: 0 },
  stream: { bridgeFrom: [-260, 0, 0] as Vec3, bridgeTo: [260, 0, 0] as Vec3, deckY: 34 },
  pond: { rock: [60, 0, -120] as Vec3, stones: [[-420, 60], [-300, 20], [-190, -30], [-80, -80]] as [number, number][] },
  hill: { top: [0, 150, 0] as Vec3 },
  square: { banyan: [0, 0, -520] as Vec3, drum: [-420, 0, -160] as Vec3, table: [380, 0, -200] as Vec3 },
} as const;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export function table(id: string, p: Palette, at: Vec3, w = 180, d = 110): Json[] {
  const wood = tone("#8a5a36", p);
  const legs: Json[] = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    legs.push({ id: `${id}L${sx}${sz}`, type: "box", size: [8, 56, 8], at: [at[0] + sx * (w / 2 - 10), 28, at[2] + sz * (d / 2 - 10)], fill: wood, shading: "faceted", shadow: false });
  }
  return [{ id, type: "box", size: [w, 8, d], at: [at[0], 60, at[2]], fill: mix(wood, "#b07a4a", 0.3), shading: "faceted" }, ...legs];
}

export function stool(id: string, p: Palette, at: Vec3, h = 34): Json {
  return { id, type: "cylinder", r: 20, h, segments: 8, at: [at[0], h / 2, at[2]], fill: tone("#9a6a40", p), shading: "faceted" };
}

/** Con trâu — water buffalo built from primitives (body, head, horns, legs, tail). */
export function buffalo(id: string, p: Palette, at: Vec3, yaw = 0): { solids: Json[]; groups: Json[] } {
  const g = `${id}G`;
  const hide = tone("#4a4650", p);
  const dark = tone("#34313a", p);
  const horn = tone("#d8cfb8", p);
  const solids: Json[] = [
    { id: `${id}Body`, type: "sphere", r: 70, segments: 10, at: [0, 95, 0], scale: [1.55, 0.95, 0.95], fill: hide, group: g, shading: "faceted" },
    { id: `${id}Head`, type: "sphere", r: 34, segments: 8, at: [118, 100, 0], scale: [1.25, 0.9, 0.85], fill: hide, group: g, shading: "faceted" },
    { id: `${id}Snout`, type: "sphere", r: 18, segments: 8, at: [150, 88, 0], fill: dark, group: g, shading: "faceted" },
    { id: `${id}HornL`, type: "cone", r: 7, h: 46, segments: 6, at: [112, 132, 26], rotate: [-70, 0, 20], fill: horn, group: g, shading: "faceted" },
    { id: `${id}HornR`, type: "cone", r: 7, h: 46, segments: 6, at: [112, 132, -26], rotate: [70, 0, 20], fill: horn, group: g, shading: "faceted" },
    { id: `${id}EyeL`, type: "sphere", r: 4, segments: 6, at: [136, 108, 22], fill: "#16141a", group: g, shading: "none", shadow: false },
    { id: `${id}EyeR`, type: "sphere", r: 4, segments: 6, at: [136, 108, -22], fill: "#16141a", group: g, shading: "none", shadow: false },
    { id: `${id}Tail`, type: "cylinder", r: 3, h: 60, segments: 5, at: [-112, 88, 0], rotate: [0, 0, -20], fill: dark, group: g, shading: "faceted" },
  ];
  for (const [k, x, z] of [["FL", 70, 32], ["FR", 70, -32], ["BL", -70, 32], ["BR", -70, -32]] as const) {
    solids.push({ id: `${id}Leg${k}`, type: "cylinder", r: 12, h: 64, segments: 6, at: [x, 32, z], fill: dark, group: g, shading: "faceted" });
  }
  return { solids, groups: [{ id: g, at, rotate: [0, yaw, 0] }] };
}

/** Owl on a branch (big eyes that can blink via scale tracks on `${id}EyeL/R`). */
export function owl(id: string, p: Palette, at: Vec3): Json[] {
  const feather = tone("#7a6048", p);
  return [
    { id: `${id}Branch`, type: "cylinder", r: 5, h: 160, segments: 6, at: [at[0], at[1] - 18, at[2]], rotate: [0, 0, 90], fill: tone("#5a4030", p), shading: "faceted" },
    { id: `${id}Body`, type: "sphere", r: 20, segments: 8, at: [at[0], at[1] + 10, at[2]], scale: [0.9, 1.2, 0.85], fill: feather, shading: "faceted" },
    { id: `${id}Head`, type: "sphere", r: 14, segments: 8, at: [at[0], at[1] + 38, at[2]], fill: mix(feather, "#9a8060", 0.3), shading: "faceted" },
    { id: `${id}EyeL`, type: "sphere", r: 5.5, segments: 8, at: [at[0] + 6, at[1] + 40, at[2] + 12], fill: "#ffe070", shading: "none", shadow: false, effects: { glow: { mode: "halo", size: 1.8, opacity: 0.35 } } },
    { id: `${id}EyeR`, type: "sphere", r: 5.5, segments: 8, at: [at[0] - 6, at[1] + 40, at[2] + 12], fill: "#ffe070", shading: "none", shadow: false },
  ];
}

/** Múa lân: lion head (carried by the dancer's hands via attach) + cloth body. */
export function lion(id: string, p: Palette, dancer: string): Json[] {
  const red = "#e0342a";
  const gold = "#f2c230";
  return [
    { id: `${id}Head`, type: "box", size: [70, 60, 64], at: [0, 24, 30], fill: tone(red, p), shading: "faceted", attach: { part: dancer, joint: "spine" }, effects: { rim: { color: "#ffd98a" } } },
    { id: `${id}Brow`, type: "box", size: [74, 12, 66], at: [0, 52, 32], fill: tone(gold, p), shading: "faceted", attach: { part: dancer, joint: "spine" } },
    { id: `${id}Horn`, type: "cone", r: 9, h: 30, segments: 6, at: [0, 70, 34], fill: tone(gold, p), shading: "faceted", attach: { part: dancer, joint: "spine" } },
    { id: `${id}EyeL`, type: "sphere", r: 9, segments: 8, at: [18, 36, 64], fill: "#ffffff", shading: "none", attach: { part: dancer, joint: "spine" } },
    { id: `${id}EyeR`, type: "sphere", r: 9, segments: 8, at: [-18, 36, 64], fill: "#ffffff", shading: "none", attach: { part: dancer, joint: "spine" } },
    { id: `${id}Jaw`, type: "box", size: [60, 14, 50], at: [0, -8, 36], fill: tone(gold, p), shading: "faceted", attach: { part: dancer, joint: "spine" } },
    { id: `${id}Cloth`, type: "box", size: [66, 50, 170], at: [0, -10, -80], fill: tone(mix(red, gold, 0.35), p), shading: "faceted", attach: { part: dancer, joint: "hips" } },
  ];
}

export function drum(id: string, p: Palette, at: Vec3): Json[] {
  return [
    { id, type: "cylinder", r: 46, h: 60, segments: 12, at: [at[0], 70, at[2]], fill: tone("#b8352a", p), shading: "faceted" },
    { id: `${id}Skin`, type: "cylinder", r: 44, h: 4, segments: 12, at: [at[0], 101, at[2]], fill: tone("#e8d6a8", p), shading: "faceted", shadow: false },
    { id: `${id}Stand`, type: "box", size: [70, 40, 70], at: [at[0], 20, at[2]], fill: tone("#5a3a26", p), shading: "faceted" },
  ];
}

/** Bánh trung thu on a plate. */
export function mooncakes(id: string, p: Palette, at: Vec3): Json[] {
  const out: Json[] = [{ id: `${id}Plate`, type: "cylinder", r: 40, h: 3, segments: 12, at: [at[0], at[1] + 2, at[2]], fill: tone("#e8e4dc", p), shading: "faceted", shadow: false }];
  for (let i = 0; i < 3; i++) {
    out.push({ id: `${id}C${i}`, type: "cylinder", r: 13, h: 9, segments: 10, at: [at[0] + (i - 1) * 24, at[1] + 8, at[2] + (i === 1 ? -8 : 6)], fill: tone("#c98a3c", p), shading: "faceted", shadow: false });
  }
  return out;
}

export function lanternString(id: string, p: Palette, from: Vec3, to: Vec3, n: number, lit: boolean, colors = ["#e8412f", "#f2b632", "#e86a2f", "#d8325a"]): Json[] {
  const out: Json[] = [
    { id: `${id}PoleA`, type: "cylinder", r: 4, h: from[1] + 20, segments: 6, at: [from[0], (from[1] + 20) / 2, from[2]], fill: tone("#6a4a30", p), shading: "faceted" },
    { id: `${id}PoleB`, type: "cylinder", r: 4, h: to[1] + 20, segments: 6, at: [to[0], (to[1] + 20) / 2, to[2]], fill: tone("#6a4a30", p), shading: "faceted" },
  ];
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n;
    const sag = Math.sin(u * Math.PI) * 30;
    out.push(paperLantern(`${id}L${i}`, [r1(from[0] + (to[0] - from[0]) * u), r1(from[1] + (to[1] - from[1]) * u - sag), r1(from[2] + (to[2] - from[2]) * u)], colors[i % colors.length], lit));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sets
// ---------------------------------------------------------------------------

/** The riverside village: three houses, the great banyan, palms, the river in front. */
export function village(p: Palette, o: { lit?: boolean; lanterns?: boolean } = {}): SetPiece {
  const lit = o.lit ?? (p.name === "night" || p.name === "festival" || p.name === "dusk");
  return merge(
    ground(p),
    house("h1", p, [-420, 0, -420], { rotY: 10, lit }),
    house("h2", p, [160, 0, -620], { rotY: -4, wall: "#f0dca8", lit }),
    house("h3", p, [620, 0, -900], { rotY: -16, roof: "#8e3b2a", lit }),
    house("h4", p, [-1150, 0, -900], { rotY: 20, wall: "#e2c890", lit }),
    tree("t1", p, [-120, 0, -380], "blob", 1.1),
    tree("t2", p, [-700, 0, -300], "areca", 1),
    tree("t3", p, [-620, 0, -120], "banana", 1.1),
    tree("t4", p, [420, 0, -420], "areca", 1.1),
    bamboo("bb", p, [1300, 0, -700], 8, 180),
    banyan("dq", p, [900, 0, -520]),
    fence("f1", p, [-760, 0, -230], [-180, 0, -230], 10),
    river(p, 420, 320),
    { solids: o.lanterns ? lanternString("vs", p, [-250, 150, -240], [300, 150, -300], 7, true) : [] },
  );
}

/** Bà's front yard: the house close, a low table and two stools, palms, a water jar. */
export function yard(p: Palette, o: { lit?: boolean } = {}): SetPiece {
  const lit = o.lit ?? (p.name !== "day" && p.name !== "dawn");
  return merge(
    ground(p, "#8aa35c"),
    { solids: [{ id: "yardFloor", type: "box", size: [900, 3, 600], at: [0, 1, -60], fill: tone("#c9a877", p), shadow: false, shading: "faceted" }] },
    house("home", p, [-40, 0, -420], { rotY: 0, w: 380, d: 220, lit }),
    tree("yt1", p, [-420, 0, -260], "areca", 1.05),
    tree("yt2", p, [360, 0, -280], "banana", 1.25),
    tree("yt3", p, [520, 0, -520], "blob", 1.2),
    fence("yf", p, [-560, 0, 260], [560, 0, 260], 14),
    { solids: [
      ...table("tbl", p, MARKS.yard.table),
      stool("stBa", p, MARKS.yard.stoolBa),
      stool("stTi", p, MARKS.yard.stoolTi),
      { id: "jar", type: "cylinder", r: 30, h: 70, rTop: 20, segments: 10, at: [-300, 35, -150], fill: tone("#8a5a3c", p), shading: "faceted" },
    ] },
  );
}

/** Along the river: reeds, rocks, a moored boat, the village far away. */
export function riverside(p: Palette): SetPiece {
  const reeds: Json[] = [];
  for (let i = 0; i < 18; i++) {
    const x = -1400 + i * 160 + rand("reed", i) * 60;
    reeds.push({ id: `reed${i}`, type: "cone", r: 7, h: r1(60 + rand("reedh", i) * 50), segments: 5, at: [r1(x), 30, r1(MARKS.river.waterZ - 190 + rand("reedz", i) * 30)], fill: tone("#7a9a48", p), shading: "faceted", shadow: false });
  }
  return merge(
    ground(p, "#78a052"),
    river(p, MARKS.river.waterZ, 420),
    boat("bt", p, [520, 0, MARKS.river.waterZ + 40], 8),
    house("rf1", p, [-900, 0, -900], { rotY: 14 }),
    house("rf2", p, [-420, 0, -1100], { rotY: -8, wall: "#f0dca8" }),
    tree("rt1", p, [-1100, 0, -260], "blob", 1.3),
    tree("rt2", p, [900, 0, -300], "areca", 1.1),
    bamboo("rbb", p, [1400, 0, -500], 7, 160),
    { solids: [...reeds, rock("rk1", p, [-200, 0, 70], 30), rock("rk2", p, [260, 0, 80], 22)] },
  );
}

/** Rice paddies with a dike path through the middle and hills behind. */
export function paddies(p: Palette): SetPiece {
  return merge(
    ground(p, "#86ad54"),
    riceField("rfA", p, [-700, 0, -420], 4, 3),
    riceField("rfB", p, [700, 0, -420], 4, 3),
    riceField("rfC", p, [-700, 0, 420], 4, 2),
    riceField("rfD", p, [700, 0, 420], 4, 2),
    { solids: [
      { id: "dike", type: "box", size: [5000, 16, 110], at: [0, 8, 0], fill: tone("#a88a5a", p), shading: "faceted", shadow: false },
    ] },
    tree("ft1", p, [1150, 0, -60], "blob", 1.2),
  );
}

/** Night bamboo forest with a winding path. */
export function forest(p: Palette): SetPiece {
  const clumps: SetPiece[] = [];
  const spots: [number, number][] = [[-900, -400], [-500, -620], [-150, -420], [260, -640], [620, -380], [980, -600], [-760, 140], [820, 180]];
  spots.forEach(([x, z], i) => clumps.push(bamboo(`fb${i}`, p, [x, 0, z], 5, 150, 3)));
  return merge(
    ground(p, "#4a6a3c"),
    { solids: [{ id: "fpath", type: "box", size: [4200, 3, 150], at: [0, 1, -40], fill: tone("#8a7550", p), shadow: false, shading: "faceted" }] },
    ...clumps,
  );
}

/** A stream crossed by a cầu khỉ (monkey bridge: one bamboo log + a handrail). */
export function stream(p: Palette): SetPiece {
  const { bridgeFrom: a, bridgeTo: b, deckY } = MARKS.stream;
  const len = b[0] - a[0];
  return merge(
    ground(p, "#4f6f40"),
    river(p, 0, 360, { color: "#3f7aa0" }),
    { solids: [
      { id: "log", type: "cylinder", r: 7, h: len + 80, segments: 8, at: [0, deckY, 0], rotate: [0, 0, 90], fill: tone("#a8905a", p), shading: "faceted" },
      { id: "rail", type: "cylinder", r: 3, h: len + 80, segments: 6, at: [0, deckY + 72, -26], rotate: [0, 0, 90], fill: tone("#b8a06a", p), shading: "faceted" },
      { id: "postA", type: "cylinder", r: 5, h: deckY + 90, segments: 6, at: [a[0] - 20, (deckY + 90) / 2, -26], fill: tone("#8a7048", p), shading: "faceted" },
      { id: "postB", type: "cylinder", r: 5, h: deckY + 90, segments: 6, at: [b[0] + 20, (deckY + 90) / 2, -26], fill: tone("#8a7048", p), shading: "faceted" },
      { id: "postM", type: "cylinder", r: 5, h: deckY + 90, segments: 6, at: [0, (deckY + 90) / 2 - 20, -26], fill: tone("#8a7048", p), shading: "faceted" },
      rock("srk1", p, [-420, 0, 120], 36),
      rock("srk2", p, [380, 0, -140], 28),
    ] },
    bamboo("sbb1", p, [-700, 0, -420], 6, 140),
    bamboo("sbb2", p, [760, 0, -380], 6, 140),
  );
}

/** The lotus pond under a small waterfall; the lost lantern is caught on the middle rock. */
export function pond(p: Palette): SetPiece {
  const water = tone("#3a7098", p);
  const solids: Json[] = [
    { id: "pondWater", type: "cylinder", r: 560, h: 4, segments: 20, at: [0, 1, -120], scale: [1.3, 1, 0.8], fill: water, shading: "none", shadow: false },
    { id: "fallRock", type: "box", size: [420, 260, 160], at: [120, 130, -620], fill: tone("#6a6a78", p), shading: "faceted" },
    { id: "fall", type: "box", size: [46, 250, 6], at: [120, 125, -537], fill: mix(water, "#9fc8e8", 0.35), shading: "none", shadow: false },
    { id: "fallFoam", type: "sphere", r: 40, segments: 8, at: [120, 4, -520], scale: [1.4, 0.3, 0.8], fill: mix(water, "#e8f4ff", 0.55), shading: "faceted", shadow: false },
    rock("midRock", p, MARKS.pond.rock, 46),
  ];
  MARKS.pond.stones.forEach(([x, z], i) => solids.push({ id: `stone${i}`, type: "cylinder", r: 30, h: 12, segments: 8, at: [x, 6, z], fill: tone("#8a8a92", p), shading: "faceted" }));
  for (let i = 0; i < 9; i++) {
    const x = r1(-560 + rand("lotus", i) * 1120);
    const z = r1(-360 + rand("lotusz", i) * 420);
    solids.push({ id: `pad${i}`, type: "cylinder", r: r1(20 + rand("padr", i) * 16), h: 2, segments: 10, at: [x, 3.5, z], fill: tone("#4f8a44", p), shading: "none", shadow: false });
    if (i % 3 === 0) solids.push({ id: `lotus${i}`, type: "cone", r: 10, h: 18, segments: 6, at: [x + 6, 12, z], rotate: [180, 0, 0], fill: tone("#f2a0b8", p), shading: "faceted", shadow: false });
  }
  return merge(ground(p, "#4f6f40"), { solids }, bamboo("pbb", p, [-760, 0, -520], 7, 160), tree("pt1", p, [760, 0, -420], "blob", 1.3));
}

/** Hilltop overlooking the far village (tiny houses + lanterns in the distance). */
export function hilltop(p: Palette, o: { villageLit?: number } = {}): SetPiece {
  const solids: Json[] = [hill("bigHill", p, [0, -380, 0], 900, 0.6, "#5a7f48")];
  // far village: small houses + lights on the plain below/behind
  for (let i = 0; i < 9; i++) {
    const x = r1(-1400 + i * 340 + rand("fv", i) * 80);
    const z = r1(-1700 - rand("fvz", i) * 400);
    solids.push({ id: `fvH${i}`, type: "box", size: [70, 44, 50], at: [x, 22, z], fill: tone("#d8c090", p), shading: "faceted", shadow: false });
    solids.push({ id: `fvR${i}`, type: "pyramid", sides: 4, r: 52, h: 34, at: [x, 61, z], rotate: [0, 45, 0], fill: tone("#8e3b2a", p), shading: "faceted", shadow: false });
    if ((o.villageLit ?? 0) > i) solids.push(paperLantern(`fvL${i}`, [x + 40, 50, z + 30], i % 2 ? "#f2b632" : "#e8412f", true));
  }
  return merge(ground(p, "#3f5f38"), { solids }, tree("htree", p, [150, 120, -60], "blob", 1.1));
}

/** Festival square before the banyan: lantern strings, drum, mooncake table. */
export function square(p: Palette, o: { lit?: boolean } = {}): SetPiece {
  const lit = o.lit ?? true;
  const { banyan: b, drum: d, table: t } = MARKS.square;
  return merge(
    ground(p, "#6a8a4a"),
    { solids: [{ id: "sqFloor", type: "cylinder", r: 700, h: 3, segments: 16, at: [0, 1, -160], scale: [1.4, 1, 0.9], fill: tone("#b89a6a", p), shading: "none", shadow: false }] },
    banyan("sqBanyan", p, b),
    house("sq1", p, [-1100, 0, -700], { rotY: 25, lit }),
    house("sq2", p, [1100, 0, -760], { rotY: -25, wall: "#f0dca8", lit }),
    { solids: [
      ...lanternString("ls1", p, [-900, 170, -420], [-20, 170, -300], 6, lit),
      ...lanternString("ls2", p, [20, 170, -300], [900, 170, -420], 6, lit, ["#f2b632", "#e8412f", "#d8325a", "#e86a2f"]),
      ...drum("sqDrum", p, d),
      ...table("sqTable", p, t, 200, 110),
      ...mooncakes("mc", p, [t[0], 64, t[2]]),
    ] },
  );
}

/** Night porch of Bà's house (epilogue). */
export function porch(p: Palette): SetPiece {
  return merge(
    ground(p, "#5a7a48"),
    house("home", p, [0, 0, -260], { w: 420, d: 220, lit: true }),
    { solids: [{ id: "step", type: "box", size: [460, 24, 90], at: [0, 12, -110], fill: tone("#b8a07a", p), shading: "faceted" }] },
    tree("pt1", p, [-420, 0, -160], "areca", 1.05),
    tree("pt2", p, [420, 0, -200], "banana", 1.2),
  );
}
