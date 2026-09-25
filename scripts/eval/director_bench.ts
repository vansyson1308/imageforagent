/**
 * Director benchmark: 10 fixed story prompts (EN ×4, VI ×3, JA ×3; 4–12 shots)
 * × 3 configs, run through the public HTTP API of a running Storyboard Studio:
 *   A  super-only   every role on Nemotron Super, no critic (baseline)
 *   B  crew         Ultra plans · Super draws · Nano Omni critiques · Nano edits
 *   C  crew+tavily  B + Tavily reference research
 * Metrics per run: first-pass render success, repairs/shot, critic score
 * before → after, lint left, wall time, tokens, USD, USD per finished minute.
 *
 *   npm run director:bench -- --base http://localhost:3000 [--passcode p] [--configs A,B,C] [--limit 10] [--out docs/hackathon]
 *   npm run director:bench -- --base http://localhost:3100 --out /tmp/bench-dry --allow-mock   # pipeline dry run (never published)
 *
 * Writes <out>/eval/runs.csv, <out>/eval/runs.jsonl, <out>/eval/chart.png, <out>/EVAL_RESULTS.md.
 * Real numbers only: refuses the mock crew unless --allow-mock, and then stamps
 * every output "MOCK — NOT RESULTS".
 */
import "../director/env";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { StudioClient } from "../director/client";
import { appendLedger, assertSpendUnder } from "../director/ledger";

export const BENCH_PROMPTS = [
  { id: "en-lighthouse", language: "en", shots: 5, story: "An old lighthouse keeper's lamp breaks during a storm. A flock of fireflies gathers at the top of the tower and glows until a fishing boat finds the harbour. At dawn the keeper finds one firefly resting on the cold lamp." },
  { id: "en-robot-garden", language: "en", shots: 6, story: "A small cleaning robot in an empty city finds a single sunflower growing through a crack in the road. Every day it shades the flower from the sun with its own body. When the flower blooms, a bee arrives, and the robot has a friend." },
  { id: "en-paper-boat", language: "en", shots: 4, story: "A boy folds a paper boat from his late grandfather's letter and sets it on the rain gutter. The boat sails past the bakery, the school and the bridge, and stops at the river where his grandfather used to fish." },
  { id: "en-moon-bakery", language: "en", shots: 8, story: "A bakery on the moon only opens at night. The baker, a tired rabbit, runs out of flour on the busiest night of the year. The children of the town bring the crumbs from their pockets, and together they bake one giant loaf shaped like the Earth." },
  { id: "vi-ao-dai", language: "vi", shots: 6, story: "Mẹ may cho Lan chiếc áo dài đầu tiên để đi khai giảng. Trên đường tới trường trời đổ mưa, Lan che áo bằng chiếc nón lá của bà. Tới cổng trường, cô giáo mỉm cười và cài lên áo Lan một bông hoa phượng." },
  { id: "vi-trau-vang", language: "vi", shots: 5, story: "Chú trâu vàng cày ruộng giỏi nhất làng nhưng sợ tiếng sấm. Mùa gặt năm ấy trời giông, cậu bé chăn trâu thổi sáo cho trâu nghe suốt đêm. Sáng ra cả cánh đồng lúa đã được gặt kịp trước bão." },
  { id: "vi-cho-noi", language: "vi", shots: 7, story: "Ở chợ nổi Cái Răng, cô bé Út bán dưa hấu trên chiếc xuồng nhỏ. Một vị khách nước ngoài không biết tiếng Việt, Út vẽ lên vỏ dưa để trả giá. Hai người cười vang, và vị khách mua cả xuồng dưa." },
  { id: "ja-umbrella", language: "ja", shots: 4, story: "雨の日、少女は駅で傘を忘れた老人に自分の赤い傘を貸しました。一週間後、同じ駅に、赤い傘と小さな折り鶴が置いてありました。" },
  { id: "ja-tanuki", language: "ja", shots: 6, story: "山のたぬきは人間の村の祭りに行きたくて、提灯に化けました。けれども風が吹くたびに尻尾が出てしまいます。村の子どもたちは笑って、たぬきと一緒に盆踊りを踊りました。" },
  { id: "ja-sakura", language: "ja", shots: 12, story: "春、古い桜の木は今年は花を咲かせられないと思っていました。町の人々が毎日水をやり、子どもたちが木の下で歌を歌いました。最後の日の朝、たった一輪の花が咲き、町中の人が見に来ました。そして次の春、木は満開になりました。" },
] as const;

const CONFIGS = {
  A: { name: "super-only", body: { profile: "super-only", critic: false, research: false } },
  B: { name: "crew", body: { profile: "crew", critic: true, research: false } },
  C: { name: "crew+tavily", body: { profile: "crew", critic: true, research: true } },
} as const;
type ConfigKey = keyof typeof CONFIGS;

interface Row {
  config: string;
  prompt: string;
  language: string;
  status: string;
  shots: number;
  rendered: number;
  firstPassPct: number;
  repairsPerShot: number;
  criticBefore: number | null;
  criticAfter: number | null;
  lintLeft: number;
  wallSec: number;
  tokens: number;
  usd: number;
  filmSec: number;
  usdPerMinute: number | null;
  textCritic: boolean;
  runId: string;
}

const argv = process.argv.slice(2);
const arg = (k: string, d = "") => {
  const i = argv.indexOf(k);
  return i >= 0 ? (argv[i + 1] ?? d) : d;
};
const r2 = (x: number) => Math.round(x * 100) / 100;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

async function main() {
  const base = arg("--base", "http://localhost:3000");
  const out = arg("--out", "docs/hackathon");
  const limit = Number(arg("--limit", "10"));
  const configs = (arg("--configs", "A,B,C").split(",") as ConfigKey[]).filter((c) => c in CONFIGS);
  const allowMock = argv.includes("--allow-mock");
  const client = new StudioClient({ base, passcode: arg("--passcode") || process.env.DEMO_PASSCODE });
  await client.unlock();
  const meta = await client.json<{ director: { provider: string; research: boolean } }>("GET", "/api/meta");
  const mock = meta.director.provider !== "nemotron";
  if (mock && !allowMock) throw new Error(`Server provider is "${meta.director.provider}". The bench only reports real Nemotron runs (use --allow-mock for a labelled dry run).`);
  mkdirSync(`${out}/eval`, { recursive: true });
  const jsonl = `${out}/eval/runs.jsonl`;
  const rows: Row[] = [];

  for (const p of BENCH_PROMPTS.slice(0, limit)) {
    for (const c of configs) {
      if (!mock) assertSpendUnder();
      const cfg = CONFIGS[c];
      if (cfg.body.research && !meta.director.research) {
        console.log(`skip ${c}/${p.id}: server has no TAVILY_API_KEY`);
        continue;
      }
      const pid = await client.createProject(`bench ${c} ${p.id}`);
      let summary: Record<string, unknown> | null = null;
      const runId = await client.direct(pid, { story: p.story, language: p.language, style: "flat", maxShots: p.shots, ...cfg.body }, (e) => {
        if (e.type === "done") summary = e.summary as Record<string, unknown>;
      });
      const s = (summary ?? {}) as Record<string, number & string & boolean>;
      const shots = Number(s.shots ?? 0);
      const filmSec = Number(s.durationSec ?? 0);
      const usd = Number(s.costUsd ?? 0);
      const row: Row = {
        config: cfg.name,
        prompt: p.id,
        language: p.language,
        status: String(s.status ?? "error"),
        shots,
        rendered: Number(s.rendered ?? 0),
        firstPassPct: shots ? r2((100 * Number(s.firstPassOk ?? 0)) / shots) : 0,
        repairsPerShot: shots ? r2(Number(s.repairs ?? 0) / shots) : 0,
        criticBefore: s.criticBefore ?? null,
        criticAfter: s.criticAfter ?? null,
        lintLeft: Number(s.lintErrors ?? 0) + Number(s.lintWarnings ?? 0),
        wallSec: r2(Number(s.wallMs ?? 0) / 1000),
        tokens: Number(s.tokens ?? 0),
        usd,
        filmSec: r2(filmSec),
        usdPerMinute: filmSec > 0 ? r2((usd / filmSec) * 60 * 1000) / 1000 : null,
        textCritic: Boolean(s.textCritic),
        runId,
      };
      rows.push(row);
      appendFileSync(jsonl, JSON.stringify({ ...row, at: new Date().toISOString(), mock }) + "\n");
      if (!mock) appendLedger({ script: "bench", label: `${c}:${p.id}`, model: cfg.name, tokensIn: row.tokens, tokensOut: 0, costUsd: usd });
      console.log(`${c} ${p.id.padEnd(16)} ${row.status.padEnd(15)} shots ${row.rendered}/${shots} first-pass ${row.firstPassPct}% critic ${row.criticBefore ?? "-"}→${row.criticAfter ?? "-"} $${usd.toFixed(4)} ${row.wallSec}s`);
    }
  }

  const header = Object.keys(rows[0] ?? { config: "" }) as (keyof Row)[];
  writeFileSync(`${out}/eval/runs.csv`, [header.join(","), ...rows.map((r) => header.map((h) => JSON.stringify(r[h] ?? "")).join(","))].join("\n") + "\n");

  const agg = configs.map((c) => {
    const rs = rows.filter((r) => r.config === CONFIGS[c].name);
    const scored = rs.filter((r) => r.criticBefore !== null && r.criticAfter !== null);
    return {
      config: CONFIGS[c].name,
      runs: rs.length,
      done: rs.filter((r) => r.status === "done").length,
      firstPass: r2(mean(rs.map((r) => r.firstPassPct))),
      repairs: r2(mean(rs.map((r) => r.repairsPerShot))),
      before: scored.length ? r2(mean(scored.map((r) => r.criticBefore!))) : null,
      after: scored.length ? r2(mean(scored.map((r) => r.criticAfter!))) : null,
      lint: r2(mean(rs.map((r) => r.lintLeft))),
      wall: r2(mean(rs.map((r) => r.wallSec))),
      tokens: Math.round(mean(rs.map((r) => r.tokens))),
      usd: r2(rs.reduce((a, r) => a + r.usd, 0) * 1000) / 1000,
      usdPerMin: r2(mean(rs.filter((r) => r.usdPerMinute !== null).map((r) => r.usdPerMinute!)) * 1000) / 1000,
    };
  });

  await writeChart(`${out}/eval/chart.png`, agg, mock);
  const stamp = mock ? "\n> ⚠ **MOCK DRY RUN: NOT RESULTS.** Produced by the scripted crew to test the bench pipeline.\n" : "";
  const md = [
    "# Director benchmark: results",
    stamp,
    `Generated ${new Date().toISOString()} against \`${base}\` · provider **${meta.director.provider}** · ${rows.length} runs · raw data: [eval/runs.csv](eval/runs.csv), [eval/runs.jsonl](eval/runs.jsonl).`,
    "",
    "Configs: **super-only** = every role on Nemotron Super, no critic · **crew** = Ultra plans, Super draws, Nano Omni critiques (≤ 2 revisions), Nano edits · **crew+tavily** = crew plus Tavily references.",
    "",
    "| Config | Runs (done) | First-pass render % | Repairs / shot | Critic before → after | Lint left | Wall s | Tokens / run | USD total | USD / finished min |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...agg.map((a) => `| ${a.config} | ${a.runs} (${a.done}) | ${a.firstPass} | ${a.repairs} | ${a.before ?? "—"} → ${a.after ?? "—"} | ${a.lint} | ${a.wall} | ${a.tokens.toLocaleString("en")} | $${a.usd} | $${a.usdPerMin} |`),
    "",
    "![Director benchmark chart](eval/chart.png)",
    "",
    "## Per run",
    "",
    "| Config | Prompt | Status | Shots | First-pass % | Repairs/shot | Critic | Lint | Wall s | USD |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.config} | ${r.prompt} | ${r.status} | ${r.rendered}/${r.shots} | ${r.firstPassPct} | ${r.repairsPerShot} | ${r.criticBefore ?? "—"} → ${r.criticAfter ?? "—"}${r.textCritic ? " (text)" : ""} | ${r.lintLeft} | ${r.wallSec} | $${r.usd.toFixed(4)} |`),
    "",
    "Notes: critic scores come from the crew's own critic, so they measure self-assessed uplift and are not an independent quality rating. A revision replaces a shot only when it scores higher (DECISIONS D11). USD uses the price table in `src/lib/providers/pricing.ts`, which should be reconciled with the Token Factory billing page.",
    "",
  ].join("\n");
  writeFileSync(`${out}/EVAL_RESULTS.md`, md);
  console.log(`wrote ${out}/EVAL_RESULTS.md`);
}

/** Small multiples (one panel per metric, one bar per config): no dual axes. Validated palette slots 1–3. */
async function writeChart(file: string, agg: Array<{ config: string; firstPass: number; after: number | null; before: number | null; usdPerMin: number; wall: number }>, mock: boolean) {
  const colors = ["#2a78d6", "#eb6834", "#1baf7a"];
  const panels = [
    { title: "First-pass render %", v: agg.map((a) => a.firstPass), max: 100, fmt: (x: number) => `${x}%` },
    { title: "Critic uplift (after − before)", v: agg.map((a) => (a.after !== null && a.before !== null ? r2(a.after - a.before) : NaN)), max: null, fmt: (x: number) => (x >= 0 ? `+${x}` : `${x}`) },
    { title: "USD per finished minute", v: agg.map((a) => a.usdPerMin), max: null, fmt: (x: number) => `$${x}` },
    { title: "Wall time per film (s)", v: agg.map((a) => a.wall), max: null, fmt: (x: number) => `${Math.round(x)}` },
  ];
  const W = 1200, H = 520, pw = 270, ph = 300, top = 120, left = 40, gap = 20;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="Helvetica, Arial, sans-serif"><rect width="${W}" height="${H}" fill="#fcfcfb"/>`;
  svg += `<text x="${left}" y="44" font-size="24" font-weight="700" fill="#0b0b0b">Storyboard Studio Director: benchmark${mock ? " (MOCK DRY RUN, NOT RESULTS)" : ""}</text>`;
  agg.forEach((a, i) => {
    const x = left + i * 200;
    svg += `<rect x="${x}" y="68" width="14" height="14" rx="3" fill="${colors[i]}"/><text x="${x + 20}" y="80" font-size="15" fill="#52514e">${esc(a.config)}</text>`;
  });
  panels.forEach((p, k) => {
    const x0 = left + k * (pw + gap);
    const max = p.max ?? Math.max(1e-9, ...p.v.filter(Number.isFinite).map((v) => Math.abs(v))) * 1.15;
    svg += `<text x="${x0}" y="${top - 12}" font-size="15" font-weight="600" fill="#0b0b0b">${esc(p.title)}</text>`;
    svg += `<line x1="${x0}" y1="${top + ph}" x2="${x0 + pw}" y2="${top + ph}" stroke="#d6d5cf" stroke-width="1"/>`;
    const bw = (pw - 40) / Math.max(1, p.v.length) - 10;
    p.v.forEach((v, i) => {
      const h = Number.isFinite(v) ? Math.max(0, (Math.abs(v) / max) * (ph - 30)) : 0;
      const bx = x0 + 20 + i * (bw + 10);
      svg += `<rect x="${bx}" y="${top + ph - h}" width="${bw}" height="${h}" rx="4" fill="${colors[i]}"/>`;
      svg += `<text x="${bx + bw / 2}" y="${top + ph - h - 8}" font-size="14" text-anchor="middle" fill="#0b0b0b">${esc(Number.isFinite(v) ? p.fmt(v) : "n/a")}</text>`;
    });
  });
  svg += `<text x="${left}" y="${H - 24}" font-size="13" fill="#52514e">Critic uplift is the crew critic's self-assessment. Costs are estimated from list prices (pricing.ts).</text></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(file);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
