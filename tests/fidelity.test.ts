import { afterAll, beforeAll, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { prisma } from "@/lib/db";
import { MockLlmProvider, type MockHandler } from "@/lib/providers/mockLlmProvider";
import { demoHandler, demoPlan, MOCK_MODELS } from "@/lib/services/director/demoCrew";
import { createRun, executeRun, registerRun, unregisterRun } from "@/lib/services/director/loop";
import { DEFAULT_BUDGET } from "@/lib/services/director/budget";
import { critiqueSchema, planSchema } from "@/lib/services/director/schemas";
import { enforceFidelity, fidelityBrief, fidelityFailures, setTimeFix, shotTime } from "@/lib/services/director/fidelity";

/**
 * Plan-vs-render fidelity (owner QC 2026-10-10, sprint b): the time of day,
 * place and key action the plan asks for must be what the render shows.
 * "Đêm Ba Mươi" (New Year's Eve night) rendered in daylight must fail.
 */

describe("planned time of day, from the plan's own words", () => {
  const shot = (scene: string, description: string) => ({ scene, description });
  it("reads night and day in English, Vietnamese and Japanese", () => {
    expect(shotTime(shot("Đêm Ba Mươi", "Cả nhà quây quần bên nồi bánh chưng"))).toBe("night");
    expect(shotTime(shot("SC1", "Mai watches the fireworks at midnight"))).toBe("night");
    expect(shotTime(shot("縁側", "夏の夜、風鈴が鳴る"))).toBe("night");
    expect(shotTime(shot("SC2", "A sunny morning in the courtyard"))).toBe("day");
    expect(shotTime(shot("Sân nhà", "Buổi sáng, bà gói bánh"))).toBe("day");
    expect(shotTime(shot("SC3", "Mai runs to the river"))).toBeNull();
    // both stated: not decided from words
    expect(shotTime(shot("SC4", "From morning until night the kite flies"))).toBeNull();
  });

  it("relights a kit set the plan's night shots use, and leaves a fitting set alone", () => {
    const plan = (descs: string[]) => ({ shots: descs.map((description) => ({ ...planSchema.parse(demoPlan("A. B.", 2)).shots[0], scene: "SC1", description, cast: ["hero", "courtyard"] })) });
    const eve = plan(["Đêm Ba Mươi: the family waits for midnight", "Fireworks light the night sky", "Mai hugs grandma"]);
    expect(setTimeFix(eve, "courtyard", "day")).toMatchObject({ time: "night" });
    expect(setTimeFix(eve, "courtyard", "dusk")).toBeNull();
    expect(setTimeFix(eve, "courtyard", "night")).toBeNull();
    expect(setTimeFix(eve, "other-set", "day")).toBeNull();
    const morning = plan(["A sunny morning", "Afternoon tea", "Mai waves"]);
    expect(setTimeFix(morning, "courtyard", "night")).toMatchObject({ time: "day" });
  });

  it("briefs the critic with the story, the scene, the planned time and the set's lighting", () => {
    const p = planSchema.parse(demoPlan("Đêm Ba Mươi. Mai waits.", 2));
    const s = { ...p.shots[0], scene: "Đêm Ba Mươi", cast: ["hero", "home"] };
    const brief = fidelityBrief(p, s, new Map([["home", "day"]]));
    expect(brief).toMatch(/Story: "Đêm Ba Mươi/);
    expect(brief).toMatch(/NIGHT/);
    expect(brief).toMatch(/#home is lit for day/);
  });
});

describe("an off-plan verdict is never accepted", () => {
  const c = critiqueSchema.parse({ score: 9, verdict: "accept", issues: [], fixes: [], fidelity: { time: "wrong", place: "ok", action: "ok", note: "a New Year's Eve night scene rendered in bright daylight" } });
  it("caps the score below the bar, forces a revision and puts the mismatch first", () => {
    const e = enforceFidelity(c);
    expect(e.score).toBe(6);
    expect(e.verdict).toBe("revise");
    expect(e.issues[0]).toMatch(/^Off-plan time: a New Year's Eve night scene rendered in bright daylight/);
    expect(fidelityFailures(e)).toEqual(["time"]);
  });
  it("leaves on-plan and unclear verdicts alone, and older replies without fidelity parse", () => {
    const ok = critiqueSchema.parse({ score: 8, verdict: "accept", issues: [], fixes: [], fidelity: { time: "ok", place: "unclear", action: "ok", note: "" } });
    expect(enforceFidelity(ok)).toEqual(ok);
    const legacy = critiqueSchema.parse({ score: 8, verdict: "accept", issues: [], fixes: [] });
    expect(legacy.fidelity).toBeNull();
    expect(enforceFidelity(legacy)).toEqual(legacy);
  });
});

// ---------- end to end with the scripted crew ----------

let storage: string;
const created: string[] = [];
beforeAll(async () => {
  storage = await fs.mkdtemp(path.join(os.tmpdir(), "fidelity-test-"));
  process.env.STORAGE_ROOT = storage;
});
afterAll(async () => {
  await prisma.project.deleteMany({ where: { id: { in: created } } });
  await fs.rm(storage, { recursive: true, force: true });
});

const STORY = "Đêm Ba Mươi, Mai waits for midnight. Fireworks bloom over the roofs. Grandma hugs her.";
const DAYLIGHT = { time: "wrong", place: "ok", action: "ok", note: "the plan says New Year's Eve night; the render is bright daylight" };

async function run(handler: MockHandler) {
  const p = await prisma.project.create({ data: { name: "fidelity-test" } });
  created.push(p.id);
  const d = { provider: new MockLlmProvider(handler), models: MOCK_MODELS, visionAvailable: true, modelNotes: [], tavily: null, ceiling: DEFAULT_BUDGET, floorRedraw: { enabled: false, reason: "test: one shot, no fresh redraw" } };
  const req = { projectId: p.id, story: STORY, language: "en", style: "storybook", critic: true, research: false, maxShots: 3 };
  const { runId, budget } = await createRun(req, d);
  const ctrl = registerRun(runId);
  try {
    return { runId, summary: await executeRun(runId, req, d, budget, () => {}, ctrl.signal) };
  } finally {
    unregisterRun(runId);
  }
}

/** The scripted crew, with a critic that judges shot 1's time of day by `verdicts` (one per critique). */
function crew(verdicts: (typeof DAYLIGHT | null)[], prompts: string[]): MockHandler {
  const base = demoHandler({ criticScores: [9] });
  return (m, o, i) => {
    if (m[0].content.startsWith("ROLE: ARTIST") && /shot 1 of/.test(m[1].content) && /FIX THIS/.test(m[1].content)) prompts.push(`ARTIST ${m[1].content}`);
    if (m[0].content.startsWith("ROLE: CRITIC") && /^Shot 1:/.test(m[1].content)) {
      prompts.push(m[1].content);
      const v = verdicts.length > 1 ? verdicts.shift()! : verdicts[0];
      return { score: 9, verdict: "accept", issues: [], fixes: [], fidelity: v ?? { time: "ok", place: "ok", action: "ok", note: "" } };
    }
    return base(m, o, i);
  };
}

describe("director loop: the fidelity check (mock crew)", () => {
  it("a night shot rendered in daylight is revised even when it scores 9, and reported off-plan if it stays wrong", async () => {
    const prompts: string[] = [];
    const { runId, summary } = await run(crew([DAYLIGHT], prompts));
    expect(summary.status).toBe("done");
    expect(summary.offPlan).toEqual([1]);
    // the critic was briefed with the story and the plan's time of day
    expect(prompts[0]).toMatch(/PLAN:[\s\S]*Đêm Ba Mươi/);
    const steps = await prisma.directorStep.findMany({ where: { runId, shotIndex: 1 }, orderBy: { seq: "asc" } });
    expect(steps.some((s) => s.role === "artist" && s.action === "revise")).toBe(true);
    // the Artist got the mismatch back as the first thing to fix
    expect(prompts.find((p) => p.startsWith("ARTIST "))).toMatch(/FIX THIS[\s\S]*Off-plan time: the plan says New Year's Eve night/);
    expect(steps.some((s) => s.action === "off-plan" && /off-plan after revisions \(time\)/.test(s.outputSummary ?? ""))).toBe(true);
    expect(steps.some((s) => s.action === "score" && /OFF-PLAN time/.test(s.outputSummary ?? ""))).toBe(true);
  }, 120_000);

  it("a revision that fixes the time of day is accepted and the film is on-plan", async () => {
    const { runId, summary } = await run(crew([DAYLIGHT, null], []));
    expect(summary.offPlan).toEqual([]);
    // the publish gate reads these from the summary
    expect(summary.setless).toEqual([]);
    expect(summary.shotScores).toMatchObject({ 1: 9, 2: 9, 3: 9 });
    const up = await prisma.directorStep.findFirst({ where: { runId, shotIndex: 1, action: "uplift" } });
    expect(up?.outputSummary).toMatch(/6 → 9/);
  }, 120_000);
});
