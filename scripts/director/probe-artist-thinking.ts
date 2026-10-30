/**
 * A/B of the Artist's reasoning on Nemotron-3.5-Super-VL (D96): the same
 * real artist prompt (a shot of a finished local run, rebuilt with the
 * production artistSystem/artistUser) sent with the model's default reasoning
 * and with `enable_thinking=false`. Records completion tokens, latency,
 * finish reason and whether the reply holds an ```svg fragment that passes
 * `sanitizeSvg`. Needs NEBIUS_API_KEY and a local run in the dev database.
 *   npx tsx scripts/director/probe-artist-thinking.ts <runId> <shot> [<shot>…]
 * Writes docs/hackathon/evidence/probe-artist-thinking-<timestamp>.json.
 */
import "./env";
import { mkdirSync, writeFileSync } from "node:fs";
import { prisma } from "@/lib/db";
import { NemotronProvider } from "@/lib/providers/nemotronProvider";
import { artistSystem, artistUser } from "@/lib/services/director/prompts";
import { LOGICAL_CANVAS, sanitizeSvg } from "@/lib/services/svgRenderer";
import type { Plan } from "@/lib/services/director/schemas";
import { appendLedger, assertSpendUnder } from "./ledger";

const MODEL = "nvidia/Nemotron-3.5-Super-VL";

async function main() {
  const [runId, ...shotArgs] = process.argv.slice(2);
  const key = process.env.NEBIUS_API_KEY;
  if (!key || !runId || !shotArgs.length) {
    console.error("usage: probe-artist-thinking.ts <runId> <shot> [<shot>…]  (needs NEBIUS_API_KEY)");
    process.exit(2);
  }
  assertSpendUnder();
  const run = await prisma.directorRun.findUniqueOrThrow({ where: { id: runId }, include: { project: true } });
  const plan = JSON.parse(run.bible ?? "null") as Plan;
  const symbols = [...(run.library ?? "").matchAll(/<symbol[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);
  const canvas = LOGICAL_CANVAS[run.project.aspectRatio];
  const p = new NemotronProvider({ apiKey: key, baseUrl: process.env.NEBIUS_BASE_URL });
  const results: Record<string, unknown>[] = [];
  for (const n of shotArgs.map(Number)) {
    const shot = plan.shots[n - 1];
    const system = artistSystem(canvas, run.style);
    const user = artistUser({ plan, shot, index: n, symbols, canvas });
    for (const thinking of [undefined, false] as const) {
      const t0 = Date.now();
      const r = await p.chat([{ role: "system", content: system }, { role: "user", content: user }], { model: MODEL, maxTokens: 12000, temperature: 0.5, ...(thinking !== undefined && { thinking }) });
      appendLedger({ script: "probe-artist-thinking", label: `shot${n}:thinking=${thinking ?? "default"}`, model: MODEL, tokensIn: r.usage.promptTokens, tokensOut: r.usage.completionTokens, costUsd: r.costUsd });
      const svg = /```svg\s*([\s\S]*?)```/.exec(r.text)?.[1] ?? null;
      let sanitized: string | null = null;
      if (svg) {
        try {
          sanitizeSvg(svg, "frame");
          sanitized = "ok";
        } catch (e) {
          sanitized = e instanceof Error ? e.message.slice(0, 160) : String(e);
        }
      }
      const row = { shot: n, thinking: thinking ?? "default", ms: Date.now() - t0, usage: r.usage, finishReason: r.finishReason, contentChars: r.text.length, svgFragment: Boolean(svg), sanitize: sanitized, costUsd: r.costUsd };
      results.push(row);
      console.log(JSON.stringify(row));
    }
  }
  mkdirSync("docs/hackathon/evidence", { recursive: true });
  const out = `docs/hackathon/evidence/probe-artist-thinking-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), model: MODEL, runId, results }, null, 2) + "\n");
  console.log("wrote", out);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
