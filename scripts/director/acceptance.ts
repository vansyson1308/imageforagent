/**
 * Judge-run acceptance (owner + QC 2026-10-31, D96): one finished run per
 * landing-page sample, read back through the API (no model call), checked
 * against the bar a judge's click must clear on the successor models:
 *   status done · every planned shot rendered · wall ≤ 720 s (hard fail > 900 s
 *   or > 75 % of the public token cap) · 0 gate failures · Artist valid SVG on
 *   the first call ≥ 90 % · critic after revision ≥ 5.8 · ≤ $0.70 / finished min.
 *   npx tsx scripts/director/acceptance.ts --base http://localhost:3000 <projectId>:<runId> […]
 * The passcode comes from DEMO_PASSCODE (never printed). Writes
 * docs/hackathon/evidence/successors/acceptance-<timestamp>.json and prints a Markdown table.
 */
import "./env";
import { mkdirSync, writeFileSync } from "node:fs";
import { StudioClient } from "./client";

const argv = process.argv.slice(2);
const arg = (k: string, d = "") => {
  const i = argv.indexOf(k);
  return i >= 0 ? (argv[i + 1] ?? d) : d;
};

export const ACCEPTANCE = { wallSec: 720, hardWallSec: 900, capShare: 0.75, gateFailures: 0, firstCallValid: 0.9, critic: 5.8, usdPerMin: 0.7 } as const;

/** The engine's "this is not a usable SVG" errors (a framing/lighting gate failure is a valid SVG that missed a measure). */
const SVG_INVALID = /No SVG fragment|SVG (frame|defs) rejected|failed to render|not well-formed|Opening and ending tag|Premature end/i;
const CALLS = new Set(["draw", "revise", "repair"]);

interface Step {
  readonly seq: number;
  readonly role: string;
  readonly action: string;
  readonly shotIndex: number | null;
  readonly attempt: number;
  readonly error: string | null;
}

/** Each artist call and whether its reply was a usable SVG (the next step of that shot is `<action>:invalid` with an SVG error). */
export function artistCalls(steps: readonly Step[]): Array<{ shot: number; action: string; attempt: number; validSvg: boolean; passed: boolean }> {
  const out = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.role !== "artist" || !CALLS.has(s.action) || s.shotIndex === null) continue;
    const next = steps.slice(i + 1).find((n) => n.role === "artist" && n.shotIndex === s.shotIndex);
    const invalid = next?.action === `${s.action}:invalid` ? next : null;
    out.push({ shot: s.shotIndex, action: s.action, attempt: s.attempt, validSvg: !(invalid && SVG_INVALID.test(invalid.error ?? "")), passed: !invalid });
  }
  return out;
}

async function main() {
  const base = arg("--base", "http://localhost:3000");
  const capTokens = Number(arg("--cap", "500000"));
  const pairs = argv.filter((a) => /^[\w-]+:[\w-]+$/.test(a));
  const client = new StudioClient({ base, passcode: process.env.DEMO_PASSCODE });
  await client.unlock();
  const rows = [];
  for (const pair of pairs) {
    const [pid, runId] = pair.split(":");
    const t = await client.json<{ status: string; models: Record<string, string>; costUsd: number; tokensIn: number; tokensOut: number; summary: Record<string, unknown> | null; steps: Step[]; story: string; language: string }>("GET", `/api/projects/${pid}/director/runs/${runId}`);
    const s = (t.summary ?? {}) as Record<string, number>;
    const calls = artistCalls(t.steps);
    const firsts = calls.filter((c) => c.action === "draw" && c.attempt === 0);
    const wallSec = Math.round(Number(s.wallMs ?? 0) / 1000);
    const tokens = t.tokensIn + t.tokensOut;
    const filmMin = Number(s.durationSec ?? 0) / 60;
    const usdPerMin = t.status === "done" && filmMin > 0 ? Math.round((t.costUsd / filmMin) * 1000) / 1000 : null;
    const firstValid = firsts.length ? firsts.filter((c) => c.validSvg).length / firsts.length : null;
    const checks = {
      done: t.status === "done",
      allRendered: Number(s.rendered) === Number(s.shots) && Number(s.shots) > 0,
      wall: wallSec <= ACCEPTANCE.wallSec,
      hardWall: wallSec <= ACCEPTANCE.hardWallSec && tokens <= ACCEPTANCE.capShare * capTokens,
      gates: Number(s.gateFailures ?? 0) <= ACCEPTANCE.gateFailures,
      firstCallValid: firstValid !== null && firstValid >= ACCEPTANCE.firstCallValid,
      critic: Number(s.criticAfter ?? 0) >= ACCEPTANCE.critic,
      cost: usdPerMin !== null && usdPerMin <= ACCEPTANCE.usdPerMin,
    };
    rows.push({
      projectId: pid,
      runId,
      language: t.language,
      models: t.models,
      status: t.status,
      shots: s.shots,
      rendered: s.rendered,
      firstPassOk: s.firstPassOk,
      wallSec,
      tokens,
      capShare: Math.round((tokens / capTokens) * 1000) / 1000,
      gateFailures: s.gateFailures,
      gateFailShots: s.gateFailShots,
      artistFirstCallValidSvg: firstValid === null ? null : Math.round(firstValid * 1000) / 1000,
      artistCallsValidSvg: calls.length ? Math.round((calls.filter((c) => c.validSvg).length / calls.length) * 1000) / 1000 : null,
      artistCalls: calls.length,
      criticBefore: s.criticBefore,
      criticAfter: s.criticAfter,
      costUsd: Math.round(t.costUsd * 1e5) / 1e5,
      filmSec: s.durationSec,
      usdPerMin,
      checks,
      pass: Object.values(checks).every(Boolean),
    });
  }
  mkdirSync("docs/hackathon/evidence/successors", { recursive: true });
  const file = `docs/hackathon/evidence/successors/acceptance-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), base, capTokens, bar: ACCEPTANCE, rows }, null, 2) + "\n");
  console.log("| run | lang | status | rendered | first pass | wall s | tokens (cap %) | gate fails | Artist 1st-call valid SVG | critic before → after | $ | $/finished min | pass |");
  console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of rows)
    console.log(
      `| ${r.runId} | ${r.language} | ${r.status} | ${r.rendered}/${r.shots} | ${r.firstPassOk}/${r.shots} | ${r.wallSec} | ${r.tokens} (${Math.round(r.capShare * 100)} %) | ${r.gateFailures} | ${r.artistFirstCallValidSvg === null ? "—" : `${Math.round(r.artistFirstCallValidSvg * 100)} %`} | ${r.criticBefore ?? "—"} → ${r.criticAfter ?? "—"} | ${r.costUsd} | ${r.usdPerMin ?? "—"} | ${r.pass ? "✅" : `❌ ${Object.entries(r.checks).filter(([, v]) => !v).map(([k]) => k).join(", ")}`} |`,
    );
  console.log("wrote", file);
}

if (process.argv[1]?.endsWith("acceptance.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
