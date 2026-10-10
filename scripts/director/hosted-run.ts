/**
 * One real Director run on the HOSTED demo, recorded as evidence (SPEC v2
 * WP1.7) and checked against the demo stop rule (D37): crew cost per
 * finished minute and wall time per 8 shots. The passcode comes from the
 * environment (DEMO_PASSCODE) and is never printed or written.
 *
 *   DEMO_PASSCODE=… npx tsx scripts/director/hosted-run.ts [--base https://…] [--sample en-kite] [--max-shots 8] [--out docs/hackathon/evidence] [--media <dir>]
 *
 * Writes <out>/hosted-run-v2-<date>-<sample>.json; with --media, also the film and stills (for review, not committed).
 */
import "./env";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { StudioClient, type SseEvent } from "./client";
import { appendLedger, assertSpendUnder } from "./ledger";
import { sampleByKey } from "@/lib/director/sampleStories";
import { DEMO_STOP_RULE, stopRuleVerdict } from "@/lib/services/director/stopRule";

const argv = process.argv.slice(2);
const arg = (k: string, d = "") => {
  const i = argv.indexOf(k);
  return i >= 0 ? (argv[i + 1] ?? d) : d;
};

interface Step {
  seq: number;
  role: string;
  model: string;
  action: string;
  shotIndex: number | null;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  latencyMs?: number;
  score?: number | null;
}

async function main() {
  const base = arg("--base", "https://studio-production-049c.up.railway.app");
  const sample = sampleByKey(arg("--sample", "en-kite"));
  if (!sample) throw new Error("unknown --sample");
  const maxShots = Number(arg("--max-shots", String(sample.maxShots)));
  const out = arg("--out", "docs/hackathon/evidence");
  const media = arg("--media");
  assertSpendUnder();
  const client = new StudioClient({ base, passcode: process.env.DEMO_PASSCODE });
  await client.unlock();
  const health = await client.json<{ commit: string; version: string; checks: Record<string, { status: string; detail?: string }> }>("GET", "/api/health");
  const pid = await client.createProject(`hosted run ${sample.key}`);
  const steps: Step[] = [];
  let models: unknown = null;
  let summary: Record<string, unknown> | null = null;
  let plan: { title?: string; shots?: unknown[] } | null = null;
  const t0 = Date.now();
  const runId = await client.direct(pid, { story: sample.story, language: sample.language, style: sample.style, maxShots, critic: true, research: "auto" }, (e: SseEvent) => {
    if (e.type === "run") models = e.models;
    if (e.type === "plan") plan = { title: e.title as string, shots: e.shots as unknown[] };
    if (e.type === "step") {
      const s = e.step as Step;
      steps.push(s);
      process.stdout.write(`  ${String(Math.round((Date.now() - t0) / 1000)).padStart(4)}s ${s.role}/${s.action}${s.shotIndex ? ` #${s.shotIndex}` : ""}${typeof s.score === "number" ? ` score ${s.score}` : ""}\n`);
    }
    if (e.type === "done") summary = e.summary as Record<string, unknown> | null;
  });
  const clientWallSec = (Date.now() - t0) / 1000;
  if (!summary) throw new Error(`run ${runId} ended without a summary`);
  const s = summary as Record<string, number & string & unknown[]>;
  const usd = Number(s.costUsd ?? 0);
  appendLedger({ script: "hosted-run", label: `${sample.key}:${runId}`, model: "crew", tokensIn: Number(s.tokens ?? 0), tokensOut: 0, costUsd: usd });

  // the film as a judge gets it (first request assembles the MP4)
  const tf = Date.now();
  const film = await client.download(`/api/projects/${pid}/film.mp4?v=${runId}`);
  const assembleSec = (Date.now() - tf) / 1000;
  const byRole: Record<string, { calls: number; tokens: number; usd: number }> = {};
  for (const st of steps) {
    if (!st.model || st.model === "engine" || st.model === "series") continue;
    const r = (byRole[st.role] ??= { calls: 0, tokens: 0, usd: 0 });
    r.calls++;
    r.tokens += (st.tokensIn ?? 0) + (st.tokensOut ?? 0);
    r.usd = Math.round((r.usd + (st.costUsd ?? 0)) * 1e6) / 1e6;
  }
  const verdict = stopRuleVerdict({ usd, filmSec: Number(s.durationSec ?? 0), wallSec: Number(s.wallMs ?? 0) / 1000, shots: Number(s.shots ?? 0) });
  const date = new Date().toISOString().slice(0, 10);
  const evidence = {
    at: new Date().toISOString(),
    base,
    server: { version: health.version, commit: health.commit, tts: health.checks.tts?.detail, tavily: health.checks.tavily?.status },
    sample: { key: sample.key, language: sample.language, style: sample.style, maxShots },
    runId,
    projectId: pid,
    models,
    title: (plan as { title?: string } | null)?.title ?? null,
    summary,
    clientWallSec: Math.round(clientWallSec),
    filmBytes: film.length,
    filmAssembleSec: Math.round(assembleSec * 10) / 10,
    byRole,
    stopRule: { rule: DEMO_STOP_RULE, ...verdict },
    steps: steps.map((st) => ({ seq: st.seq, role: st.role, model: st.model, action: st.action, shot: st.shotIndex, score: st.score ?? null, usd: st.costUsd ?? 0, ms: st.latencyMs ?? null })),
  };
  mkdirSync(out, { recursive: true });
  const file = path.join(out, `hosted-run-v2-${date}-${sample.key}.json`);
  writeFileSync(file, JSON.stringify(evidence, null, 2) + "\n");
  if (media) {
    mkdirSync(media, { recursive: true });
    writeFileSync(path.join(media, `${sample.key}.mp4`), film);
    const project = await client.json<{ frames: Array<{ index: number; imageUrl: string | null }> }>("GET", `/api/projects/${pid}`);
    for (const f of project.frames) if (f.imageUrl) writeFileSync(path.join(media, `${sample.key}-F${String(f.index).padStart(2, "0")}.png`), await client.download(f.imageUrl));
  }
  console.log(`\n${s.status} · ${s.rendered}/${s.shots} shots · film ${s.durationSec}s · wall ${Math.round(Number(s.wallMs) / 1000)}s · $${usd.toFixed(4)} · ${verdict.usdPerMin === null ? "—" : `$${verdict.usdPerMin}/min`} · wall per 8 shots ${verdict.wallPer8ShotsMin} min → stop rule ${verdict.tripped ? "TRIPPED: " + verdict.reasons.join("; ") : "ok"}`);
  console.log(`wrote ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
