/**
 * A/B of the Artist's request on Nemotron-3.5-Super-VL (D96): the same
 * real artist prompt (a shot of a finished local run, rebuilt with the
 * production artistSystem/artistUser) sent with the model's default reasoning,
 * with `enable_thinking=false`, and with sampling penalties. Records
 * completion/reasoning tokens, latency, finish reason and whether the reply
 * holds an ```svg fragment that passes `sanitizeSvg`. Needs NEBIUS_API_KEY and
 * a local run in the dev database.
 *   [VARIANTS=default,no-think] npx tsx scripts/director/probe-artist-thinking.ts <runId> <shot> [<shot>…]
 * Writes docs/hackathon/evidence/probe-artist-thinking-<timestamp>.json.
 */
import "./env";
import { mkdirSync, writeFileSync } from "node:fs";
import { prisma } from "@/lib/db";
import { DEFAULT_BASE_URL, stripReasoning } from "@/lib/providers/nemotronProvider";
import { costOf } from "@/lib/providers/pricing";
import { artistSystem, artistUser } from "@/lib/services/director/prompts";
import { LOGICAL_CANVAS, sanitizeSvg } from "@/lib/services/svgRenderer";
import type { Plan } from "@/lib/services/director/schemas";
import { appendLedger, assertSpendUnder } from "./ledger";

const MODEL = "nvidia/Nemotron-3.5-Super-VL";

/** Request variants (raw body, so sampling penalties can be tried); pick with VARIANTS=a,b. */
const VARIANTS: ReadonlyArray<{ readonly label: string; readonly body: Record<string, unknown> }> = [
  { label: "default", body: {} },
  { label: "no-think", body: { chat_template_kwargs: { enable_thinking: false } } },
  { label: "no-think+freq0.3", body: { chat_template_kwargs: { enable_thinking: false }, frequency_penalty: 0.3 } },
  { label: "no-think+rep1.1", body: { chat_template_kwargs: { enable_thinking: false }, repetition_penalty: 1.1 } },
];

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
  const base = (process.env.NEBIUS_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const variants = VARIANTS.filter((v) => !process.env.VARIANTS || process.env.VARIANTS.split(",").includes(v.label));
  const results: Record<string, unknown>[] = [];
  for (const n of shotArgs.map(Number)) {
    const shot = plan.shots[n - 1];
    const system = artistSystem(canvas, run.style);
    const user = artistUser({ plan, shot, index: n, symbols, canvas });
    for (const v of variants) {
      const t0 = Date.now();
      const body = { model: MODEL, messages: [{ role: "system", content: system }, { role: "user", content: user }], max_tokens: 12000, temperature: 0.5, ...v.body };
      const res = await fetch(`${base}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const raw = await res.text();
      if (!res.ok) {
        results.push({ shot: n, variant: v.label, ok: false, status: res.status, error: raw.slice(0, 300) });
        console.log(n, v.label, res.status, raw.slice(0, 200));
        continue;
      }
      const j = JSON.parse(raw) as { choices?: Array<{ message?: { content?: string }; finish_reason?: string }>; usage?: { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } } };
      const text = stripReasoning(j.choices?.[0]?.message?.content ?? "");
      const tin = j.usage?.prompt_tokens ?? 0;
      const tout = j.usage?.completion_tokens ?? 0;
      const costUsd = costOf(MODEL, tin, tout);
      appendLedger({ script: "probe-artist-thinking", label: `shot${n}:${v.label}`, model: MODEL, tokensIn: tin, tokensOut: tout, costUsd });
      const svg = /```svg\s*([\s\S]*?)```/.exec(text)?.[1] ?? null;
      let sanitized: string | null = null;
      if (svg) {
        try {
          sanitizeSvg(svg, "frame");
          sanitized = "ok";
        } catch (e) {
          sanitized = e instanceof Error ? e.message.slice(0, 160) : String(e);
        }
      }
      const row = { shot: n, variant: v.label, ms: Date.now() - t0, usage: { promptTokens: tin, completionTokens: tout, reasoningTokens: j.usage?.completion_tokens_details?.reasoning_tokens ?? null }, finishReason: j.choices?.[0]?.finish_reason ?? null, contentChars: text.length, contentTail: text.slice(-200), svgFragment: Boolean(svg), sanitize: sanitized, costUsd };
      results.push(row);
      console.log(JSON.stringify({ ...row, contentTail: undefined }));
    }
  }
  mkdirSync("docs/hackathon/evidence", { recursive: true });
  const out = `docs/hackathon/evidence/probe-artist-thinking-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), model: MODEL, runId, variants, results }, null, 2) + "\n");
  console.log("wrote", out);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
