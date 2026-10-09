/**
 * Pure core of the Director benchmark v2 (SPEC v2 WP7): judge-reply parsing,
 * the independently judged critic uplift, judge-independence checks, paired
 * statistics, aggregation and the EVAL_RESULTS.md / CSV renderers. No I/O,
 * no network: unit-tested in tests/bench.test.ts. The runner
 * (director_bench.ts) does the HTTP and model calls.
 */

/** The v1 judge prompt, unchanged (the v2 comparison must use the same one). */
export const JUDGE_PROMPT =
  "You are an impartial judge of storyboard frames. Rate how well this frame shows the shot description: the named characters/props are present and readable, the action and setting match, the time of day and mood match, the composition is clear. " +
  'Answer ONLY JSON {"score": 0-10, "reason": "<one short sentence>"}. 9-10 excellent, 7-8 good, 4-6 partly matches or hard to read, 0-3 wrong or broken.';

/** The v1 judge. v2 keeps it (comparability) and adds a second VLM. */
export const V1_JUDGE = "google/gemma-3-27b-it";
/** Second judge candidates, in order: served VLMs that are NOT the critic's eyes (MiniCPM, D33). Probed live with an image. */
export const SECOND_JUDGE_CANDIDATES = ["Qwen/Qwen3.5-397B-A17B", "moonshotai/Kimi-K3", "moonshotai/Kimi-K2.6"] as const;
/** Models the crew's critic may use (D33): never a judge. */
export const CRITIC_MODELS = ["openbmb/MiniCPM-V-4_5"] as const;

/** SPEC v2 WP7 acceptance targets. */
export const TARGETS = { judgeMean: 6.5, winsOf10: 8, uplift: 0.5, usdPerMin: 0.4 } as const;

export const r2 = (x: number) => Math.round(x * 100) / 100;
export const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
export const meanOrNull = (xs: ReadonlyArray<number | null | undefined>): number | null => {
  const v = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return v.length ? r2(mean(v)) : null;
};

/** A judge's 0–10 score from its reply (JSON or loose text); null when absent or out of range. */
export function parseJudgeScore(text: string): number | null {
  const m = text.match(/"score"\s*:\s*"?(\d+(?:\.\d+)?)/) ?? text.match(/\bscore\b\D{0,12}(\d+(?:\.\d+)?)/i);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) && v >= 0 && v <= 10 ? v : null;
}

/**
 * Judges must be independent of the crew: never one of the run's models
 * (from its `run` event) nor a critic VLM, and never the same model twice.
 * Returns the problems (empty = OK).
 */
export function judgeProblems(judges: readonly string[], crewModels: ReadonlyArray<string | null | undefined>): string[] {
  const crew = new Set([...crewModels, ...CRITIC_MODELS].filter((m): m is string => Boolean(m)).map((m) => m.toLowerCase()));
  const out: string[] = [];
  if (new Set(judges.map((j) => j.toLowerCase())).size !== judges.length) out.push(`judges must be distinct (${judges.join(", ")})`);
  for (const j of judges) if (crew.has(j.toLowerCase())) out.push(`${j} is part of the crew or the critic, so it can't judge`);
  return out;
}

export interface StepLike {
  readonly seq: number;
  readonly role: string;
  readonly action: string;
  readonly shotIndex: number | null;
  readonly score?: number | null;
  readonly imageUrl?: string | null;
}

export interface RevisedShot {
  readonly shotIndex: number;
  /** the first critic snapshot (pre-revision) */
  readonly before: { readonly imageUrl: string; readonly score: number };
  /** the accepted version's snapshot: highest critic score, earliest on a tie (a revision is kept only if it scores higher, D11) */
  readonly after: { readonly imageUrl: string; readonly score: number };
}

/** Shots where a revision (or the floor redraw) replaced the first version, with both snapshots. */
export function revisedShots(steps: readonly StepLike[]): RevisedShot[] {
  const by = new Map<number, StepLike[]>();
  for (const s of steps) {
    if (s.role !== "critic" || s.action !== "score" || s.shotIndex === null || typeof s.score !== "number" || !s.imageUrl) continue;
    by.set(s.shotIndex, [...(by.get(s.shotIndex) ?? []), s]);
  }
  const out: RevisedShot[] = [];
  for (const [shotIndex, list] of [...by.entries()].sort((a, b) => a[0] - b[0])) {
    const sorted = [...list].sort((a, b) => a.seq - b.seq);
    const first = sorted[0];
    const best = sorted.reduce((b, s) => (s.score! > b.score! ? s : b), first);
    if (best === first) continue;
    out.push({ shotIndex, before: { imageUrl: first.imageUrl!, score: first.score! }, after: { imageUrl: best.imageUrl!, score: best.score! } });
  }
  return out;
}

export interface Row {
  readonly version: "v1" | "v2";
  readonly set: "main" | "pilot";
  readonly config: string;
  readonly prompt: string;
  readonly language: string;
  readonly status: string;
  readonly shots: number;
  readonly rendered: number;
  readonly firstPassPct: number;
  readonly repairsPerShot: number;
  readonly criticBefore: number | null;
  readonly criticAfter: number | null;
  readonly lintLeft: number;
  readonly wallSec: number;
  readonly tokens: number;
  readonly usd: number;
  readonly filmSec: number;
  readonly usdPerMinute: number | null;
  readonly textCritic: boolean;
  readonly criticModel: string | null;
  /** per judge model: mean score over the run's final frames */
  readonly judges: Record<string, number | null>;
  /** mean over the judges that scored */
  readonly judge: number | null;
  /** revised shots, and per judge the mean (after − before) over them */
  readonly upliftShots: number;
  readonly uplift: Record<string, number | null>;
  readonly gateFailures: number;
  readonly belowFloor: number;
  readonly runId: string;
}

/** A v1 runs.jsonl row as a "crew v1" v2 row (v1 had one judge: gemma). */
export function fromV1(r: Record<string, unknown>): Row | null {
  if (r.mock || r.status === "error" || r.config !== "crew") return null;
  const judge = typeof r.judge === "number" ? r.judge : null;
  return {
    version: "v1",
    set: "main",
    config: "crew v1",
    prompt: String(r.prompt),
    language: String(r.language),
    status: String(r.status),
    shots: Number(r.shots ?? 0),
    rendered: Number(r.rendered ?? 0),
    firstPassPct: Number(r.firstPassPct ?? 0),
    repairsPerShot: Number(r.repairsPerShot ?? 0),
    criticBefore: (r.criticBefore as number | null) ?? null,
    criticAfter: (r.criticAfter as number | null) ?? null,
    lintLeft: Number(r.lintLeft ?? 0),
    wallSec: Number(r.wallSec ?? 0),
    tokens: Number(r.tokens ?? 0),
    usd: Number(r.usd ?? 0),
    filmSec: Number(r.filmSec ?? 0),
    usdPerMinute: (r.usdPerMinute as number | null) ?? null,
    textCritic: Boolean(r.textCritic),
    criticModel: null,
    judges: { [V1_JUDGE]: judge },
    judge,
    upliftShots: 0,
    uplift: {},
    gateFailures: 0,
    belowFloor: 0,
    runId: String(r.runId ?? ""),
  };
}

export interface PairStats {
  readonly n: number;
  readonly meanDiff: number;
  readonly wins: number;
  readonly losses: number;
  readonly ties: number;
  readonly pairs: ReadonlyArray<{ prompt: string; a: number; b: number }>;
}

/** b − a per prompt on a score; |Δ| ≤ tie counts as a tie (v1 used ±0.25). */
export function pairStats(a: readonly Row[], b: readonly Row[], score: (r: Row) => number | null, tie = 0.25): PairStats {
  const am = new Map(a.filter((r) => score(r) !== null).map((r) => [r.prompt, score(r)!]));
  const pairs = b.filter((r) => score(r) !== null && am.has(r.prompt)).map((r) => ({ prompt: r.prompt, a: am.get(r.prompt)!, b: score(r)! }));
  const d = pairs.map((p) => p.b - p.a);
  const wins = d.filter((x) => x > tie).length;
  const losses = d.filter((x) => x < -tie).length;
  return { n: pairs.length, meanDiff: d.length ? r2(mean(d)) : NaN, wins, losses, ties: pairs.length - wins - losses, pairs };
}

export interface Agg {
  readonly config: string;
  readonly runs: number;
  readonly done: number;
  readonly judges: Record<string, number | null>;
  readonly judge: number | null;
  readonly firstPass: number;
  readonly repairs: number;
  readonly criticSelf: string;
  readonly upliftShots: number;
  readonly uplift: number | null;
  readonly gateFailures: number;
  readonly belowFloor: number;
  readonly wall: number;
  readonly tokens: number;
  readonly usd: number;
  readonly usdPerMin: number | null;
}

/** Mean independently judged uplift of a set of rows: per judge, shot-weighted, then the mean over judges. */
export function upliftOf(rows: readonly Row[], judges: readonly string[]): number | null {
  const per = judges.map((j) => {
    let w = 0;
    let s = 0;
    for (const r of rows) {
      const u = r.uplift[j];
      if (typeof u === "number" && r.upliftShots > 0) {
        s += u * r.upliftShots;
        w += r.upliftShots;
      }
    }
    return w ? s / w : null;
  });
  return meanOrNull(per);
}

export function aggregate(config: string, rows: readonly Row[], judges: readonly string[]): Agg {
  const rs = rows.filter((r) => r.config === config);
  const self = rs.filter((r) => r.criticBefore !== null && r.criticAfter !== null);
  const usdPerMin = meanOrNull(rs.map((r) => r.usdPerMinute));
  return {
    config,
    runs: rs.length,
    done: rs.filter((r) => r.status === "done").length,
    judges: Object.fromEntries(judges.map((j) => [j, meanOrNull(rs.map((r) => r.judges[j]))])),
    judge: meanOrNull(rs.map((r) => r.judge)),
    firstPass: r2(mean(rs.map((r) => r.firstPassPct))),
    repairs: r2(mean(rs.map((r) => r.repairsPerShot))),
    criticSelf: self.length ? `${r2(mean(self.map((r) => r.criticBefore!)))} → ${r2(mean(self.map((r) => r.criticAfter!)))}` : "—",
    upliftShots: rs.reduce((t, r) => t + r.upliftShots, 0),
    uplift: upliftOf(rs, judges),
    gateFailures: rs.reduce((t, r) => t + r.gateFailures, 0),
    belowFloor: rs.reduce((t, r) => t + r.belowFloor, 0),
    wall: r2(mean(rs.map((r) => r.wallSec))),
    tokens: Math.round(mean(rs.map((r) => r.tokens)) || 0),
    usd: Math.round(rs.reduce((a, r) => a + r.usd, 0) * 1e4) / 1e4,
    usdPerMin: usdPerMin === null ? null : Math.round(mean(rs.filter((r) => r.usdPerMinute !== null).map((r) => r.usdPerMinute!)) * 1e4) / 1e4,
  };
}

const fmt = (v: number | null | undefined, p = "") => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${p}${v}`);
const signed = (v: number) => `${v >= 0 ? "+" : ""}${r2(v)}`;
const short = (m: string) => m.split("/").pop()!;

export function toCsv(rows: readonly Row[], judges: readonly string[]): string {
  const cols = ["version", "set", "config", "prompt", "language", "status", "shots", "rendered", "firstPassPct", "repairsPerShot", "criticBefore", "criticAfter", "lintLeft", "wallSec", "tokens", "usd", "filmSec", "usdPerMinute", "textCritic", "criticModel", "judge", ...judges.map((j) => `judge:${j}`), "upliftShots", ...judges.map((j) => `uplift:${j}`), "gateFailures", "belowFloor", "runId"];
  const val = (r: Row, c: string): unknown => (c.startsWith("judge:") ? r.judges[c.slice(6)] : c.startsWith("uplift:") ? r.uplift[c.slice(7)] : (r as unknown as Record<string, unknown>)[c]);
  return [cols.join(","), ...rows.map((r) => cols.map((c) => JSON.stringify(val(r, c) ?? "")).join(","))].join("\n") + "\n";
}

export interface ResultsInput {
  readonly generatedAt: string;
  readonly base: string;
  readonly provider: string;
  readonly mock: boolean;
  readonly judges: readonly string[];
  /** v2 rows (main + pilot) and the reused v1 crew rows */
  readonly rows: readonly Row[];
  readonly configs: readonly string[];
}

/** EVAL_RESULTS.md for v2 (numbers only from the rows; the honest reading is written by a person). */
export function resultsMarkdown(x: ResultsInput): string {
  const main = x.rows.filter((r) => r.set === "main");
  const pilot = x.rows.filter((r) => r.set === "pilot");
  const configs = [...x.configs, ...(main.some((r) => r.config === "crew v1") ? ["crew v1"] : [])];
  const agg = configs.map((c) => aggregate(c, main, x.judges));
  const crew = agg.find((a) => a.config === "crew v2");
  const vsSuper = pairStats(
    main.filter((r) => r.config === "super-only v2"),
    main.filter((r) => r.config === "crew v2"),
    (r) => r.judge,
  );
  const vsV1 = pairStats(
    main.filter((r) => r.config === "crew v1"),
    main.filter((r) => r.config === "crew v2"),
    (r) => r.judges[V1_JUDGE] ?? null,
  );
  const ok = (b: boolean | null) => (b === null ? "not measured" : b ? "✅ met" : "❌ missed");
  const targets = [
    ["Judge mean, crew v2 (mean of both judges)", `≥ ${TARGETS.judgeMean}`, fmt(crew?.judge), ok(crew?.judge === null || crew === undefined ? null : crew.judge >= TARGETS.judgeMean)],
    ["Crew v2 wins vs super-only v2 (paired, ±0.25 = tie)", `≥ ${TARGETS.winsOf10}/10`, vsSuper.n ? `${vsSuper.wins}/${vsSuper.n}` : "—", ok(vsSuper.n ? vsSuper.wins >= TARGETS.winsOf10 : null)],
    ["Critic uplift, independently judged", `≥ +${TARGETS.uplift}`, crew?.uplift === null || crew === undefined ? "—" : signed(crew.uplift), ok(crew?.uplift === null || crew === undefined ? null : crew.uplift >= TARGETS.uplift)],
    ["USD per finished minute, crew v2", `≤ $${TARGETS.usdPerMin.toFixed(2)}`, crew?.usdPerMin === null || crew === undefined ? "—" : `$${crew.usdPerMin.toFixed(3)}`, ok(crew?.usdPerMin === null || crew === undefined ? null : crew.usdPerMin <= TARGETS.usdPerMin)],
  ];
  const judgeCols = x.judges.map((j) => `Judge ${short(j)}`);
  const lines = [
    "# Director benchmark v2: results",
    x.mock ? "\n> ⚠ **MOCK DRY RUN: NOT RESULTS.** Produced by the scripted crew to test the bench pipeline.\n" : "",
    `Generated ${x.generatedAt} against \`${x.base}\` · provider **${x.provider}** · ${x.rows.filter((r) => r.version === "v2").length} v2 runs · raw data: [eval/v2/runs.csv](eval/v2/runs.csv), [eval/v2/runs.jsonl](eval/v2/runs.jsonl). v1 results: [EVAL_RESULTS_V1.md](EVAL_RESULTS_V1.md).`,
    "",
    "Same 10 prompts and the same judge prompt as v1. Configs: **super-only v2** = every role on Nemotron Super, no critic · **crew v2** = Ultra plans, Super draws, the hybrid critic (a VLM looks, Nemotron Nano scores, D33) with the floor, Nano edits · **crew v2+tavily** = crew v2 plus research (only when the server has a Tavily key) · **crew v1** = the v1 rows, reused, not re-run (judged by gemma only).",
    "",
    `**Independent judges** (blind to config, both different from the critic and from every crew model, checked per run): ${x.judges.length ? x.judges.map((j) => `\`${j}\``).join(" and ") : "**off** (no judge configured)"}. Each scores every final frame 0–10 against its shot description. "Judge" is the mean of the two. **Critic uplift** is judged independently too: for every shot where a revision replaced the first version, both judges score the pre-revision snapshot and the accepted one, and the uplift is the mean (after − before).`,
    "",
    "## Targets (SPEC v2 WP7)",
    "",
    "| Target | Goal | Measured | |",
    "|---|---|---|---|",
    ...targets.map((t) => `| ${t.join(" | ")} |`),
    "",
    "## By config",
    "",
    `| Config | Runs (done) | Judge (mean) | ${judgeCols.map((c) => ` ${c} |`).join("")} First-pass % | Repairs / shot | Critic self-score | Uplift (judged) [shots] | Gate failures | Below floor | Wall s | Tokens / run | USD total | USD / finished min |`,
    `|---|---|---|${judgeCols.map(() => "---|").join("")}---|---|---|---|---|---|---|---|---|---|`,
    ...agg.map((a) => `| ${a.config} | ${a.runs} (${a.done}) | ${fmt(a.judge)} | ${x.judges.map((j) => ` ${fmt(a.judges[j])} |`).join("")} ${fmt(a.firstPass)} | ${fmt(a.repairs)} | ${a.criticSelf} | ${a.uplift === null ? "—" : signed(a.uplift)} [${a.upliftShots}] | ${a.gateFailures} | ${a.belowFloor} | ${fmt(a.wall)} | ${a.tokens.toLocaleString("en")} | $${a.usd.toFixed(3)} | ${a.usdPerMin === null ? "—" : `$${a.usdPerMin.toFixed(3)}`} |`),
    "",
    "![Director benchmark v2 chart](eval/v2/chart.png)",
    "",
  ];
  const pairTable = (title: string, p: PairStats, la: string, lb: string, note: string) =>
    p.n
      ? [
          `## ${title}`,
          "",
          `${lb} − ${la} on the same prompt: mean **${signed(p.meanDiff)}**; ${lb} is better on **${p.wins}**, worse on **${p.losses}**, and ties (±0.25) on **${p.ties}** of ${p.n} prompts. ${note}`,
          "",
          `| Prompt | ${la} | ${lb} | Δ |`,
          "|---|---|---|---|",
          ...p.pairs.map((q) => `| ${q.prompt} | ${r2(q.a)} | ${r2(q.b)} | ${signed(q.b - q.a)} |`),
          "",
        ]
      : [];
  lines.push(...pairTable("Paired: crew v2 vs super-only v2 (mean of both judges)", vsSuper, "super-only v2", "crew v2", ""));
  lines.push(...pairTable(`Paired: crew v2 vs crew v1 (judge ${short(V1_JUDGE)} only, as in v1)`, vsV1, "crew v1", "crew v2", "Same prompts, same judge, same judge prompt; v1 frames were not kept, so the second judge can't score v1."));
  if (pilot.length) {
    lines.push(
      "## Hidamari pilot prompts (separate; not part of the comparison)",
      "",
      `| Prompt | Config | Status | Shots | Judge (mean) | ${judgeCols.map((c) => ` ${c} |`).join("")} Gate failures | Wall s | USD |`,
      `|---|---|---|---|---|${judgeCols.map(() => "---|").join("")}---|---|---|`,
      ...pilot.map((r) => `| ${r.prompt} | ${r.config} | ${r.status} | ${r.rendered}/${r.shots} | ${fmt(r.judge)} | ${x.judges.map((j) => ` ${fmt(r.judges[j])} |`).join("")} ${r.gateFailures} | ${r.wallSec} | $${r.usd.toFixed(4)} |`),
      "",
    );
  }
  lines.push(
    "## Per run",
    "",
    `| Version | Config | Prompt | Status | Shots | Judge | ${judgeCols.map((c) => ` ${c} |`).join("")} First-pass % | Repairs/shot | Critic self | Uplift [shots] | Gates | Wall s | USD |`,
    `|---|---|---|---|---|---|${judgeCols.map(() => "---|").join("")}---|---|---|---|---|---|---|`,
    ...main.map(
      (r) =>
        `| ${r.version} | ${r.config} | ${r.prompt} | ${r.status} | ${r.rendered}/${r.shots} | ${fmt(r.judge)} | ${x.judges.map((j) => ` ${fmt(r.judges[j])} |`).join("")} ${r.firstPassPct} | ${r.repairsPerShot} | ${fmt(r.criticBefore)} → ${fmt(r.criticAfter)} | ${upliftOf([r], x.judges) === null ? "—" : signed(upliftOf([r], x.judges)!)} [${r.upliftShots}] | ${r.gateFailures} | ${r.wallSec} | $${r.usd.toFixed(4)} |`,
    ),
    "",
    "## Reading the results (honest)",
    "",
    "_To be written by a person after the run, from the numbers above only. If a target is missed, say so; the prompts were not tuned on._",
    "",
    "Notes: judge calls are billed in the spend ledger but excluded from the per-run USD. USD uses the price table in `src/lib/providers/pricing.ts`. One run per prompt and config, so read small differences as noise.",
    "",
  );
  return lines.join("\n");
}
