/**
 * Live probe of the successors of the models Token Factory retires on
 * 2026-11-09 (D96): Nemotron-3.5-Super-VL (mid + vision) and
 * Nemotron-3_5-Lightning (fast). Small calls only, each one in the spend
 * ledger. Needs NEBIUS_API_KEY; never runs in `npm test`.
 *   npm run director:probe-successors
 * Per model: catalog listing (GET /v1/models, plus its verbose entry when the
 * API returns one), strict json_schema through the provider, the
 * enable_thinking toggle (false vs true on the same small sum, raw response so
 * reasoning tokens are visible), and for Super-VL an image (red-disc probe,
 * as the bench's judge probe) with json_schema. Writes
 * docs/hackathon/evidence/probe-successors-<timestamp>.json.
 */
import "./env";
import { mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { NemotronProvider, DEFAULT_BASE_URL } from "@/lib/providers/nemotronProvider";
import { costOf } from "@/lib/providers/pricing";
import { appendLedger, assertSpendUnder } from "./ledger";

const SUPER_VL = "nvidia/Nemotron-3.5-Super-VL";
const LIGHTNING = "nvidia/Nemotron-3_5-Lightning";
const RETIRED = ["nvidia/nemotron-3-super-120b-a12b", "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B", "openbmb/MiniCPM-V-4_5"];
const UNAFFECTED = ["nvidia/Nemotron-3-Ultra-550b-a55b", "google/gemma-3-27b-it", "moonshotai/Kimi-K3"];

const SUM = 'A train leaves at 09:47 and arrives at 11:15 the same day. How many minutes is the trip? Answer ONLY JSON {"minutes": <integer>}.';

async function main() {
  const key = process.env.NEBIUS_API_KEY;
  if (!key) {
    console.error("NEBIUS_API_KEY is not set.");
    process.exit(2);
  }
  console.log(`spend so far (ledger): $${assertSpendUnder().toFixed(4)}`);
  const base = (process.env.NEBIUS_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const p = new NemotronProvider({ apiKey: key, baseUrl: base });
  const results: Record<string, unknown>[] = [];
  let spent = 0;
  const ledger = (label: string, model: string, tin: number, tout: number) => {
    const c = costOf(model, tin, tout);
    spent += c;
    appendLedger({ script: "probe-successors", label, model, tokensIn: tin, tokensOut: tout, costUsd: c });
    return c;
  };

  // 1 · catalog (free)
  const listed = await p.listModels();
  const catalog: Record<string, unknown> = {
    count: listed.length,
    successors: Object.fromEntries([SUPER_VL, LIGHTNING].map((m) => [m, listed.includes(m)])),
    unaffected: Object.fromEntries(UNAFFECTED.map((m) => [m, listed.includes(m)])),
    retiredStillListed: Object.fromEntries(RETIRED.map((m) => [m, listed.includes(m)])),
  };
  try {
    const res = await fetch(`${base}/models?verbose=true`, { headers: { Authorization: `Bearer ${key}` } });
    const body = (await res.json()) as { data?: Array<Record<string, unknown>> };
    catalog.verbose = Object.fromEntries((body.data ?? []).filter((m) => m.id === SUPER_VL || m.id === LIGHTNING).map((m) => [String(m.id), m]));
  } catch (e) {
    catalog.verbose = `unavailable: ${e instanceof Error ? e.message : String(e)}`;
  }
  console.log("catalog", JSON.stringify(catalog.successors));

  const run = async (model: string, label: string, fn: () => Promise<Record<string, unknown>>) => {
    const t0 = Date.now();
    try {
      const out = await fn();
      results.push({ model, label, ok: out.ok !== false, ms: Date.now() - t0, ...out });
      console.log(`${out.ok === false ? "✘" : "✔"} ${model} ${label} (${Date.now() - t0} ms)`);
    } catch (e) {
      results.push({ model, label, ok: false, ms: Date.now() - t0, error: e instanceof Error ? e.message.slice(0, 400) : String(e) });
      console.log(`✘ ${model} ${label}: ${e instanceof Error ? e.message.slice(0, 200) : e}`);
    }
  };

  const disc = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#ffffff"/><circle cx="128" cy="128" r="90" fill="#d01010"/></svg>')).png().toBuffer();
  const discUri = `data:image/png;base64,${disc.toString("base64")}`;

  for (const model of [LIGHTNING, SUPER_VL]) {
    // 2 · strict json_schema through the provider (the crew's path), thinking off
    await run(model, "json_schema", async () => {
      const r = await p.chat([{ role: "user", content: 'Reply with JSON {"ok":true,"role":"<one word describing yourself>"} and nothing else.' }], {
        model,
        thinking: false,
        temperature: 0,
        maxTokens: 200,
        responseFormat: { type: "json_schema", name: "probe", schema: { type: "object", properties: { ok: { type: "boolean" }, role: { type: "string" } }, required: ["ok", "role"], additionalProperties: false } },
      });
      const costUsd = ledger(`${model}:json_schema`, model, r.usage.promptTokens, r.usage.completionTokens);
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(r.text);
      } catch {
        // recorded as not valid below
      }
      const valid = Boolean(parsed && typeof parsed === "object" && (parsed as { ok?: unknown }).ok === true && typeof (parsed as { role?: unknown }).role === "string");
      return { ok: valid && !r.formatFallback, text: r.text, valid, formatFallback: r.formatFallback, finishReason: r.finishReason, usage: r.usage, latencyMs: r.latencyMs, costUsd };
    });

    // 3 · enable_thinking false vs true (raw body, so reasoning is visible before the provider strips it)
    for (const thinking of [false, true]) {
      await run(model, `thinking:${thinking}`, async () => {
        const t0 = Date.now();
        const res = await fetch(`${base}/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model, messages: [{ role: "user", content: SUM }], temperature: 0, max_tokens: 2000, chat_template_kwargs: { enable_thinking: thinking } }),
        });
        const raw = await res.text();
        if (!res.ok) return { ok: false, status: res.status, error: raw.slice(0, 300) };
        const j = JSON.parse(raw) as { choices?: Array<{ message?: { content?: string; reasoning_content?: string; reasoning?: string }; finish_reason?: string }>; usage?: { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: unknown } };
        const msg = j.choices?.[0]?.message ?? {};
        const content = typeof msg.content === "string" ? msg.content : "";
        const reasoning = msg.reasoning_content ?? msg.reasoning ?? "";
        const tin = j.usage?.prompt_tokens ?? 0;
        const tout = j.usage?.completion_tokens ?? 0;
        const costUsd = ledger(`${model}:thinking:${thinking}`, model, tin, tout);
        const answer = /"minutes"\s*:\s*(\d+)/.exec(content.replace(/<think>[\s\S]*?<\/think>/gi, ""))?.[1];
        return {
          ok: true,
          latencyMs: Date.now() - t0,
          usage: { promptTokens: tin, completionTokens: tout, details: j.usage?.completion_tokens_details ?? null },
          reasoningChars: reasoning.length,
          thinkTagInContent: /<think>|<\/think>/i.test(content),
          contentTail: content.slice(-160),
          answer: answer ? Number(answer) : null,
          correct: answer === "88",
          finishReason: j.choices?.[0]?.finish_reason ?? null,
          costUsd,
        };
      });
    }
  }

  // 4 · Super-VL sees: red disc, json_schema, thinking off (the critic's call shape)
  await run(SUPER_VL, "image:red-disc", async () => {
    const r = await p.chat([{ role: "user", content: 'What colour is the disc? Answer ONLY JSON {"color": "<one word>"}.', images: [discUri] }], {
      model: SUPER_VL,
      thinking: false,
      temperature: 0,
      maxTokens: 200,
      responseFormat: { type: "json_schema", name: "disc", schema: { type: "object", properties: { color: { type: "string" } }, required: ["color"], additionalProperties: false } },
    });
    const costUsd = ledger(`${SUPER_VL}:image:red-disc`, SUPER_VL, r.usage.promptTokens, r.usage.completionTokens);
    return { ok: /red/i.test(r.text), text: r.text, formatFallback: r.formatFallback, usage: r.usage, latencyMs: r.latencyMs, costUsd };
  });
  // Lightning is text-only on the catalog: an image must be refused, so the critic never routes images to it
  await run(LIGHTNING, "image:refused", async () => {
    try {
      const r = await p.chat([{ role: "user", content: 'What colour is the disc? Answer ONLY JSON {"color": "<one word>"}.', images: [discUri] }], { model: LIGHTNING, thinking: false, temperature: 0, maxTokens: 50 });
      const costUsd = ledger(`${LIGHTNING}:image`, LIGHTNING, r.usage.promptTokens, r.usage.completionTokens);
      return { ok: true, accepted: true, text: r.text, usage: r.usage, costUsd };
    } catch (e) {
      return { ok: true, accepted: false, error: e instanceof Error ? e.message.slice(0, 200) : String(e) };
    }
  });

  mkdirSync("docs/hackathon/evidence", { recursive: true });
  const out = `docs/hackathon/evidence/probe-successors-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), baseUrl: base, catalog, results, spentUsd: Math.round(spent * 1e6) / 1e6 }, null, 2) + "\n");
  console.log(`wrote ${out} · spent $${spent.toFixed(5)}`);
  if (results.some((r) => !r.ok)) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
