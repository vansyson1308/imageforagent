import { describe, expect, it } from "vitest";
import { isNonCommercialVoice, publishVerdict, spokenLines } from "@/lib/services/director/pilotPolicy";

describe("pilot publication rule (owner QC: the JA Piper voice is non-commercial)", () => {
  it("knows which voices are non-commercial from the voice licences", () => {
    expect(isNonCommercialVoice("piper:ja_JP-hi_fi_captain-medium")).toBe(true);
    expect(isNonCommercialVoice("piper:ja_JP-hi_fi_captain-medium#1@-2")).toBe(true);
    expect(isNonCommercialVoice("piper:en_US-john-medium")).toBe(false);
    expect(isNonCommercialVoice("piper:vi_VN-vais1000-medium")).toBe(false);
    expect(isNonCommercialVoice("ja")).toBe(false); // espeak-ng (GPL program, output is not restricted)
    expect(isNonCommercialVoice(null)).toBe(false);
  });

  it("an episode is publishable only when every non-commercial line was replaced by the owner's recording", () => {
    const steps = [
      { role: "dialogue", action: "voice", shotIndex: 1, model: "piper:ja_JP-hi_fi_captain-medium#1" },
      { role: "dialogue", action: "voice", shotIndex: 2, model: "subtitle-only" },
      { role: "dialogue", action: "voice", shotIndex: 3, model: "piper:ja_JP-hi_fi_captain-medium@-1" },
      { role: "dialogue", action: "voice", shotIndex: 4, model: "piper:ja_JP-hi_fi_captain-medium", error: "TTS failed" },
      { role: "artist", action: "draw", shotIndex: 1, model: "x" },
    ];
    const lines = spokenLines(steps);
    expect(lines).toEqual([{ shot: 1, voice: "piper:ja_JP-hi_fi_captain-medium#1" }, { shot: 2, voice: null }, { shot: 3, voice: "piper:ja_JP-hi_fi_captain-medium@-1" }]);
    expect(publishVerdict(lines, new Set([1])).blocking.map((l) => l.shot)).toEqual([3]);
    expect(publishVerdict(lines, new Set([1, 3])).publishable).toBe(true);
  });
});

describe("Hidamari narration (owner QC 2026-10-10)", () => {
  it("splits a story into its read-aloud sentences, keeping a quoted line whole", async () => {
    const { narrationLines, targetSeconds } = await import("@/lib/services/director/pilotPolicy");
    const story = "老紳士は手紙を声に出して読み、最後に小さく笑いました。「やっと、言えた気がします」。帰り道、桜がひとひら落ちました。";
    expect(narrationLines(story)).toEqual(["老紳士は手紙を声に出して読み、最後に小さく笑いました。", "「やっと、言えた気がします」。", "帰り道、桜がひとひら落ちました。"]);
    expect(narrationLines("「今年も。来年も」とハルさんは言いました。")).toEqual(["「今年も。来年も」とハルさんは言いました。"]);
    // 5 characters a second + 0.3 s per 、 + 0.5 s at the end
    expect(targetSeconds("「やっと、言えた気がします」。")).toBe(Math.round((11 / 5 + 0.3 + 0.5) * 10) / 10);
  });

  it("fixes shot N's narration to line N; no line is dropped when the plan is short", async () => {
    const { withNarration, narrationBrief } = await import("@/lib/services/director/plan");
    const { demoPlan } = await import("@/lib/services/director/demoCrew");
    const { planSchema } = await import("@/lib/services/director/schemas");
    const plan = planSchema.parse(demoPlan("One. Two. Three.", 3));
    const lines = ["一。", "二。", "三。"];
    const n = withNarration(plan, lines);
    expect(n.shots.map((s) => [s.dialogue, s.speaker])).toEqual([["一。", null], ["二。", null], ["三。", null]]);
    const short = withNarration({ ...plan, shots: plan.shots.slice(0, 2) }, lines);
    expect(short.shots.map((s) => s.dialogue)).toEqual(["一。", "二。三。"]);
    expect(narrationBrief(lines)).toMatch(/Plan EXACTLY 3 shots/);
  });

  it("the approved stories and the exported line list agree (ids are the WAV names the pilot reads)", async () => {
    const { readFileSync } = await import("node:fs");
    const { narrationLines } = await import("@/lib/services/director/pilotPolicy");
    const stories = JSON.parse(readFileSync("docs/hackathon/eval/pilot-prompts.json", "utf8")) as Array<{ story: string; shots: number }>;
    const list = JSON.parse(readFileSync("docs/hackathon/eval/pilot-lines.json", "utf8")) as { episodes: Array<{ shots: number; lines: Array<{ wav: string; text: string }> }> };
    stories.forEach((s, e) => {
      expect(list.episodes[e].lines.map((l) => l.text)).toEqual(narrationLines(s.story));
      expect(s.shots).toBe(list.episodes[e].shots);
      list.episodes[e].lines.forEach((l, i) => expect(l.wav).toBe(`ep${e + 1}-L${String(i + 1).padStart(2, "0")}.wav`));
    });
  });
});
