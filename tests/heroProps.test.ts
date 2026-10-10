import { describe, expect, it } from "vitest";
import { attachHeldProps, faceOf, kitPlacements, placementMap } from "@/lib/services/director/acting";
import { validateDrawing } from "@/lib/services/director/artist";
import type { KitSpec } from "@/lib/services/director/cast";
import { demoPlan, DEMO_LIBRARY } from "@/lib/services/director/demoCrew";
import { buildDoll, dollSchema, variantId } from "@/lib/services/director/dollKit";
import { coverageProblems, heroProp } from "@/lib/services/director/plan";
import { planSchema, type Plan } from "@/lib/services/director/schemas";
import { minPropArea } from "@/lib/services/director/svgTools";

/**
 * Hero props (owner QC 2026-10-10, story fidelity): the Bible's key objects
 * must be in their shots and story-sized, a character in the `hold` pose holds
 * the shot's prop in its hands, and the key object gets its own insert shot.
 */
const spec = dollSchema.parse({ age: "child", skin: "#f1c9a5", hairStyle: "bob", hairColor: "#2b1d16", top: "tshirt", topColor: "#e8b04a", bottom: "shorts", bottomColor: "#5b6b3a", accent: "#d9483b", accessories: [] });
const kits: ReadonlyMap<string, KitSpec> = new Map([["kid", { kind: "doll", spec }]]);
const KITE = `<symbol id="kite" viewBox="0 0 400 400"><path d="M200 20 L380 200 L200 380 L20 200 Z" fill="#d9603b"/><path d="M200 20 L200 380 M20 200 L380 200" stroke="#7a2a12" stroke-width="10"/><circle cx="200" cy="200" r="20" fill="#f4b23c"/><path d="M200 380 Q230 395 210 400" stroke="#7a2a12" stroke-width="6" fill="none"/><circle cx="380" cy="200" r="8" fill="#7a2a12"/></symbol>`;
const defs = DEMO_LIBRARY + buildDoll("kid", spec) + buildDoll("kid", spec, { pose: "hold", expression: "smile" }) + KITE;
const canvas = { w: 1920, h: 1080 };
const base = planSchema.parse(demoPlan("One. Two.", 2));
const shot = (shotType: string, cast: string[]) => ({ ...base.shots[0], shotType, cast, mode: "still" as const });
const opts = (shotType: string, cast: string[]) => ({ castDefs: defs, symbols: ["hero", "home", "kid", "kite"], aspectRatio: "16:9", shot: shot(shotType, cast), index: 1, canvas, fps: 12, characters: ["kid"], sets: ["home"], props: ["kite"], kits });
const HOLD = variantId("kid", "hold", "smile");

describe("hold: the prop goes to the hands", () => {
  it("moves the shot's prop from wherever the Artist put it to the hands anchor, drawn after the holder", () => {
    const svg = `<use href="#home" x="0" y="0" width="1920" height="1080"/><use href="#kite" x="1500" y="80" width="300" height="300"/><use href="#${HOLD}" x="700" y="300" width="480" height="720"/>`;
    const out = attachHeldProps(svg, shot("Medium shot", ["kid", "kite", "home"]), kits, ["kite"]);
    expect(out.svg.match(/href="#kite"/g)).toHaveLength(1);
    const holder = kitPlacements(svg, kits)[0];
    const { s, ox, oy } = placementMap(holder);
    const hand = faceOf(kits.get("kid")!, "hold", "smile").hands;
    const kite = out.svg.match(/<use href="#kite" x="(-?\d+)" y="(-?\d+)" width="(\d+)" height="(\d+)"\/>/)!.slice(1).map(Number);
    // centred on the hands, a quarter of the figure tall, and painted after the holder
    expect(Math.abs(kite[0] + kite[2] / 2 - (ox + hand.x * s))).toBeLessThanOrEqual(1);
    expect(kite[1] + kite[3]).toBeGreaterThan(oy + hand.y * s);
    expect(kite[2]).toBe(Math.round(600 * s * 0.26));
    expect(out.svg.indexOf('href="#kite"')).toBeGreaterThan(out.svg.indexOf(`href="#${HOLD}"`));
    expect(out.notes[0]).toMatch(/#kite put in #kid's hands \(hold\)/);
  });

  it("leaves a painting alone when nobody holds or the shot has no prop", () => {
    const standing = `<use href="#home" x="0" y="0" width="1920" height="1080"/><use href="#kid" x="700" y="300" width="480" height="720"/><use href="#kite" x="100" y="100" width="200" height="200"/>`;
    expect(attachHeldProps(standing, shot("Medium shot", ["kid", "kite"]), kits, ["kite"]).svg).toBe(standing);
    const holding = standing.replace('href="#kid"', `href="#${HOLD}"`);
    expect(attachHeldProps(holding, shot("Medium shot", ["kid"]), kits, ["kite"]).svg).toBe(holding);
  });

  it("validateDrawing applies it before the gates, and reports it", async () => {
    const svg = `\`\`\`svg\n<use href="#home" x="0" y="0" width="1920" height="1080"/><use href="#kite" x="1700" y="900" width="60" height="60"/><use href="#${HOLD}" x="700" y="260" width="520" height="780"/>\n\`\`\``;
    const d = await validateDrawing(svg, opts("Medium shot", ["kid", "kite", "home"]));
    expect(d.svg.indexOf('href="#kite"')).toBeGreaterThan(d.svg.indexOf(`href="#${HOLD}"`));
    expect(d.checks?.facts.join(" ")).toMatch(/#kite put in #kid's hands/);
    expect(d.checks?.facts.join(" ")).toMatch(/#kite visible, [\d.]+% of the frame/);
  });
});

describe("prop gate: the key prop is in the shot and story-sized", () => {
  it("rejects a planned prop that isn't placed, or is too small for the shot type", async () => {
    const kid = '<use href="#kid" x="700" y="260" width="520" height="780"/>';
    const bg = '<use href="#home" x="0" y="0" width="1920" height="1080"/>';
    await expect(validateDrawing(`\`\`\`svg\n${bg}${kid}\n\`\`\``, opts("Medium shot", ["kid", "kite", "home"]))).rejects.toThrow(/#kite \(a key prop of this shot\) is not placed/);
    await expect(validateDrawing(`\`\`\`svg\n${bg}${kid}<use href="#kite" x="300" y="700" width="40" height="40"/>\n\`\`\``, opts("Medium shot", ["kid", "kite", "home"]))).rejects.toThrow(/#kite \(a key prop\) shows only [\d.]+% of the frame; a "Medium shot" needs at least 0\.40%/);
    const ok = await validateDrawing(`\`\`\`svg\n${bg}${kid}<use href="#kite" x="300" y="560" width="220" height="220"/>\n\`\`\``, opts("Medium shot", ["kid", "kite", "home"]));
    expect(ok.checks?.problems).toEqual([]);
  });

  it("an insert of the prop must fill much more of the frame than a wide shot", () => {
    expect(minPropArea("Insert: the kite")).toBeGreaterThan(minPropArea("Close-up"));
    expect(minPropArea("Close-up")).toBeGreaterThan(minPropArea("Medium shot"));
    expect(minPropArea("Medium shot")).toBeGreaterThan(minPropArea("Wide shot"));
  });
});

describe("the key object gets its own insert", () => {
  const withProp = (types: string[]): Plan => {
    const p = planSchema.parse(demoPlan("A. B. C. D. E.", 5));
    return {
      ...p,
      cast: [...p.cast, { id: "kite", name: "Kite", kind: "prop", look: "a red paper kite", colors: ["#d9603b"] }],
      shots: types.map((shotType, i) => ({ ...p.shots[i % p.shots.length], shotType, cast: [...p.shots[0].cast, ...(i % 2 === 0 ? ["kite"] : [])] })),
    };
  };
  it("names the prop seen in the most shots, and asks for an insert of it when none is planned", () => {
    const none = withProp(["Wide shot", "Medium shot", "Medium shot", "Close-up", "Wide shot"]);
    expect(heroProp(none)).toBe("kite");
    expect(coverageProblems(none).join(" ")).toMatch(/no insert of the key prop #kite/);
    const insert = withProp(["Wide shot", "Medium shot", "Insert: the kite", "Close-up", "Wide shot"]);
    expect(coverageProblems(insert).join(" ")).not.toMatch(/no insert of the key prop/);
  });
});
