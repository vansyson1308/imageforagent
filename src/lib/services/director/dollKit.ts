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

export const HAIR_STYLES = ["short", "spiky", "bob", "long", "ponytail", "bun", "braids", "bald"] as const;
export const TOPS = ["tshirt", "shirt", "jacket", "dress", "robe", "kimono", "aodai"] as const;
export const BOTTOMS = ["pants", "shorts", "skirt", "none"] as const;
export const ACCESSORIES = ["glasses", "scarf", "hat", "conical-hat", "bow", "bag", "beard", "mustache", "bangle", "cane", "apron"] as const;

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
});
export type DollSpec = z.infer<typeof dollSchema>;

/** The kit's vocabulary, for the Cast prompt. */
export const DOLL_VOCABULARY = [
  `{"age": "child|adult|elder", "build": "slim|average|round", "skin": "#rrggbb", "hairStyle": "${HAIR_STYLES.join("|")}", "hairColor": "#rrggbb",`,
  ` "top": "${TOPS.join("|")}", "topColor": "#rrggbb", "bottom": "${BOTTOMS.join("|")}", "bottomColor": "#rrggbb", "accent": "#rrggbb",`,
  ` "accessories": [up to 4 of ${ACCESSORIES.map((a) => `"${a}"`).join(", ")}]}`,
].join("\n");

const n = (x: number) => String(Math.round(x * 10) / 10);

function mix(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `#${pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

interface Frame {
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

function proportions(spec: DollSpec): Frame {
  const k = spec.build === "slim" ? 0.88 : spec.build === "round" ? 1.22 : 1;
  const base =
    spec.age === "child"
      ? { headR: 80, headY: 132, shoulderY: 222, hipY: 396, shw: 58, hhw: 50, armW: 22, legW: 28 }
      : spec.age === "elder"
        ? { headR: 58, headY: 100, shoulderY: 176, hipY: 350, shw: 72, hhw: 58, armW: 24, legW: 30 }
        : { headR: 58, headY: 86, shoulderY: 160, hipY: 338, shw: 76, hhw: 60, armW: 24, legW: 31 };
  const footY = 592;
  return { cx: 200, ...base, shw: base.shw * k, hhw: base.hhw * k, footY, kneeY: base.hipY + (footY - base.hipY) * 0.5 };
}

/** One human character as a <symbol> (+ its gradient and clip path), ids prefixed by `id`. */
export function buildDoll(id: string, spec: DollSpec): string {
  const f = proportions(spec);
  const { cx, headR: R, headY: hy, shoulderY: sy, hipY: hp, kneeY: ky, footY: fy, shw, hhw, armW, legW } = f;
  const skinLight = mix(spec.skin, "#ffffff", 0.28);
  const skinShade = mix(spec.skin, "#3a2418", 0.18);
  const bottomColor = spec.bottomColor ?? mix(spec.topColor, "#1d1a26", 0.45);
  const has = (a: (typeof ACCESSORIES)[number]) => spec.accessories.includes(a);
  const long = spec.top === "robe" || spec.top === "kimono" || spec.top === "aodai";
  const hem = long ? fy - 46 : spec.top === "dress" ? ky + 10 : hp + 22;
  const hemHW = long ? hhw * 1.25 : spec.top === "dress" ? hhw * 1.55 : hhw + 6;
  const bulge = spec.build === "round" ? 18 : 0;
  const torso = `M${n(cx - shw)} ${n(sy + 10)} Q${n(cx - shw)} ${n(sy - 6)} ${n(cx - shw + 20)} ${n(sy - 8)} L${n(cx + shw - 20)} ${n(sy - 8)} Q${n(cx + shw)} ${n(sy - 6)} ${n(cx + shw)} ${n(sy + 10)} Q${n(cx + shw + bulge)} ${n((sy + hp) / 2)} ${n(cx + hemHW)} ${n(hem)} L${n(cx - hemHW)} ${n(hem)} Q${n(cx - shw - bulge)} ${n((sy + hp) / 2)} ${n(cx - shw)} ${n(sy + 10)} Z`;
  const legX = [cx - hhw * 0.45, cx + hhw * 0.45];
  const out: string[] = [];
  out.push(`<radialGradient id="${id}-skin" cx="0.38" cy="0.32" r="0.75"><stop offset="0" stop-color="${skinLight}"/><stop offset="1" stop-color="${spec.skin}"/></radialGradient>`);
  out.push(`<symbol id="${id}" viewBox="0 0 400 600">`);
  out.push(`<clipPath id="${id}-torso"><path d="${torso}"/></clipPath>`);
  out.push(`<ellipse cx="${cx}" cy="${fy + 2}" rx="${n(hhw * 1.7)}" ry="8" fill="#1d2233" fill-opacity="0.22"/>`);

  // Hair behind the head
  if (spec.hairStyle === "long") out.push(`<path d="M${n(cx - R - 6)} ${n(hy)} Q${n(cx - R - 14)} ${n(sy + 70)} ${n(cx - R + 14)} ${n(sy + 84)} L${n(cx + R - 14)} ${n(sy + 84)} Q${n(cx + R + 14)} ${n(sy + 70)} ${n(cx + R + 6)} ${n(hy)} Z" fill="${spec.hairColor}"/>`);
  if (spec.hairStyle === "bob") out.push(`<path d="M${n(cx - R - 8)} ${n(hy - 6)} Q${n(cx - R - 12)} ${n(hy + R)} ${n(cx - R + 10)} ${n(hy + R * 1.02)} L${n(cx + R - 10)} ${n(hy + R * 1.02)} Q${n(cx + R + 12)} ${n(hy + R)} ${n(cx + R + 8)} ${n(hy - 6)} Z" fill="${spec.hairColor}"/>`);
  if (spec.hairStyle === "ponytail") out.push(`<ellipse cx="${n(cx + R * 0.95)}" cy="${n(hy + R * 0.45)}" rx="${n(R * 0.3)}" ry="${n(R * 0.85)}" fill="${spec.hairColor}" transform="rotate(-18 ${n(cx + R * 0.95)} ${n(hy + R * 0.45)})"/>`);
  if (spec.hairStyle === "braids") for (const s of [-1, 1]) out.push(`<rect x="${n(cx + s * R * 0.82 - 11)}" y="${n(hy)}" width="22" height="${n(sy + 90 - hy)}" rx="11" fill="${spec.hairColor}"/>`);

  // Legs, shoes (drawn before the clothes so hems overlap them)
  const legTop = hp - 10;
  for (const x of legX) {
    const legColor = spec.bottom === "pants" && !long && spec.top !== "dress" ? bottomColor : spec.skin;
    out.push(`<rect x="${n(x - legW / 2)}" y="${n(legTop)}" width="${n(legW)}" height="${n(fy - 8 - legTop)}" rx="${n(legW / 2)}" fill="${legColor}"/>`);
    out.push(`<ellipse cx="${n(x + 4)}" cy="${n(fy - 6)}" rx="${n(legW * 0.9)}" ry="11" fill="#2b2530"/>`);
  }
  if (spec.bottom === "shorts" && !long && spec.top !== "dress") for (const x of legX) out.push(`<rect x="${n(x - legW / 2 - 3)}" y="${n(legTop)}" width="${n(legW + 6)}" height="${n((ky - legTop) * 0.7)}" rx="8" fill="${bottomColor}"/>`);
  if (spec.bottom === "skirt" && !long && spec.top !== "dress") out.push(`<path d="M${n(cx - hhw - 4)} ${n(hp - 12)} L${n(cx + hhw + 4)} ${n(hp - 12)} L${n(cx + hhw * 1.5)} ${n(ky)} L${n(cx - hhw * 1.5)} ${n(ky)} Z" fill="${bottomColor}"/>`);

  // Arms (sleeve + forearm) and hands
  const shortSleeve = spec.top === "tshirt" || spec.top === "dress";
  const hands: Array<[number, number]> = [];
  for (const s of [-1, 1]) {
    const x0 = cx + s * (shw - 10);
    const y0 = sy + 12;
    const x1 = cx + s * (shw + 14);
    const y1 = hp - 8;
    const mx = cx + s * (shw + 16);
    const my = (y0 + y1) / 2;
    out.push(`<path d="M${n(x0)} ${n(y0)} Q${n(mx)} ${n(my - 20)} ${n(x1)} ${n(y1)}" fill="none" stroke="${shortSleeve ? spec.skin : spec.topColor}" stroke-width="${n(armW)}" stroke-linecap="round"/>`);
    if (shortSleeve) out.push(`<path d="M${n(x0)} ${n(y0)} Q${n(x0 + s * 10)} ${n(y0 + 30)} ${n(x0 + s * 16)} ${n(y0 + 62)}" fill="none" stroke="${spec.topColor}" stroke-width="${n(armW + 6)}" stroke-linecap="round"/>`);
    hands.push([x1, y1 + 4]);
  }

  // Torso + shading side + garment details
  out.push(`<path d="${torso}" fill="${spec.topColor}"/>`);
  out.push(`<rect x="${cx + 6}" y="${n(sy - 12)}" width="${n(hemHW + bulge + 30)}" height="${n(hem - sy + 14)}" fill="#1d1a26" fill-opacity="0.13" clip-path="url(#${id}-torso)"/>`);
  if (spec.top === "shirt" || spec.top === "jacket") out.push(`<path d="M${cx} ${n(sy - 6)} L${cx} ${n(hem - 4)}" stroke="${spec.accent}" stroke-width="5"/>`);
  if (spec.top === "jacket") out.push(`<path d="M${n(cx - 26)} ${n(sy - 8)} L${cx} ${n(sy + 46)} L${n(cx + 26)} ${n(sy - 8)}" fill="none" stroke="${mix(spec.topColor, "#000000", 0.3)}" stroke-width="6"/>`);
  if (spec.top === "kimono") {
    out.push(`<path d="M${n(cx - 30)} ${n(sy - 8)} L${n(cx + 18)} ${n(sy + 70)}" stroke="${spec.accent}" stroke-width="9"/>`);
    out.push(`<rect x="${n(cx - hhw - 8)}" y="${n(hp - 46)}" width="${n(2 * hhw + 16)}" height="30" fill="${spec.accent}"/>`);
  }
  if (spec.top === "aodai") out.push(`<path d="M${n(cx - 16)} ${n(sy + 40)} L${n(cx - 26)} ${n(hem)} M${n(cx + 16)} ${n(sy + 40)} L${n(cx + 26)} ${n(hem)}" stroke="${spec.accent}" stroke-width="4"/>`);
  if (spec.top === "robe") out.push(`<rect x="${n(cx - hhw)}" y="${n(hp - 30)}" width="${n(2 * hhw)}" height="14" fill="${spec.accent}"/>`);
  if (has("apron")) out.push(`<path d="M${n(cx - hhw * 0.8)} ${n(sy + 60)} L${n(cx + hhw * 0.8)} ${n(sy + 60)} L${n(cx + hhw)} ${n(Math.min(hem, ky) - 6)} L${n(cx - hhw)} ${n(Math.min(hem, ky) - 6)} Z" fill="#f4efe4"/>`);
  if (has("bag")) {
    out.push(`<path d="M${n(cx - shw + 14)} ${n(sy)} L${n(cx + hhw + 10)} ${n(hp - 20)}" stroke="${spec.accent}" stroke-width="7"/>`);
    out.push(`<rect x="${n(cx + hhw - 6)}" y="${n(hp - 30)}" width="46" height="40" rx="8" fill="${spec.accent}"/>`);
  }
  if (spec.top !== "kimono" && spec.top !== "aodai") out.push(`<path d="M${n(cx - 24)} ${n(sy - 7)} Q${cx} ${n(sy + 18)} ${n(cx + 24)} ${n(sy - 7)}" fill="${skinShade}"/>`);

  for (const [x, y] of hands) out.push(`<circle cx="${n(x)}" cy="${n(y)}" r="${n(armW * 0.66)}" fill="url(#${id}-skin)"/>`);
  if (has("bangle")) out.push(`<circle cx="${n(hands[0][0])}" cy="${n(hands[0][1] - armW * 0.7)}" r="${n(armW * 0.55)}" fill="none" stroke="${spec.accent}" stroke-width="5"/>`);
  if (has("cane")) out.push(`<path d="M${n(hands[1][0])} ${n(hands[1][1] - 6)} L${n(hands[1][0] + 12)} ${n(fy - 4)}" stroke="#6b4a2b" stroke-width="8" stroke-linecap="round"/>`);

  // Neck, scarf, head
  out.push(`<rect x="${n(cx - R * 0.24)}" y="${n(hy + R * 0.8)}" width="${n(R * 0.48)}" height="${n(sy - hy - R * 0.8 + 2)}" fill="${skinShade}"/>`);
  if (has("scarf")) {
    out.push(`<rect x="${n(cx - shw * 0.62)}" y="${n(sy - 18)}" width="${n(shw * 1.24)}" height="26" rx="13" fill="${spec.accent}"/>`);
    out.push(`<rect x="${n(cx + shw * 0.2)}" y="${n(sy)}" width="24" height="78" rx="10" fill="${mix(spec.accent, "#000000", 0.15)}"/>`);
  }
  for (const s of [-1, 1]) out.push(`<ellipse cx="${n(cx + s * R * 0.96)}" cy="${n(hy + R * 0.12)}" rx="${n(R * 0.16)}" ry="${n(R * 0.22)}" fill="${spec.skin}"/>`);
  out.push(`<circle cx="${cx}" cy="${hy}" r="${R}" fill="url(#${id}-skin)"/>`);

  // Face
  const eyeY = hy + R * 0.12;
  for (const s of [-1, 1]) {
    const ex = cx + s * R * 0.36;
    out.push(`<ellipse cx="${n(ex)}" cy="${n(eyeY)}" rx="${n(R * 0.1)}" ry="${n(R * (spec.age === "elder" ? 0.08 : 0.14))}" fill="#2a2233"/>`);
    if (spec.age !== "elder") out.push(`<circle cx="${n(ex + R * 0.035)}" cy="${n(eyeY - R * 0.05)}" r="${n(R * 0.045)}" fill="#ffffff"/>`);
    out.push(`<path d="M${n(ex - R * 0.15)} ${n(eyeY - R * 0.27)} Q${n(ex)} ${n(eyeY - R * 0.36)} ${n(ex + R * 0.15)} ${n(eyeY - R * 0.27)}" fill="none" stroke="${spec.hairStyle === "bald" ? "#8a8a8a" : spec.hairColor}" stroke-width="${n(R * 0.07)}" stroke-linecap="round"/>`);
    out.push(`<circle cx="${n(cx + s * R * 0.56)}" cy="${n(eyeY + R * 0.3)}" r="${n(R * 0.16)}" fill="#ff8a80" fill-opacity="0.4"/>`);
    if (spec.age === "elder") out.push(`<path d="M${n(ex + s * R * 0.16)} ${n(eyeY - R * 0.02)} l${n(s * R * 0.1)} ${n(-R * 0.05)} M${n(ex + s * R * 0.16)} ${n(eyeY + R * 0.06)} l${n(s * R * 0.1)} ${n(R * 0.03)}" stroke="${skinShade}" stroke-width="3" stroke-linecap="round"/>`);
  }
  out.push(`<ellipse cx="${cx}" cy="${n(hy + R * 0.3)}" rx="${n(R * 0.07)}" ry="${n(R * 0.05)}" fill="${skinShade}"/>`);
  const my = hy + R * 0.48;
  out.push(`<path d="M${n(cx - R * 0.17)} ${n(my)} Q${cx} ${n(my + R * 0.15)} ${n(cx + R * 0.17)} ${n(my)}" fill="none" stroke="#8a3a2a" stroke-width="${n(R * 0.06)}" stroke-linecap="round"/>`);
  if (has("mustache")) out.push(`<path d="M${n(cx - R * 0.3)} ${n(my - R * 0.02)} Q${cx} ${n(my - R * 0.2)} ${n(cx + R * 0.3)} ${n(my - R * 0.02)} Q${cx} ${n(my - R * 0.08)} ${n(cx - R * 0.3)} ${n(my - R * 0.02)} Z" fill="${spec.hairColor}"/>`);
  if (has("beard")) out.push(`<path d="M${n(cx - R * 0.7)} ${n(hy + R * 0.35)} Q${n(cx - R * 0.5)} ${n(hy + R * 1.35)} ${cx} ${n(hy + R * 1.4)} Q${n(cx + R * 0.5)} ${n(hy + R * 1.35)} ${n(cx + R * 0.7)} ${n(hy + R * 0.35)} Q${cx} ${n(hy + R * 0.9)} ${n(cx - R * 0.7)} ${n(hy + R * 0.35)} Z" fill="${spec.hairColor}"/>`);
  if (has("glasses")) {
    for (const s of [-1, 1]) out.push(`<circle cx="${n(cx + s * R * 0.36)}" cy="${n(eyeY)}" r="${n(R * 0.22)}" fill="none" stroke="#2a2233" stroke-width="4"/>`);
    out.push(`<path d="M${n(cx - R * 0.14)} ${n(eyeY)} L${n(cx + R * 0.14)} ${n(eyeY)}" stroke="#2a2233" stroke-width="4"/>`);
  }

  // Hair in front
  if (spec.hairStyle !== "bald") {
    const top = hy - R - 10;
    const fringe =
      spec.hairStyle === "spiky"
        ? `M${n(cx - R - 4)} ${n(hy + 4)} L${n(cx - R * 0.8)} ${n(top + 8)} L${n(cx - R * 0.5)} ${n(top + 22)} L${n(cx - R * 0.2)} ${n(top - 4)} L${n(cx + R * 0.1)} ${n(top + 18)} L${n(cx + R * 0.45)} ${n(top - 2)} L${n(cx + R * 0.7)} ${n(top + 20)} L${n(cx + R + 4)} ${n(hy + 4)} Q${n(cx + R * 0.5)} ${n(hy - R * 0.45)} ${cx} ${n(hy - R * 0.5)} Q${n(cx - R * 0.5)} ${n(hy - R * 0.45)} ${n(cx - R - 4)} ${n(hy + 4)} Z`
        : `M${n(cx - R - 3)} ${n(hy + 6)} Q${n(cx - R - 2)} ${n(top)} ${cx} ${n(top)} Q${n(cx + R + 2)} ${n(top)} ${n(cx + R + 3)} ${n(hy + 6)} Q${n(cx + R * 0.55)} ${n(hy - R * 0.42)} ${n(cx + R * 0.05)} ${n(hy - R * 0.5)} Q${n(cx - R * 0.6)} ${n(hy - R * 0.4)} ${n(cx - R - 3)} ${n(hy + 6)} Z`;
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
  out.push("</symbol>");
  return out.join("\n");
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
export function buildCritter(id: string, spec: CritterSpec): string {
  const cx = 200;
  const k = spec.size === "small" ? 0.9 : spec.size === "large" ? 1.08 : 1;
  const R = 100 * k; // head radius
  const hy = Math.max(600 - 560 * (spec.size === "small" ? 0.86 : 1) + R + 20, spec.ears === "long" ? 1.9 * R + 8 : 0); // head centre (long ears stay inside the viewBox)
  const by = hy + R * 2.05; // body centre
  const bry = Math.min(592 - 40 - by, R * 1.25); // body half-height
  const brx = R * 0.92;
  const fy = 592;
  const dark = mix(spec.fur, "#1d1a26", 0.35);
  const light = mix(spec.fur, "#ffffff", 0.25);
  const has = (a: (typeof CRITTER_ACCESSORIES)[number]) => spec.accessories.includes(a);
  const out: string[] = [];
  out.push(`<radialGradient id="${id}-fur" cx="0.38" cy="0.32" r="0.8"><stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${spec.fur}"/></radialGradient>`);
  out.push(`<symbol id="${id}" viewBox="0 0 400 600">`);
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
  for (const s of [-1, 1]) {
    const lx = cx + s * brx * 0.45;
    out.push(`<rect x="${n(lx - R * 0.2)}" y="${n(by + bry * 0.4)}" width="${n(R * 0.4)}" height="${n(fy - 10 - by - bry * 0.4)}" rx="${n(R * 0.2)}" fill="${spec.fur}"/>`);
    out.push(`<ellipse cx="${n(lx + s * 6)}" cy="${n(fy - 10)}" rx="${n(R * 0.32)}" ry="${n(R * 0.16)}" fill="${dark}"/>`);
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
    const x1 = cx + s * brx * 1.1;
    const y1 = by + bry * 0.25;
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
  const eyeY = hy - R * 0.08;
  if (spec.muzzle === "pointed") {
    out.push(`<path d="M${n(cx - R * 0.72)} ${n(hy + R * 0.05)} Q${cx} ${n(hy - R * 0.12)} ${n(cx + R * 0.72)} ${n(hy + R * 0.05)} Q${n(cx + R * 0.35)} ${n(hy + R * 0.6)} ${cx} ${n(hy + R * 0.66)} Q${n(cx - R * 0.35)} ${n(hy + R * 0.6)} ${n(cx - R * 0.72)} ${n(hy + R * 0.05)} Z" fill="${spec.belly}"/>`);
  } else if (spec.muzzle === "round") {
    out.push(`<ellipse cx="${cx}" cy="${n(hy + R * 0.34)}" rx="${n(R * 0.42)}" ry="${n(R * 0.3)}" fill="${spec.belly}"/>`);
  } else {
    out.push(`<ellipse cx="${cx}" cy="${n(hy + R * 0.42)}" rx="${n(R * 0.55)}" ry="${n(R * 0.32)}" fill="${spec.belly}"/>`);
    for (const s of [-1, 1]) out.push(`<ellipse cx="${n(cx + s * R * 0.2)}" cy="${n(hy + R * 0.42)}" rx="${n(R * 0.06)}" ry="${n(R * 0.09)}" fill="${dark}"/>`);
  }
  for (const s of [-1, 1]) {
    const ex = cx + s * R * 0.36;
    out.push(`<ellipse cx="${n(ex)}" cy="${n(eyeY)}" rx="${n(R * 0.1)}" ry="${n(R * 0.13)}" fill="#1d1a26"/>`);
    out.push(`<circle cx="${n(ex + R * 0.035)}" cy="${n(eyeY - R * 0.045)}" r="${n(R * 0.042)}" fill="#ffffff"/>`);
    out.push(`<circle cx="${n(cx + s * R * 0.6)}" cy="${n(eyeY + R * 0.3)}" r="${n(R * 0.13)}" fill="#ff8a80" fill-opacity="0.35"/>`);
  }
  const noseY = spec.muzzle === "pointed" ? hy + R * 0.55 : spec.muzzle === "round" ? hy + R * 0.22 : hy + R * 0.3;
  if (spec.muzzle !== "flat") out.push(`<ellipse cx="${cx}" cy="${n(noseY)}" rx="${n(R * 0.11)}" ry="${n(R * 0.08)}" fill="#1d1a26"/>`);
  out.push(`<path d="M${n(cx - R * 0.12)} ${n(noseY + R * 0.12)} Q${cx} ${n(noseY + R * 0.22)} ${n(cx + R * 0.12)} ${n(noseY + R * 0.12)}" fill="none" stroke="#1d1a26" stroke-width="${n(R * 0.045)}" stroke-linecap="round"/>`);
  if (has("glasses")) {
    for (const s of [-1, 1]) out.push(`<circle cx="${n(cx + s * R * 0.36)}" cy="${n(eyeY)}" r="${n(R * 0.2)}" fill="none" stroke="#2a2233" stroke-width="4"/>`);
    out.push(`<path d="M${n(cx - R * 0.16)} ${n(eyeY)} L${n(cx + R * 0.16)} ${n(eyeY)}" stroke="#2a2233" stroke-width="4"/>`);
  }
  if (has("bow")) out.push(`<path d="M${n(cx + R * 0.35)} ${n(hy - R * 0.78)} l-24 -16 l0 32 Z M${n(cx + R * 0.35)} ${n(hy - R * 0.78)} l24 -16 l0 32 Z" fill="${spec.accent}"/>`);
  if (has("hat")) {
    out.push(`<ellipse cx="${cx}" cy="${n(hy - R * 0.72)}" rx="${n(R * 1.05)}" ry="${n(R * 0.18)}" fill="${spec.accent}"/>`);
    out.push(`<path d="M${n(cx - R * 0.6)} ${n(hy - R * 0.72)} Q${n(cx - R * 0.6)} ${n(hy - R * 1.45)} ${cx} ${n(hy - R * 1.45)} Q${n(cx + R * 0.6)} ${n(hy - R * 1.45)} ${n(cx + R * 0.6)} ${n(hy - R * 0.72)} Z" fill="${spec.accent}"/>`);
  }
  out.push("</symbol>");
  return out.join("\n");
}
