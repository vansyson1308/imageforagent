/**
 * Live smoke test: one call per crew tier + one rendered PNG sent to the
 * vision tier (Nano Omni). Needs NEBIUS_API_KEY and network access to the
 * Token Factory. Never runs in `npm test`.
 *   npm run director:smoke
 * Writes docs/hackathon/evidence/smoke-<timestamp>.json (prompts, outputs, usage, latency).
 */
import "./env";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { NemotronProvider } from "@/lib/providers/nemotronProvider";
import { configuredModels, resolveAgainstCatalog, type CrewModels } from "@/lib/providers";
import { renderArtwork } from "@/lib/services/svgRenderer";
import type { ChatResult, ModelTier } from "@/lib/providers/types";
import { appendLedger, assertSpendUnder } from "./ledger";

async function main() {
  const key = process.env.NEBIUS_API_KEY;
  if (!key) {
    console.error("NEBIUS_API_KEY is not set — see docs/hackathon/BLOCKERS.md B1.");
    process.exit(2);
  }
  console.log(`spend so far (ledger): $${assertSpendUnder().toFixed(4)}`);
  const p = new NemotronProvider({ apiKey: key, baseUrl: process.env.NEBIUS_BASE_URL });
  let models: CrewModels = configuredModels();
  let notes: string[] = [];
  try {
    const r = resolveAgainstCatalog(models, await p.listModels());
    models = r.models;
    notes = r.notes;
  } catch (e) {
    notes.push(`GET /models failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  const results: Record<string, unknown>[] = [];
  const run = async (tier: ModelTier, label: string, fn: () => Promise<unknown>) => {
    const t0 = Date.now();
    try {
      const out = await fn();
      const r = out as Partial<ChatResult>;
      if (r.usage) appendLedger({ script: "smoke", label: `${tier}:${label}`, model: String(r.model), tokensIn: r.usage.promptTokens, tokensOut: r.usage.completionTokens, costUsd: r.costUsd ?? 0 });
      results.push({ tier, label, model: models[tier], ok: true, ms: Date.now() - t0, out });
      console.log(`✔ ${tier} ${label} (${Date.now() - t0} ms)`);
    } catch (e) {
      results.push({ tier, label, model: models[tier], ok: false, ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) });
      console.log(`✘ ${tier} ${label}: ${e instanceof Error ? e.message : e}`);
    }
  };
  const ask = { role: "user" as const, content: 'Reply with JSON {"ok":true,"role":"<one word describing yourself>"} and nothing else.' };
  for (const tier of ["strong", "mid", "fast"] as const) {
    await run(tier, "json_schema", () =>
      p.chat([ask], {
        model: models[tier],
        thinking: false,
        maxTokens: 200,
        responseFormat: { type: "json_schema", name: "smoke", schema: { type: "object", properties: { ok: { type: "boolean" }, role: { type: "string" } }, required: ["ok", "role"] } },
      }),
    );
  }
  if (models.vision) {
    const svg = readFileSync("examples/frame-01.svg", "utf8");
    const defs = readFileSync("examples/defs.svg", "utf8");
    const png = await renderArtwork(defs, svg, "16:9", "1K");
    await run("vision", "image_input", () =>
      p.chat(
        [{ role: "user", content: "Describe this storyboard frame in one sentence, then rate its readability 0-10 as JSON {\"caption\":…,\"score\":…}.", images: [`data:image/png;base64,${png.toString("base64")}`] }],
        { model: models.vision, thinking: false, maxTokens: 300, responseFormat: { type: "json_object" } },
      ),
    );
  } else {
    results.push({ tier: "vision", ok: false, error: "no vision model resolved — text-critic fallback" });
  }
  mkdirSync("docs/hackathon/evidence", { recursive: true });
  const out = `docs/hackathon/evidence/smoke-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), models, notes, results }, null, 2));
  console.log("wrote", out);
  if (results.some((r) => !r.ok)) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
