import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { emptyRun, modelLabel, reduceAll, reduceRun, statusLine, type DirectorEventLike } from "@/lib/director/runState";
import { dueEvents, traceToEvents, type Trace } from "@/lib/director/traceReplay";
import { SAMPLE_STORIES } from "@/lib/director/sampleStories";

const step = (seq: number, extra: Record<string, unknown> = {}) => ({
  type: "step",
  step: { seq, role: "artist", model: "nvidia/nemotron-3-super-120b-a12b", action: "draw", shotIndex: 1, attempt: 0, summary: "draw", score: null, tokensIn: 10, tokensOut: 20, costUsd: 0.001, latencyMs: 5, imageUrl: null, error: null, ...extra },
  totals: { tokens: 30 * (seq + 1), costUsd: 0.001 * (seq + 1) },
});

const RUN: DirectorEventLike = { type: "run", runId: "r1", projectId: "p1", provider: "mock", models: { strong: "nvidia/Nemotron-3-Ultra-550b-a55b" }, notes: [], startedAt: "2026-10-09T00:00:00.000Z" };
const PLAN: DirectorEventLike = {
  type: "plan",
  title: "T",
  logline: "L",
  shots: [
    { index: 1, shotType: "Wide shot", description: "a", mode: "still", dialogue: null, cites: [1] },
    { index: 2, shotType: "Close-up", description: "b", mode: "motion", dialogue: "hi" },
  ],
};

describe("run state reducer", () => {
  it("folds a run and is idempotent under a reconnect replay (no duplicate steps)", () => {
    const live = [RUN, PLAN, step(0), step(1), { type: "frame", index: 1, imageUrl: "/a.png", clipUrl: null, score: null, status: "done" }];
    const s1 = reduceAll(live);
    // reconnect: the server replays everything, then tails new events
    const s2 = reduceAll([...live, step(2), { type: "done", status: "done", summary: { rendered: 1 } }], s1);
    expect(s2.steps.map((s) => s.seq)).toEqual([0, 1, 2]);
    expect(s2.shots[0]).toMatchObject({ imageUrl: "/a.png", cites: [1] });
    expect(s2.latestShot).toBe(1);
    expect(s2.finished).toBe(true);
    expect(s2.startedAt).toBe("2026-10-09T00:00:00.000Z");
  });

  it("a different run id resets the state", () => {
    const s = reduceAll([RUN, PLAN, step(0)]);
    const t = reduceRun(s, { ...RUN, runId: "r2" });
    expect(t.steps).toEqual([]);
    expect(t.runId).toBe("r2");
  });

  it("tracks the critic's before/after when a revision wins", () => {
    const s = reduceAll([
      RUN,
      PLAN,
      step(0, { role: "critic", action: "score", score: 5, imageUrl: "/before.jpg" }),
      step(1, { role: "critic", action: "score", score: 8, imageUrl: "/after.jpg" }),
      step(2, { role: "critic", action: "uplift", score: 8 }),
    ]);
    expect(s.shots[0].scores).toEqual([5, 8]);
    expect(s.lastUplift).toEqual({ shotIndex: 1, before: 5, after: 8, beforeImageUrl: "/before.jpg", afterImageUrl: "/after.jpg" });
  });

  it("says what the crew is doing in plain language (EN/VI/JA)", () => {
    expect(statusLine(reduceAll([RUN]), "en")).toMatch(/Starting/);
    const planning = step(0, { role: "director", action: "plan", shotIndex: null, model: "nvidia/Nemotron-3-Ultra-550b-a55b" });
    expect(statusLine(reduceAll([RUN, planning]), "en")).toBe("Ultra is planning the shots…");
    expect(statusLine(reduceAll([RUN, planning, PLAN]), "en")).toMatch(/2 shots planned/);
    expect(statusLine(reduceAll([RUN, PLAN, step(0)]), "en")).toBe("Super is drawing shot 1…");
    expect(statusLine(reduceAll([RUN, PLAN, step(0, { action: "draw:invalid", error: "too small" })]), "vi")).toMatch(/Engine đo thấy lỗi ở shot 1/);
    expect(statusLine(reduceAll([RUN, PLAN, step(0, { role: "critic", action: "critique" })]), "ja")).toMatch(/ショット 1/);
    expect(statusLine(reduceAll([RUN, PLAN, { type: "done", status: "done", summary: null }]), "en")).toBe("");
    expect(modelLabel("nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B")).toBe("Nemotron Nano");
    expect(modelLabel("google/gemma-3-27b-it")).toBe("gemma-3-27b-it");
    // owner decision A1: the JA Piper voice is visibly a non-commercial demo voice; the owner's recordings are named
    expect(modelLabel("piper:ja_JP-hi_fi_captain-medium#0")).toBe("Piper voice (non-commercial demo voice)");
    expect(modelLabel("piper:en_US-kristin-medium")).toBe("Piper voice");
    expect(modelLabel("owner-recording")).toBe("Owner recording (AivisSpeech)");
  });

  it("starts empty", () => {
    expect(emptyRun()).toMatchObject({ runId: null, steps: [], finished: false });
  });
});

describe("showcase replay", () => {
  const trace = JSON.parse(readFileSync(path.join(process.cwd(), "public/showcase/tea-house/trace.json"), "utf8")) as Trace;
  const stills = { 1: "/s/F01.jpg", 3: "/s/F03.jpg" };

  it("rebuilds the real run as timed events that end in the recorded summary", () => {
    const ev = traceToEvents(trace, { shots: stills });
    expect(ev[0].event.type).toBe("run");
    expect(ev.map((e) => e.at)).toEqual([...ev.map((e) => e.at)].sort((a, b) => a - b));
    const state = reduceAll(ev.map((e) => e.event));
    expect(state.finished).toBe(true);
    expect(state.steps.length).toBe(trace.steps.length);
    expect(state.totals.costUsd).toBeCloseTo((trace as unknown as { costUsd: number }).costUsd, 6);
    expect(state.summary).toMatchObject({ rendered: 8, shots: 8 });
    expect(state.shots.find((s) => s.index === 3)?.imageUrl).toBe("/s/F03.jpg");
    // 10× replay of a ~7 min run takes well under a minute
    expect(ev.at(-1)!.at / 10).toBeLessThan(60_000);
  });

  it("releases events by virtual clock", () => {
    const ev = traceToEvents(trace);
    const a = dueEvents(ev, 0, 0);
    expect(a.batch[0].type).toBe("run");
    const b = dueEvents(ev, a.next, ev.at(-1)!.at);
    expect(a.batch.length + b.batch.length).toBe(ev.length);
  });
});

describe("sample stories", () => {
  it("one per language, real places/festivals, never a bench prompt", () => {
    expect(SAMPLE_STORIES.map((s) => s.language).sort()).toEqual(["en", "ja", "vi"]);
    const bench = readFileSync(path.join(process.cwd(), "scripts/eval/director_bench.ts"), "utf8");
    for (const s of SAMPLE_STORIES) {
      expect(s.story.length).toBeGreaterThanOrEqual(20);
      expect(s.story.length).toBeLessThanOrEqual(6000);
      expect(bench.includes(s.story.slice(0, 40))).toBe(false);
    }
  });
});
