import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { coverageProblems, normalizePlan, shotSize } from "@/lib/services/director/plan";
import { planSchema } from "@/lib/services/director/schemas";
import { renderScoreBed, scoreCues, shotMood } from "@/lib/services/director/scoreBed";
import { decodeWav, audioDuration } from "@/lib/services/audio/wav";
import { measureLoudness } from "@/lib/services/audio/loudness";
import { demoPlan } from "@/lib/services/director/demoCrew";
import type { TimelineEntry } from "@/lib/services/timeline";

const STORY6 = "Maya runs on the beach. The kite tears. She cries at home. Grandpa sews it. They walk back. The kite flies high.";
const teaHouse = planSchema.parse(JSON.parse(readFileSync(path.join(process.cwd(), "public/showcase/tea-house/trace.json"), "utf8")).bible);

describe("coverage (WP4.2)", () => {
  it("classifies shot sizes in EN/VI/JA", () => {
    expect(["Wide shot", "Medium shot", "Close-up", "Insert: the cup", "Cận cảnh", "Toàn cảnh", "ロングショット", "Pan"].map(shotSize)).toEqual(["wide", "medium", "close", "insert", "close", "wide", "wide", "other"]);
  });

  it("passes the real v1 tea-house plan (its repetition was visual: the render gate catches it), flags a flat plan", () => {
    expect(coverageProblems(teaHouse)).toEqual([]);
    const flat = planSchema.parse({ ...teaHouse, shots: teaHouse.shots.map((s) => ({ ...s, shotType: "Medium shot", cast: ["grandma-hoa", "tea-house"], scene: "One" })) });
    const p = coverageProblems(flat);
    expect(p.join(" ")).toMatch(/only 1 shot size/);
    expect(p.join(" ")).toMatch(/shots 1 and 2, 2 and 3, 3 and 4, 4 and 5 \(\+3 more\) have the same size \(medium\) and the same cast/);
    expect(p.join(" ")).toMatch(/one scene and one set/);
    expect(p.join(" ")).toMatch(/no establishing wide shot/);
    const varied = planSchema.parse({
      ...demoPlan(STORY6, 6),
      shots: ["Wide shot", "Medium shot", "Close-up", "Wide shot", "Insert: the kite", "Close-up"].map((t, i) => ({ ...demoPlan(STORY6, 6).shots[i], shotType: t, scene: i < 3 ? "Beach" : "Kitchen" })),
    });
    expect(coverageProblems(varied)).toEqual([]);
  });

  it("a cut into a new scene becomes a dissolve; within a scene it stays a cut", () => {
    const p = planSchema.parse({ ...demoPlan(STORY6, 3), shots: demoPlan(STORY6, 3).shots.map((s, i) => ({ ...s, scene: i < 2 ? "S1" : "S2", transition: "cut" })) });
    expect(normalizePlan(p, 3).shots.map((s) => s.transition)).toEqual(["cut", "cut", "dissolve"]);
  });
});

describe("score bed (WP4.6)", () => {
  const tl = (durs: number[]): TimelineEntry[] => {
    let t = 0;
    return durs.map((d, i) => {
      const e = { index: i + 1, startSec: t, durationSec: d } as TimelineEntry;
      t += d;
      return e;
    });
  };

  it("mood from the plan, else from the words of the shot (EN/VI/JA)", () => {
    expect(shotMood({ mood: "festival", description: "x", dialogue: null })).toBe("festival");
    expect(shotMood({ description: "The moon rises over the lake at night.", dialogue: null })).toBe("night");
    expect(shotMood({ description: "Bé An khóc vì nhớ bà.", dialogue: null })).toBe("sad");
    expect(shotMood({ description: "祭りの夜", dialogue: null })).toBe("night");
    expect(shotMood({ description: "A kitchen table.", dialogue: null })).toBe("day");
  });

  it("one crossfading cue per run of same-mood shots, on the real timeline; original audio at a calm loudness", () => {
    const STORY4 = "Dawn comes. The bakery opens. Grandma smiles. Night falls.";
    const p = planSchema.parse({ ...demoPlan(STORY4, 4), shots: demoPlan(STORY4, 4).shots.map((s, i) => ({ ...s, mood: (["dawn", "dawn", "tender", "night"] as const)[i] })) });
    const cues = scoreCues(p, tl([3, 3, 4, 5]));
    expect(cues.map((c) => [c.mood, c.start, c.end])).toEqual([["dawn", 0, 6], ["tender", 6, 10], ["night", 10, 15]]);
    const { wav } = renderScoreBed(p, tl([3, 3, 4, 5]), 15);
    const audio = decodeWav(wav);
    expect(audioDuration(audio)).toBeCloseTo(15.5, 1);
    const lufs = measureLoudness(audio).integrated;
    expect(lufs).toBeGreaterThan(-26);
    expect(lufs).toBeLessThan(-16);
    // deterministic: same plan + timeline → byte-identical music
    expect(renderScoreBed(p, tl([3, 3, 4, 5]), 15).wav.equals(wav)).toBe(true);
  }, 60_000);
});

describe("every shot stands in a place", () => {
  it("a shot whose cast names no set gets its scene's set, else the nearest one (VI showcase run 3: a flat cream shot 2)", () => {
    const real = planSchema.parse(JSON.parse(readFileSync(path.join(process.cwd(), "docs/hackathon/evidence/showcase-v2-banh-chung-trace.json"), "utf8")).bible);
    expect(real.shots[1].cast).toEqual(["an", "ba", "ingredients"]);
    const n = normalizePlan(real, 8);
    expect(n.shots[1].cast).toEqual(["an", "ba", "ingredients", "san-nha-pho-co"]);
    // shots that have a set keep exactly their own
    expect(n.shots.map((s, i) => (i === 1 ? null : s.cast))).toEqual(real.shots.map((s, i) => (i === 1 ? null : s.cast)));
    // the same scene wins over a nearer shot in another scene
    const p = planSchema.parse({
      ...real,
      shots: [
        { ...real.shots[0], scene: "Yard" },
        { ...real.shots[2], scene: "Kitchen" },
        { ...real.shots[1], scene: "Yard" },
      ],
    });
    expect(normalizePlan(p, 8).shots[2].cast).toContain("san-nha-pho-co");
    // a film without sets is left alone
    const noSets = planSchema.parse({ ...real, cast: real.cast.filter((c) => c.kind !== "set"), shots: real.shots.map((s) => ({ ...s, cast: s.cast.filter((id) => !["bep-lua", "san-nha-pho-co", "ban-tho"].includes(id)) })) });
    expect(normalizePlan(noSets, 8).shots[1].cast).toEqual(["an", "ba", "ingredients"]);
  });
});
