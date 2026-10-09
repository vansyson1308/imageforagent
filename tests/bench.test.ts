import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { aggregate, fromV1, judgeProblems, pairStats, parseJudgeScore, resultsMarkdown, revisedShots, toCsv, upliftOf, V1_JUDGE, type Row } from "../scripts/eval/benchCore";

const J2 = "Qwen/Qwen3.5-397B-A17B";
const row = (o: Partial<Row>): Row => ({
  version: "v2",
  set: "main",
  config: "crew v2",
  prompt: "p",
  language: "en",
  status: "done",
  shots: 4,
  rendered: 4,
  firstPassPct: 75,
  repairsPerShot: 0.5,
  criticBefore: 6,
  criticAfter: 7,
  lintLeft: 0,
  wallSec: 100,
  tokens: 1000,
  usd: 0.05,
  filmSec: 20,
  usdPerMinute: 0.15,
  textCritic: false,
  criticModel: null,
  judges: { [V1_JUDGE]: 6, [J2]: 7 },
  judge: 6.5,
  upliftShots: 0,
  uplift: {},
  gateFailures: 0,
  belowFloor: 0,
  runId: "r",
  ...o,
});

describe("bench v2 core (WP7)", () => {
  it("parses judge replies; rejects out-of-range or missing scores", () => {
    expect(parseJudgeScore('{"score": 7, "reason": "ok"}')).toBe(7);
    expect(parseJudgeScore('```json\n{"score":"8.5"}\n```')).toBe(8.5);
    expect(parseJudgeScore("Score: 6/10")).toBe(6);
    expect(parseJudgeScore('{"score": 42}')).toBeNull();
    expect(parseJudgeScore("looks nice")).toBeNull();
  });

  it("judges must differ from the critic, every crew model and each other", () => {
    const crew = ["nvidia/Nemotron-3-Ultra-550b-a55b", "nvidia/nemotron-3-super-120b-a12b", "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B", "openbmb/MiniCPM-V-4_5"];
    expect(judgeProblems([V1_JUDGE, J2], crew)).toEqual([]);
    expect(judgeProblems([V1_JUDGE, "openbmb/MiniCPM-V-4_5"], [])[0]).toMatch(/MiniCPM.*can't judge/); // the critic's eyes, even if the run didn't list it
    expect(judgeProblems([V1_JUDGE, "nvidia/nemotron-3-super-120b-a12b"], crew)[0]).toMatch(/super.*can't judge/);
    expect(judgeProblems([V1_JUDGE, V1_JUDGE], crew)[0]).toMatch(/distinct/);
  });

  it("finds revised shots from the critic's score steps: first snapshot vs accepted (highest, earliest on a tie)", () => {
    const st = (seq: number, shotIndex: number, score: number, round: number) => ({ seq, role: "critic", action: "score", shotIndex, score, imageUrl: `/f${shotIndex}-r${round}.jpg` });
    const steps = [
      st(1, 1, 5, 0),
      st(2, 1, 7, 1),
      st(3, 1, 6, 2), // a worse revision is not kept
      st(4, 2, 8, 0), // never revised
      st(5, 3, 6, 0),
      st(6, 3, 6, 1), // a tie keeps the first
      { seq: 7, role: "critic", action: "look", shotIndex: 4, score: null, imageUrl: "/x.jpg" },
      st(8, 4, 4, 0),
      { seq: 9, role: "critic", action: "score", shotIndex: 4, score: 7, imageUrl: null }, // no snapshot → can't be judged
      st(10, 4, 8, 3), // the floor redraw
    ];
    expect(revisedShots(steps)).toEqual([
      { shotIndex: 1, before: { imageUrl: "/f1-r0.jpg", score: 5 }, after: { imageUrl: "/f1-r1.jpg", score: 7 } },
      { shotIndex: 4, before: { imageUrl: "/f4-r0.jpg", score: 4 }, after: { imageUrl: "/f4-r3.jpg", score: 8 } },
    ]);
  });

  it("pairs by prompt with ±0.25 ties; uplift is shot-weighted per judge, then averaged over judges", () => {
    const a = [row({ config: "super-only v2", prompt: "x", judge: 5 }), row({ config: "super-only v2", prompt: "y", judge: 6 }), row({ config: "super-only v2", prompt: "z", judge: 7 })];
    const b = [row({ prompt: "x", judge: 6 }), row({ prompt: "y", judge: 6.2 }), row({ prompt: "z", judge: 6 }), row({ prompt: "only-b", judge: 9 })];
    const p = pairStats(a, b, (r) => r.judge);
    expect([p.n, p.wins, p.losses, p.ties, p.meanDiff]).toEqual([3, 1, 1, 1, 0.07]);
    const u = [row({ upliftShots: 3, uplift: { [V1_JUDGE]: 1, [J2]: 0 } }), row({ upliftShots: 1, uplift: { [V1_JUDGE]: -1, [J2]: 2 } }), row({ upliftShots: 0, uplift: { [V1_JUDGE]: 9 } })];
    // gemma: (3·1 + 1·−1)/4 = 0.5; qwen: (0 + 2)/4 = 0.5 → 0.5
    expect(upliftOf(u, [V1_JUDGE, J2])).toBe(0.5);
    expect(aggregate("crew v2", u, [V1_JUDGE, J2]).upliftShots).toBe(4);
  });

  it("reuses the real v1 crew rows as 'crew v1' (gemma only) and renders a results page with targets", () => {
    const v1 = readFileSync(path.join(process.cwd(), "docs/hackathon/eval/runs.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => fromV1(JSON.parse(l)))
      .filter((r): r is Row => r !== null);
    expect(v1).toHaveLength(10);
    expect(aggregate("crew v1", v1, [V1_JUDGE, J2]).judge).toBe(5.49); // the published v1 number
    expect(v1.every((r) => r.judges[J2] === undefined)).toBe(true);
    const v2 = v1.map((r, i) => row({ prompt: r.prompt, judges: { [V1_JUDGE]: 7, [J2]: 6 }, judge: 6.5, upliftShots: i % 2, uplift: { [V1_JUDGE]: 1, [J2]: 0.5 } }));
    const so = v1.map((r) => row({ config: "super-only v2", prompt: r.prompt, judge: 5.5, judges: { [V1_JUDGE]: 5, [J2]: 6 } }));
    const md = resultsMarkdown({ generatedAt: "2026-10-09T00:00:00Z", base: "http://x", provider: "nemotron", mock: false, judges: [V1_JUDGE, J2], rows: [...so, ...v2, ...v1], configs: ["super-only v2", "crew v2"] });
    expect(md).toContain("| Judge mean, crew v2 (mean of both judges) | ≥ 6.5 | 6.5 | ✅ met |");
    expect(md).toContain("| Crew v2 wins vs super-only v2 (paired, ±0.25 = tie) | ≥ 8/10 | 10/10 | ✅ met |");
    expect(md).toContain("| Critic uplift, independently judged | ≥ +0.5 | +0.75 | ✅ met |");
    expect(md).toContain("| USD per finished minute, crew v2 | ≤ $0.40 | $0.150 | ✅ met |");
    expect(md).toMatch(/Paired: crew v2 vs crew v1 \(judge gemma-3-27b-it only, as in v1\)/);
    expect(md).not.toContain("MOCK");
    const csv = toCsv([...v2, ...v1], [V1_JUDGE, J2]);
    expect(csv.split("\n")[0]).toContain(`judge:${J2}`);
    expect(csv.trim().split("\n")).toHaveLength(21);
  });

  it("every table row has as many cells as its header, with two judges, one, or none", () => {
    for (const judges of [[V1_JUDGE, J2], [V1_JUDGE], []]) {
      const rows = [row({ config: "super-only v2" }), row({}), row({ set: "pilot", prompt: "hidamari-1" })];
      const md = resultsMarkdown({ generatedAt: "t", base: "b", provider: "nemotron", mock: false, judges, rows, configs: ["super-only v2", "crew v2"] });
      const cells = (l: string) => l.split("|").length;
      let header = 0;
      for (const l of md.split("\n")) {
        if (!l.startsWith("|")) header = 0;
        else if (!header) header = cells(l);
        else expect(cells(l), `${judges.length} judge(s): ${l}`).toBe(header);
      }
    }
  });

  it("a missed target is reported as missed, never hidden", () => {
    const md = resultsMarkdown({ generatedAt: "t", base: "b", provider: "nemotron", mock: false, judges: [V1_JUDGE], rows: [row({ judge: 5.9, judges: { [V1_JUDGE]: 5.9 }, usdPerMinute: 0.55 })], configs: ["crew v2"] });
    expect(md).toContain("| ≥ 6.5 | 5.9 | ❌ missed |");
    expect(md).toContain("| ≤ $0.40 | $0.550 | ❌ missed |");
    expect(md).toContain("| Critic uplift, independently judged | ≥ +0.5 | — | not measured |");
  });
});
