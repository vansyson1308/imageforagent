import { describe, expect, it } from "vitest";
import { checklistProblems, checklistTemplate, publishProblems, SHOWCASE_MAX_SEC, SHOWCASE_MIN_SEC, voiceProblems } from "@/lib/services/director/publishGate";
import { SHOWCASE_V2, spokenSeconds } from "../scripts/director/showcaseStories";
import { validateDrawing } from "@/lib/services/director/artist";
import { demoPlan, DEMO_LIBRARY } from "@/lib/services/director/demoCrew";
import { planSchema } from "@/lib/services/director/schemas";

/**
 * The stricter showcase publish gate (owner QC 2026-10-10, sprint d+e):
 * 45–90 s films, zero gate failures, zero shots below 6, no shot without a
 * set, nothing off-plan, and a by-eye checklist a person has ticked.
 */
const good = { shots: 11, rendered: 11, gateFailures: 0, offPlan: [], setless: [], durationSec: 62.5, shotScores: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [i + 1, 7 + (i % 3)])) };

describe("automatic publish gate", () => {
  it("passes a clean 11-shot film of 62 s", () => {
    expect(publishProblems("done", good)).toEqual([]);
  });

  it("names every reason a film can't be published", () => {
    const p = publishProblems("done", { ...good, rendered: 10, gateFailures: 1, offPlan: [3], setless: [5], durationSec: 38, shotScores: { ...good.shotScores, 4: 5.5, 6: null } });
    expect(p.join(" | ")).toMatch(/10\/11 shots rendered/);
    expect(p.join(" | ")).toMatch(/1 shot\(s\) still fail a measured gate/);
    expect(p.join(" | ")).toMatch(/off-plan shot\(s\): 3/);
    expect(p.join(" | ")).toMatch(/without a set: 5/);
    expect(p.join(" | ")).toMatch(/below 6 or not scored: 4 \(5.5\), 6 \(n\/a\)/);
    expect(p.join(" | ")).toMatch(/38.0 s \(a showcase film runs 45–90 s\)/);
    expect(publishProblems("budget_exceeded", good)[0]).toMatch(/run status is "budget_exceeded"/);
    expect(publishProblems("done", { ...good, durationSec: 95 }).join()).toMatch(/95.0 s/);
    expect(publishProblems("done", { ...good, shotScores: undefined }).join()).toMatch(/no per-shot critic scores/);
  });
});

describe("no non-commercial voice in a published film (owner decision A1)", () => {
  it("blocks a line spoken by the Piper JA voice; the owner's recordings and permissive voices pass", () => {
    const step = (shotIndex: number, model: string) => ({ role: "dialogue", action: "voice", shotIndex, model, error: null });
    expect(voiceProblems([step(1, "owner-recording"), step(2, "owner-recording")])).toEqual([]);
    expect(voiceProblems([step(1, "owner-recording"), step(2, "piper:ja_JP-hi_fi_captain-medium")])).toEqual(["shot 2 is spoken by piper:ja_JP-hi_fi_captain-medium, a non-commercial voice: the line needs the owner's recording"]);
  });
});

describe("by-eye checklist", () => {
  const shots = [1, 2].map((index) => ({ index, beat: `beat ${index}`, image: `f0${index}.jpg`, measured: "Wide shot · critic 8/10" }));
  const md = checklistTemplate({ slug: "v2-kite", projectId: "p1", runId: "r1", commit: "abc1234", hero: "kite", shots });

  it("starts unticked and pending, so it can't pass by itself", () => {
    expect(md).toMatch(/Hero object: #kite/);
    expect(md).toMatch(/!\[shot 1\]\(f01.jpg\)/);
    const p = checklistProblems(md, 2);
    expect(p).toContain('shot 1: "no character cropped" not checked');
    expect(p).toContain("no reviewer named");
    expect(p).toContain("verdict is PENDING, not PASS");
  });

  it("passes only when every box is ticked, a reviewer is named and the verdict is PASS", () => {
    const filled = md.replace(/- \[ \]/g, "- [x]").replace("Reviewer: ", "Reviewer: Claude (by eye, full-size frames)").replace(/Verdict: PENDING.*/, "Verdict: PASS");
    expect(checklistProblems(filled, 2)).toEqual([]);
    expect(checklistProblems(filled.replace("- [x] readable (not too dark)", "- [!] readable (not too dark)"), 2)).toEqual(["shot 1: readable (not too dark) FAILED"]);
    expect(checklistProblems(filled, 3)).toEqual(["shot 3 has no checklist section"]);
  });
});

describe("the v2 showcase tellings", () => {
  it("are 10–12 narrated lines that read in 45–90 s, each a valid narration line", () => {
    for (const s of SHOWCASE_V2) {
      expect(s.lines.length, s.slug).toBeGreaterThanOrEqual(10);
      expect(s.lines.length, s.slug).toBeLessThanOrEqual(12);
      expect(s.lines.every((l) => l.length >= 1 && l.length <= 220), s.slug).toBe(true);
      expect(spokenSeconds(s), s.slug).toBeGreaterThan(SHOWCASE_MIN_SEC);
      expect(spokenSeconds(s), s.slug).toBeLessThan(SHOWCASE_MAX_SEC);
    }
    expect(SHOWCASE_V2.map((s) => s.slug)).toEqual(["v2-kite", "v2-banh-chung", "v2-furin"]);
  });
});

describe("no shot without a set", () => {
  it("a shot whose set isn't placed is sent back with the line to add", async () => {
    const shot = { ...planSchema.parse(demoPlan("One. Two.", 2)).shots[0], mode: "still" as const, cast: ["hero", "home"] };
    const opts = { castDefs: DEMO_LIBRARY, symbols: ["hero", "home"], aspectRatio: "16:9", shot, index: 1, canvas: { w: 1920, h: 1080 }, fps: 12, characters: ["hero"], sets: ["home"] };
    const body = '<rect width="1920" height="1080" fill="#88aacc"/><path d="M0 800 L1920 780 L1920 1080 L0 1080 Z" fill="#557744"/><use href="#hero" x="760" y="300" width="400" height="600"/>';
    await expect(validateDrawing(`\`\`\`svg\n${body}\n\`\`\``, opts)).rejects.toThrow(/the shot's set #home is not placed: start the frame with <use href="#home" x="0" y="0" width="1920" height="1080"\/>/);
  });
});
