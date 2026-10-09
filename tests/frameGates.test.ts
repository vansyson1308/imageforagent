import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderArtwork } from "@/lib/services/svgRenderer";
import { visibleBox, withoutUses } from "@/lib/services/director/svgTools";
import { closeUpProblem, emptyFrameProblem, GATE, measureFrame, nearDuplicateProblem, readableSetProblem, similarity, thumb } from "@/lib/services/director/frameGates";

// Calibration on the REAL v1 showcase frames, rebuilt exactly from their traces
// (scripts/director/replay-frames.ts → tests/fixtures/v1-showcase/<film>/).
// The spec names tea-house shot 3 (abstract blocks, no character) and shot 8
// (a close-up pasted over a brown rectangle) as broken; they must fail, and
// every other v1 frame must pass.

const FILMS = ["tea-house", "den-long", "kitsune"] as const;
const BROKEN = new Set(["tea-house/3", "tea-house/8"]);
const canvas = { w: 1920, h: 1080 };

interface Meta {
  characters: string[];
  shots: Array<{ shotType: string; cast: string[] }>;
}

const fx = (film: string, f: string) => readFileSync(path.join(process.cwd(), "tests/fixtures/v1-showcase", film, f), "utf8");

async function frames(film: string) {
  const defs = fx(film, "defs.svg");
  const meta = JSON.parse(fx(film, "meta.json")) as Meta;
  const out = [];
  for (let i = 1; i <= meta.shots.length; i++) {
    const svg = fx(film, `f${String(i).padStart(2, "0")}.svg`);
    let bgSvg = svg;
    for (const c of meta.characters) bgSvg = withoutUses(bgSvg, c);
    const png = await renderArtwork(defs, svg, "16:9", "1K");
    const bg = await renderArtwork(defs, bgSvg, "16:9", "1K");
    out.push({ i, svg, png, bg, defs, shot: meta.shots[i - 1], meta });
  }
  return out;
}

describe("frame gates, calibrated on the v1 showcase", () => {
  it("readable set: the two broken tea-house frames fail with a measured hint, every other v1 frame passes", async () => {
    const verdicts: string[] = [];
    for (const film of FILMS) {
      for (const f of await frames(film)) {
        const p = readableSetProblem(await measureFrame(f.bg), canvas);
        expect(Boolean(p), `${film}/${f.i}: ${p}`).toBe(BROKEN.has(`${film}/${f.i}`));
        if (p) verdicts.push(`${film}/${f.i}`);
        if (p) expect(p).toMatch(/^\d+% of the frame is plain flat rectangles .*#[0-9a-f]{6} \d+×\d+ at \(\d+,\d+\)/);
      }
    }
    expect(verdicts).toEqual(["tea-house/3", "tea-house/8"]);
  }, 120_000);

  it("close-up framing: tea-house shot 8's subject sits on a flat rectangle; the good v1 close-ups pass", async () => {
    for (const film of FILMS) {
      for (const f of await frames(film)) {
        if (!/close/i.test(f.shot.shotType)) continue;
        const who = f.shot.cast.find((c) => f.meta.characters.includes(c));
        if (!who) continue;
        const box = await visibleBox(f.png, await renderArtwork(f.defs, withoutUses(f.svg, who), "16:9", "1K"));
        const p = closeUpProblem(await measureFrame(f.bg), box!, canvas);
        expect(Boolean(p), `${film}/${f.i}: ${p}`).toBe(film === "tea-house" && f.i === 8);
        if (p) expect(p).toMatch(/plain #[0-9a-f]{6} rectangle \(\d+×\d+\) that cuts behind the head/);
      }
    }
  }, 120_000);

  it("near-duplicates: tea-house 1→2 and 4→5 reuse one composition; distinct cuts pass", async () => {
    const flagged: string[] = [];
    for (const film of FILMS) {
      const fs = await frames(film);
      for (let k = 1; k < fs.length; k++) {
        const sim = similarity(await thumb(fs[k - 1].png), await thumb(fs[k].png));
        if (nearDuplicateProblem(sim, fs[k - 1].i, fs[k].shot.shotType)) flagged.push(`${film}/${fs[k - 1].i}→${fs[k].i}`);
      }
    }
    expect(flagged).toEqual(["tea-house/1→2", "tea-house/4→5"]);
    expect(nearDuplicateProblem(0.95, 3, "Wide shot")).toMatch(/95% similar to shot 3 .*close-up/);
    expect(nearDuplicateProblem(GATE.maxSimilarity - 0.01, 3, "Wide shot")).toBeNull();
  }, 120_000);

  it("empty frame: a near-blank render fails, every v1 frame passes", async () => {
    for (const film of FILMS) for (const f of await frames(film)) expect(emptyFrameProblem(await measureFrame(f.png)), `${film}/${f.i}`).toBeNull();
    const blank = await renderArtwork("", '<rect width="1920" height="1080" fill="#20243a"/><circle cx="960" cy="540" r="40" fill="#f4b23c"/>', "16:9", "1K");
    expect(emptyFrameProblem(await measureFrame(blank))).toMatch(/nearly empty/);
  }, 120_000);
});
