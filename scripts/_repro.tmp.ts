import "./director/env";
import { writeFileSync } from "node:fs";
import { StudioClient, type SseEvent } from "./director/client";
import { appendLedger } from "./director/ledger";

(async () => {
  const [cfg, pidOut] = process.argv.slice(2);
  const p = { language: "en", shots: 5, story: "An old lighthouse keeper's lamp breaks during a storm. A flock of fireflies gathers at the top of the tower and glows until a fishing boat finds the harbour. At dawn the keeper finds one firefly resting on the cold lamp." };
  const c = new StudioClient({ base: "https://studio-production-049c.up.railway.app", passcode: process.env.DEMO_PASSCODE });
  await c.unlock();
  const pid = await c.createProject(`repro ${cfg} en-lighthouse`);
  const body = cfg === "A" ? { profile: "super-only", critic: false, research: false } : { profile: "crew", critic: true, research: false };
  let summary: Record<string, unknown> | null = null;
  const runId = await c.direct(pid, { story: p.story, language: p.language, style: "flat", maxShots: p.shots, ...body }, (e: SseEvent) => {
    if (e.type === "plan") console.log("PLAN", (e.shots as unknown[]).length, "shots");
    if (e.type === "step") { const s = e.step as { role: string; action: string; shotIndex: number | null; error?: string | null; outputSummary?: string | null }; console.log(s.role, s.action, s.shotIndex ?? "", s.error ? "ERR " + s.error.slice(0, 220) : (s.outputSummary ?? "").slice(0, 160)); }
    if (e.type === "done") summary = e.summary as Record<string, unknown>;
  });
  const trace = await c.json<{ costUsd: number }>("GET", `/api/projects/${pid}/director/runs/${runId}`);
  appendLedger({ script: "bench-repro", label: `${cfg}:en-lighthouse:${runId}`, model: "crew", tokensIn: 0, tokensOut: 0, costUsd: trace.costUsd });
  writeFileSync(pidOut, JSON.stringify({ pid, runId, summary, trace }, null, 1));
  console.log("SUMMARY", JSON.stringify(summary));
})();
