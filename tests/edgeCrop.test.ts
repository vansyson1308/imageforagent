import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { validateDrawing } from "@/lib/services/director/artist";
import type { KitSpec } from "@/lib/services/director/cast";
import { demoPlan, DEMO_LIBRARY } from "@/lib/services/director/demoCrew";
import { buildDoll, dollSchema } from "@/lib/services/director/dollKit";
import { edgeCuts, figureLight, GATE } from "@/lib/services/director/frameGates";
import { planSchema } from "@/lib/services/director/schemas";
import { tintUnderFigures, withoutUses } from "@/lib/services/director/svgTools";
import { renderArtwork } from "@/lib/services/svgRenderer";

/**
 * Edge crop and night readability (owner QC 2026-10-10, sprint c): no
 * character is cut by the frame edge unless the plan has it leave or enter,
 * and in a night or dark frame every figure keeps its own light and stands out
 * from what is behind it.
 */
const spec = dollSchema.parse({ age: "child", skin: "#f1c9a5", hairStyle: "bob", hairColor: "#2b1d16", top: "tshirt", topColor: "#e8b04a", bottom: "shorts", bottomColor: "#5b6b3a", accent: "#d9483b", accessories: [] });
const kits: ReadonlyMap<string, KitSpec> = new Map([["kid", { kind: "doll", spec }]]);
const DAY = `<symbol id="day" viewBox="0 0 1920 1080"><rect width="1920" height="1080" fill="#9fd3f0"/><circle cx="1500" cy="200" r="90" fill="#fff3b0"/><path d="M0 760 Q480 680 960 760 T1920 740 L1920 1080 L0 1080 Z" fill="#7ccf7c"/><rect x="200" y="480" width="360" height="300" fill="#e2b07a"/><polygon points="180,480 380,340 580,480" fill="#8a4b2a"/><rect x="1300" y="560" width="40" height="220" fill="#6b4a2f"/><circle cx="1320" cy="520" r="120" fill="#3f8a4a"/></symbol>`;
const defs = DEMO_LIBRARY + buildDoll("kid", spec) + DAY;
const canvas = { w: 1920, h: 1080 };
const base = planSchema.parse(demoPlan("One. Two.", 2)).shots[0];
const opts = (shotType: string, description: string, set = "day") => ({
  castDefs: defs,
  symbols: ["hero", "home", "kid", "day"],
  aspectRatio: "16:9",
  shot: { ...base, scene: "SC1", shotType, description, cast: ["kid", set], mode: "still" as const },
  index: 1,
  canvas,
  fps: 12,
  characters: ["kid"],
  sets: ["home", "day"],
  kits,
});
const fence = (body: string) => `\`\`\`svg\n${body}\n\`\`\``;
const bg = (set = "day") => `<use href="#${set}" x="0" y="0" width="1920" height="1080"/>`;

describe("edge crop", () => {
  it("names the sides a visible box touches; the bottom only matters in a wide shot", () => {
    expect(edgeCuts({ x0: 0, x1: 0.07, y1: 0.99 }, false)).toEqual(["left"]);
    expect(edgeCuts({ x0: 0.8, x1: 1, y1: 0.998 }, false)).toEqual(["right"]);
    expect(edgeCuts({ x0: 0.3, x1: 0.5, y1: 0.999 }, true)).toEqual(["bottom"]);
    expect(edgeCuts({ x0: 0.3, x1: 0.5, y1: 0.999 }, false)).toEqual([]);
  });

  it("the engine slides a plainly placed figure cut by a side back inside", async () => {
    const d = await validateDrawing(fence(`${bg()}<use href="#kid" x="-260" y="260" width="520" height="780"/>`), opts("Medium shot", "Mai waves at the sky"));
    expect(d.checks?.problems).toEqual([]);
    expect(d.checks?.facts.join(" ")).toMatch(/fixed by the engine: #kid moved \d+% of the frame right \(the left edge cut it\)/);
    const x = Number(d.svg.match(/href="#kid" x="(-?\d+)"/)![1]);
    expect(x).toBeGreaterThan(-260);
  });

  it("a figure the engine can't move is sent back to the Artist, and a cut is allowed when the plan has an exit or entry", async () => {
    const cut = `${bg()}<g transform="translate(-260 0)"><use href="#kid" x="0" y="260" width="520" height="780"/></g>`;
    await expect(validateDrawing(fence(cut), opts("Medium shot", "Mai waves at the sky"))).rejects.toThrow(/#kid is cut by the left edge of the frame/);
    const exit = await validateDrawing(fence(cut), opts("Medium shot", "Mai runs out of frame to the left"));
    expect(exit.checks?.facts.join(" ")).toMatch(/#kid cut by the left edge \(the plan has an exit\/entry/);
  });

  it("in a wide shot the feet stay in frame", async () => {
    await expect(validateDrawing(fence(`${bg()}<use href="#kid" x="760" y="560" width="400" height="600"/>`), opts("Wide shot", "Mai in the garden"))).rejects.toThrow(/#kid is cut by the bottom edge[^;]*feet stay in frame/);
  });
});

describe("night readability", () => {
  const NIGHT = "At night Mai looks at the moon";
  const tintAfter = `${bg("home")}<use href="#kid" x="700" y="260" width="520" height="780"/><rect width="1920" height="1080" fill="#050a1e" fill-opacity="0.8"/>`;

  it("moves a full-frame tint drawn over the figures under them", () => {
    const t = tintUnderFigures(tintAfter, ["kid"], canvas);
    expect(t?.svg.indexOf("<rect")).toBeLessThan(t!.svg.indexOf('href="#kid"'));
    expect(t?.svg.indexOf("<rect")).toBeGreaterThan(t!.svg.indexOf('href="#home"'));
    // nothing to move: the tint already sits under the figure, or a small rect is not a tint
    expect(tintUnderFigures(t!.svg, ["kid"], canvas)).toBeNull();
    expect(tintUnderFigures(`${bg("home")}<use href="#kid" x="700" y="260" width="520" height="780"/><rect x="100" y="100" width="300" height="200" fill="#000" fill-opacity="0.5"/>`, ["kid"], canvas)).toBeNull();
  });

  it("a figure darkened by a tint over it fails; the engine moves the tint and the frame passes", async () => {
    const d = await validateDrawing(fence(tintAfter), opts("Medium shot", NIGHT, "home"));
    expect(d.checks?.problems).toEqual([]);
    expect(d.checks?.facts.join(" ")).toMatch(/full-frame tint\(s\) moved under the characters/);
    expect(d.checks?.facts.join(" ")).toMatch(/#kid readable in the dark \(brightness \d+\/255, contrast \d+\)/);
    const grouped = `${bg("home")}<g><use href="#kid" x="700" y="260" width="520" height="780"/><rect width="1920" height="1080" fill="#050a1e" fill-opacity="0.8"/></g>`;
    await expect(validateDrawing(fence(grouped), opts("Medium shot", NIGHT, "home"))).rejects.toThrow(/#kid is hard to see in this dark frame \(figure brightness \d+\/255/);
  });

  it("calibration: every figure in the v1 showcase night frames reads (the thresholds sit below the real films)", async () => {
    const dir = (film: string, f: string) => readFileSync(path.join(process.cwd(), "tests/fixtures/v1-showcase", film, f), "utf8");
    for (const film of ["den-long", "kitsune"]) {
      const fdefs = dir(film, "defs.svg");
      const meta = JSON.parse(dir(film, "meta.json")) as { characters: string[]; shots: { cast: string[] }[] };
      for (let i = 1; i <= meta.shots.length; i++) {
        const svg = dir(film, `f${String(i).padStart(2, "0")}.svg`);
        const png = await renderArtwork(fdefs, svg, "16:9", "1K");
        for (const c of meta.shots[i - 1].cast.filter((x) => meta.characters.includes(x))) {
          const l = await figureLight(png, await renderArtwork(fdefs, withoutUses(svg, c), "16:9", "1K"));
          if (!l) continue;
          expect(l.lum, `${film}/${i} #${c}`).toBeGreaterThanOrEqual(GATE.nightFigureLum);
          expect(l.contrast, `${film}/${i} #${c}`).toBeGreaterThanOrEqual(GATE.nightFigureContrast);
        }
      }
    }
  }, 120_000);
});
