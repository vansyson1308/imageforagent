/**
 * List the Token Factory catalog and show how the crew tiers resolve.
 *   NEBIUS_API_KEY=… npm run director:models
 * Writes docs/hackathon/evidence/models-<date>.json (ids only, no secrets).
 */
import "./env";
import { mkdirSync, writeFileSync } from "node:fs";
import { NemotronProvider } from "@/lib/providers/nemotronProvider";
import { configuredModels, resolveAgainstCatalog } from "@/lib/providers";

async function main() {
  const key = process.env.NEBIUS_API_KEY;
  if (!key) {
    console.error("NEBIUS_API_KEY is not set — see docs/hackathon/BLOCKERS.md B1.");
    process.exit(2);
  }
  const p = new NemotronProvider({ apiKey: key, baseUrl: process.env.NEBIUS_BASE_URL });
  const listed = await p.listModels();
  const nemotron = listed.filter((id) => /nemotron/i.test(id));
  const resolved = resolveAgainstCatalog(configuredModels(), listed);
  console.log(`catalog: ${listed.length} models, ${nemotron.length} Nemotron:`);
  for (const id of nemotron) console.log("  ", id);
  console.log("crew:", resolved.models);
  for (const n of resolved.notes) console.log("note:", n);
  mkdirSync("docs/hackathon/evidence", { recursive: true });
  const out = `docs/hackathon/evidence/models-${new Date().toISOString().slice(0, 10)}.json`;
  writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), baseUrl: process.env.NEBIUS_BASE_URL ?? "default", listed, nemotron, resolved }, null, 2));
  console.log("wrote", out);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
