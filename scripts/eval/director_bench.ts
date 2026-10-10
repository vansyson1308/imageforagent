/**
 * Director benchmark v2 (SPEC v2 WP7): the v1 prompts (EN ×4, VI ×3, JA ×3;
 * 4–12 shots) through the public HTTP API of a running Storyboard Studio.
 *   A  super-only v2     every role on Nemotron Super, no critic (baseline)
 *   B  crew v2           Ultra plans · Super draws · hybrid critic (VLM looks, Nano scores, D33) · Nano edits
 *   C  crew v2+tavily    B + research (only when the server has a Tavily key)
 *   crew v1              the v1 rows from eval/runs.jsonl, reused (never re-run)
 * TWO independent judges, both different from the critic and every crew model
 * (checked against each run's own model list): the v1 judge gemma-3-27b-it plus
 * a second served VLM, probed live with an image. Each scores every final frame
 * 0–10 against its shot description, blind to config. The critic's uplift is
 * judged independently too: pre-revision vs accepted snapshot of each revised shot.
 *
 *   npm run director:bench -- --base http://localhost:3000 --eval-commit <sha> [--passcode p] [--configs A,B,C] [--limit 10] [--judges a,b] [--prompts main|pilot] [--out docs/hackathon]
 *   npm run director:bench -- --base http://localhost:3100 --out /tmp/bench-dry --allow-mock --judges ""   # pipeline dry run (never published)
 *
 * Writes <out>/eval/v2/runs.{jsonl,csv}, <out>/eval/v2/chart.png, <out>/EVAL_RESULTS.md
 * (keeping an existing "Reading the results (honest)" section). Real numbers only:
 * refuses the mock crew unless --allow-mock, and then stamps everything "MOCK — NOT RESULTS".
 * --eval-commit: the ONE frozen server commit the whole bench runs on (owner QC 2026-10-10). The bench
 * refuses to start on another commit, stops if the server's commit changes mid-bench, records the commit
 * on every row, and on resume keeps only rows made on this commit.
 * `--prompts pilot` runs the owner's Hidamari prompts from eval/pilot-prompts.json (a separate table).
 */
import "../director/env";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { StudioClient, type SseEvent } from "../director/client";
import { NemotronProvider } from "@/lib/providers/nemotronProvider";
import { JUDGE_MAX_TOKENS } from "@/lib/services/evalJudges";
import { appendLedger, assertSpendUnder } from "../director/ledger";
import { aggregate, fromV1, JUDGE_PROMPT, judgeProblems, mean, parseJudgeScore, r2, resultsMarkdown, revisedShots, SECOND_JUDGE_CANDIDATES, toCsv, V1_JUDGE, type Row, type StepLike } from "./benchCore";

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

interface Prompt {
  readonly id: string;
  readonly language: string;
  readonly shots: number;
  readonly story: string;
  readonly style?: string;
}

const CONFIGS = {
  A: { name: "super-only v2", body: { profile: "super-only", critic: false, research: false } },
  B: { name: "crew v2", body: { profile: "crew", critic: true, research: false } },
  C: { name: "crew v2+tavily", body: { profile: "crew", critic: true, research: true } },
} as const;
type ConfigKey = keyof typeof CONFIGS;

const argv = process.argv.slice(2);
const arg = (k: string, d = "") => {
  const i = argv.indexOf(k);
  return i >= 0 ? (argv[i + 1] ?? d) : d;
};

/** What a judge needs from a provider: one chat call that returns text, usage and cost. */
interface JudgeChat {
  chat(messages: Array<{ role: "user"; content: string; images?: string[] }>, opts: { model: string; maxTokens: number; temperature?: number; responseFormat?: { type: "json_object" } }): Promise<{ text: string; usage: { promptTokens: number; completionTokens: number }; costUsd: number }>;
}
type Judge = { model: string; provider: JudgeChat };

/** Judges on the Studio server (D48) when this machine has no provider key: the key never leaves the server. */
function remoteJudge(client: StudioClient): JudgeChat {
  return {
    chat: (messages, opts) => client.judge({ model: opts.model, prompt: messages[0].content, image: messages[0].images?.[0] ?? "", maxTokens: opts.maxTokens, json: Boolean(opts.responseFormat) }),
  };
}

async function toJpeg(img: Buffer): Promise<string> {
  const jpeg = await sharp(img).resize({ width: 1024, height: 1024, fit: "inside" }).jpeg({ quality: 82 }).toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}

/** Score one image with one judge; billed to the ledger (not to the run). */
async function judgeImage(j: Judge, uri: string, shot: string, label: string, mock: boolean): Promise<number | null> {
  try {
    const r = await j.provider.chat([{ role: "user", content: `${JUDGE_PROMPT}\n\n${shot}`, images: [uri] }], { model: j.model, maxTokens: JUDGE_MAX_TOKENS, temperature: 0, responseFormat: { type: "json_object" } });
    if (!mock) appendLedger({ script: "bench-judge", label, model: j.model, tokensIn: r.usage.promptTokens, tokensOut: r.usage.completionTokens, costUsd: r.costUsd });
    return parseJudgeScore(r.text);
  } catch (e) {
    console.log(`  judge ${j.model} failed on ${label}: ${String(e).slice(0, 120)}`);
    return null;
  }
}

/** Share of the demo's daily token budget already used, from /api/health (null when the server doesn't say). */
async function dailyBudgetUsedPct(client: StudioClient): Promise<number | null> {
  try {
    const h = await client.json<{ checks?: { demoBudget?: { detail?: string } } }>("GET", "/api/health");
    const m = h.checks?.demoBudget?.detail?.match(/(\d+)% of today's token budget used/);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

/** A judge must actually see: a red disc must come back as "red". */
async function probeVision(provider: JudgeChat, model: string): Promise<boolean> {
  const png = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#ffffff"/><circle cx="128" cy="128" r="90" fill="#d01010"/></svg>')).png().toBuffer();
  try {
    const r = await provider.chat([{ role: "user", content: 'What colour is the disc? Answer ONLY JSON {"color": "<one word>"}.', images: [`data:image/png;base64,${png.toString("base64")}`] }], { model, maxTokens: 400, temperature: 0 });
    appendLedger({ script: "bench-judge-probe", label: model, model, tokensIn: r.usage.promptTokens, tokensOut: r.usage.completionTokens, costUsd: r.costUsd });
    return /red/i.test(r.text);
  } catch (e) {
    console.log(`  probe ${model}: ${String(e).slice(0, 120)}`);
    return false;
  }
}

async function pickJudges(mock: boolean, client: StudioClient): Promise<Judge[]> {
  const key = process.env.NEBIUS_API_KEY;
  const explicit = argv.includes("--judges") ? arg("--judges", "").split(",").map((s) => s.trim()).filter(Boolean) : null;
  if (explicit && !explicit.length) return [];
  if (!key && mock) return [];
  // no key here: judge on the server (operator passcode required; D48)
  const provider: JudgeChat = key ? new NemotronProvider({ apiKey: key, baseUrl: process.env.NEBIUS_BASE_URL }) : remoteJudge(client);
  if (!key) console.log("judging on the server (/api/eval/judge): no provider key on this machine");
  const want = explicit ?? [V1_JUDGE];
  const judges: Judge[] = [];
  for (const m of want) {
    if (!(await probeVision(provider, m))) throw new Error(`judge ${m} did not pass the image probe`);
    judges.push({ model: m, provider });
  }
  if (!explicit) {
    for (const m of SECOND_JUDGE_CANDIDATES) {
      if (await probeVision(provider, m)) {
        judges.push({ model: m, provider });
        break;
      }
      console.log(`  second-judge candidate ${m} can't see images; trying the next`);
    }
    if (judges.length < 2) console.log("WARNING: no second judge passed the probe; reporting one judge only.");
  }
  return judges;
}

async function main() {
  const base = arg("--base", "http://localhost:3000");
  const out = arg("--out", "docs/hackathon");
  const limit = Number(arg("--limit", "10"));
  const set = arg("--prompts", "main") === "pilot" ? "pilot" : "main";
  const configs = (arg("--configs", set === "pilot" ? "B" : "A,B,C").split(",") as ConfigKey[]).filter((c) => c in CONFIGS);
  const allowMock = argv.includes("--allow-mock");
  const client = new StudioClient({ base, passcode: arg("--passcode") || process.env.DEMO_PASSCODE });
  await client.unlock();
  const meta = await client.json<{ director: { provider: string; research: boolean } }>("GET", "/api/meta");
  const mock = meta.director.provider !== "nemotron";
  const serverCommit = async () => (await client.json<{ commit?: string }>("GET", "/api/health")).commit ?? "";
  const evalCommit = arg("--eval-commit");
  if (!mock && !evalCommit) throw new Error("--eval-commit <sha> is required: the whole bench runs on ONE frozen server commit (owner QC 2026-10-10).");
  if (evalCommit && !(await serverCommit()).startsWith(evalCommit)) throw new Error(`The server runs ${(await serverCommit()).slice(0, 7)}, not the eval commit ${evalCommit}: deploy it (and nothing newer) first.`);
  if (mock && !allowMock) throw new Error(`Server provider is "${meta.director.provider}". The bench only reports real Nemotron runs (use --allow-mock for a labelled dry run).`);
  const prompts: readonly Prompt[] =
    set === "pilot"
      ? (() => {
          const f = `${out}/eval/pilot-prompts.json`;
          if (!existsSync(f)) throw new Error(`${f} is missing: the owner supplies or approves the 3 Hidamari stories (BLOCKERS O4).`);
          // one scene per shot (owner packages, docs/hackathon/pilot/); the story is the narration read in order
          const pilot = JSON.parse(readFileSync(f, "utf8")) as Array<{ id: string; language: string; style?: string; scenes: Array<{ lines: Array<{ text: string }> }> }>;
          return pilot.map((p) => ({ id: p.id, language: p.language, style: p.style, shots: p.scenes.length, story: p.scenes.flatMap((s) => s.lines.map((l) => l.text)).join("") }));
        })()
      : BENCH_PROMPTS;
  const judges = await pickJudges(mock, client);
  console.log(`judges: ${judges.map((j) => j.model).join(", ") || "none"}`);
  const judgeNames = judges.map((j) => j.model);

  const dir = `${out}/eval/v2`;
  mkdirSync(dir, { recursive: true });
  const jsonl = `${dir}/runs.jsonl`;
  // Resume: v2 rows already in runs.jsonl (same mock-ness, same judges) are kept and not re-run
  const rows: Row[] = existsSync(jsonl)
    ? readFileSync(jsonl, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Row & { mock?: boolean })
        .filter((r) => Boolean(r.mock) === mock && r.status !== "error" && (!evalCommit || (r.commit ?? "").startsWith(evalCommit)))
    : [];
  if (rows.length) console.log(`resuming: ${rows.length} runs already in ${jsonl}`);

  outer: for (const p of prompts.slice(0, limit)) {
    for (const c of configs) {
      if (!mock) assertSpendUnder();
      const cfg = CONFIGS[c];
      if (cfg.body.research && !meta.director.research) {
        console.log(`skip ${c}/${p.id}: server has no TAVILY_API_KEY`);
        continue;
      }
      if (rows.some((r) => r.config === cfg.name && r.prompt === p.id && r.set === set)) continue;
      // a run that hits the demo's daily token budget mid-film would come back cut short: stop cleanly and resume after 00:00 UTC
      if (!mock && evalCommit && !(await serverCommit()).startsWith(evalCommit)) {
        console.log(`STOP: the server's commit changed to ${(await serverCommit()).slice(0, 7)} mid-bench; the eval commit is ${evalCommit}`);
        break outer;
      }
      if (!mock) {
        const used = await dailyBudgetUsedPct(client);
        if (used !== null && used >= 80) {
          console.log(`STOP: ${used}% of the server's daily token budget is used; resume after 00:00 UTC (rows so far are kept)`);
          break outer;
        }
      }
      const steps: StepLike[] = [];
      let models: Record<string, string | null> = {};
      let summary: Record<string, unknown> | null = null;
      let pid = "";
      let runId = "";
      try {
        pid = await client.createProject(`bench ${c} ${p.id}`);
        runId = await client.direct(pid, { story: p.story, language: p.language, style: p.style ?? "flat", maxShots: p.shots, ...cfg.body }, (e: SseEvent) => {
          if (e.type === "run") models = (e.models as Record<string, string | null>) ?? {};
          if (e.type === "step") steps.push(e.step as StepLike);
          if (e.type === "done") summary = e.summary as Record<string, unknown> | null;
        });
      } catch (e) {
        console.log(`  ${c}/${p.id}: ${String(e).slice(0, 160)}`);
      }
      if (!summary) {
        console.log(`${c} ${p.id}: no result, recorded as error (run ${runId || "not started"})`);
        appendFileSync(jsonl, JSON.stringify({ version: "v2", set, config: cfg.name, prompt: p.id, language: p.language, status: "error", runId, at: new Date().toISOString(), mock }) + "\n");
        continue;
      }
      const problems = judgeProblems(judgeNames, Object.values(models));
      if (problems.length) throw new Error(`Judges are not independent of this run's crew: ${problems.join("; ")}`);

      // final frames, every judge
      const project = await client.json<{ frames: Array<{ index: number; shotType: string; description: string; imageUrl: string | null }> }>("GET", `/api/projects/${pid}`);
      const perJudge: Record<string, number[]> = Object.fromEntries(judgeNames.map((j) => [j, []]));
      for (const f of project.frames) {
        if (!f.imageUrl) continue;
        const uri = await toJpeg(await client.download(f.imageUrl));
        for (const j of judges) {
          const s = await judgeImage(j, uri, `Shot ${f.index} (${f.shotType}): ${f.description}`, `${c}:${p.id}#${f.index}`, mock);
          if (s !== null) perJudge[j.model].push(s);
        }
      }
      // independently judged critic uplift: pre-revision vs accepted snapshot, same judges
      const revised = revisedShots(steps);
      const deltas: Record<string, number[]> = Object.fromEntries(judgeNames.map((j) => [j, []]));
      for (const rv of revised) {
        const f = project.frames.find((x) => x.index === rv.shotIndex);
        const shot = `Shot ${rv.shotIndex} (${f?.shotType ?? ""}): ${f?.description ?? ""}`;
        const [b, a] = await Promise.all([client.download(rv.before.imageUrl).then(toJpeg), client.download(rv.after.imageUrl).then(toJpeg)]);
        for (const j of judges) {
          const sb = await judgeImage(j, b, shot, `${c}:${p.id}#${rv.shotIndex}:before`, mock);
          const sa = await judgeImage(j, a, shot, `${c}:${p.id}#${rv.shotIndex}:after`, mock);
          if (sb !== null && sa !== null) deltas[j.model].push(sa - sb);
        }
      }
      const s = summary as Record<string, unknown>;
      const shots = Number(s.shots ?? 0);
      const filmSec = Number(s.durationSec ?? 0);
      const usd = Number(s.costUsd ?? 0);
      const judgeScores = Object.fromEntries(judgeNames.map((j) => [j, perJudge[j].length ? r2(mean(perJudge[j])) : null]));
      const scored = Object.values(judgeScores).filter((v): v is number => v !== null);
      const row: Row = {
        version: "v2",
        set,
        config: cfg.name,
        prompt: p.id,
        language: p.language,
        status: String(s.status ?? "error"),
        shots,
        rendered: Number(s.rendered ?? 0),
        firstPassPct: shots ? r2((100 * Number(s.firstPassOk ?? 0)) / shots) : 0,
        repairsPerShot: shots ? r2(Number(s.repairs ?? 0) / shots) : 0,
        criticBefore: (s.criticBefore as number | null) ?? null,
        criticAfter: (s.criticAfter as number | null) ?? null,
        lintLeft: Number(s.lintErrors ?? 0) + Number(s.lintWarnings ?? 0),
        wallSec: r2(Number(s.wallMs ?? 0) / 1000),
        tokens: Number(s.tokens ?? 0),
        usd,
        filmSec: r2(filmSec),
        usdPerMinute: filmSec > 0 ? r2((usd / filmSec) * 60 * 1000) / 1000 : null,
        textCritic: Boolean(s.textCritic),
        criticModel: (s.criticModel as string | null) ?? null,
        judges: judgeScores,
        judge: scored.length ? r2(mean(scored)) : null,
        upliftShots: revised.length,
        uplift: Object.fromEntries(judgeNames.map((j) => [j, deltas[j].length ? r2(mean(deltas[j])) : null])),
        gateFailures: Number(s.gateFailures ?? 0),
        belowFloor: Array.isArray(s.belowFloor) ? s.belowFloor.length : 0,
        runId,
        commit: mock ? "mock" : await serverCommit(),
      };
      rows.push(row);
      appendFileSync(jsonl, JSON.stringify({ ...row, at: new Date().toISOString(), mock }) + "\n");
      if (!mock) appendLedger({ script: "bench", label: `${c}:${p.id}`, model: cfg.name, tokensIn: row.tokens, tokensOut: 0, costUsd: usd });
      console.log(`${c} ${p.id.padEnd(16)} ${row.status.padEnd(15)} shots ${row.rendered}/${shots} first-pass ${row.firstPassPct}% judge ${row.judge ?? "-"} uplift[${row.upliftShots}] ${JSON.stringify(row.uplift)} gates ${row.gateFailures} $${usd.toFixed(4)} ${row.wallSec}s`);
    }
  }

  // v1 crew rows, reused (never re-run)
  const v1File = `${out}/eval/runs.jsonl`;
  const v1 = existsSync(v1File) && !mock ? readFileSync(v1File, "utf8").split("\n").filter(Boolean).map((l) => fromV1(JSON.parse(l))).filter((r): r is Row => r !== null) : [];
  const all = [...rows, ...v1];
  writeFileSync(`${dir}/runs.csv`, toCsv(all, judgeNames));
  const shown = Object.values(CONFIGS).map((c) => c.name).filter((n) => rows.some((r) => r.config === n));
  await writeChart(`${dir}/chart.png`, [...shown, ...(v1.length ? ["crew v1"] : [])].map((c) => aggregate(c, all.filter((r) => r.set === "main"), judgeNames)), mock);
  let md = resultsMarkdown({ generatedAt: new Date().toISOString(), base, provider: meta.director.provider, mock, judges: judgeNames, rows: all, configs: shown });
  const target = `${out}/EVAL_RESULTS.md`;
  const prev = existsSync(target) ? readFileSync(target, "utf8") : "";
  const reading = prev.startsWith("# Director benchmark v2") ? prev.match(/## Reading the results \(honest\)\n[\s\S]*?(?=\nNotes: )/)?.[0] : null;
  if (reading && !reading.includes("_To be written by a person")) md = md.replace(/## Reading the results \(honest\)\n[\s\S]*?(?=\nNotes: )/, reading);
  writeFileSync(target, md);
  console.log(`wrote ${target}`);
}

/** Small multiples (one panel per metric, one bar per config): no dual axes. */
async function writeChart(file: string, agg: ReturnType<typeof aggregate>[], mock: boolean) {
  const colors = ["#2a78d6", "#eb6834", "#1baf7a", "#8a8984"];
  const panels = [
    { title: "Independent judges (0–10, mean)", v: agg.map((a) => a.judge ?? NaN), max: 10, fmt: (x: number) => `${x}` },
    { title: "First-pass render %", v: agg.map((a) => a.firstPass), max: 100, fmt: (x: number) => `${x}%` },
    { title: "USD per finished minute", v: agg.map((a) => a.usdPerMin ?? NaN), max: null, fmt: (x: number) => `$${x}` },
    { title: "Wall time per film (s)", v: agg.map((a) => a.wall), max: null, fmt: (x: number) => `${Math.round(x)}` },
  ];
  const W = 1200, H = 520, pw = 270, ph = 300, top = 120, left = 40, gap = 20;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="Helvetica, Arial, sans-serif"><rect width="${W}" height="${H}" fill="#fcfcfb"/>`;
  svg += `<text x="${left}" y="44" font-size="24" font-weight="700" fill="#0b0b0b">Storyboard Studio Director: benchmark v2${mock ? " (MOCK DRY RUN, NOT RESULTS)" : ""}</text>`;
  agg.forEach((a, i) => {
    const x = left + i * 220;
    svg += `<rect x="${x}" y="68" width="14" height="14" rx="3" fill="${colors[i % colors.length]}"/><text x="${x + 20}" y="80" font-size="15" fill="#52514e">${esc(a.config)}</text>`;
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
      svg += `<rect x="${bx}" y="${top + ph - h}" width="${bw}" height="${h}" rx="4" fill="${colors[i % colors.length]}"/>`;
      svg += `<text x="${bx + bw / 2}" y="${top + ph - h - 8}" font-size="14" text-anchor="middle" fill="#0b0b0b">${esc(Number.isFinite(v) ? p.fmt(v) : "n/a")}</text>`;
    });
  });
  svg += `<text x="${left}" y="${H - 24}" font-size="13" fill="#52514e">crew v1 is judged by gemma only (v1 frames were not kept). Costs are estimated from list prices (pricing.ts).</text></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(file);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
