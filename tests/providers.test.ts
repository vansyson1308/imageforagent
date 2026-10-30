import { describe, expect, it } from "vitest";
import { NemotronProvider, stripReasoning } from "@/lib/providers/nemotronProvider";
import { MockLlmProvider } from "@/lib/providers/mockLlmProvider";
import { configuredModels, resolveAgainstCatalog, DEFAULT_MODELS, MODEL_TUNING, requestTuning, VISION_FALLBACKS } from "@/lib/providers";
import { JUDGE_MODELS } from "@/lib/services/evalJudges";
import { LlmError } from "@/lib/providers/types";
import { costOf, EXACT_PRICES, priceOf, priceOverrides } from "@/lib/providers/pricing";

// No network: every test injects a fake fetch.
type Req = { url: string; init: RequestInit; body: Record<string, unknown> };

function fakeFetch(responses: Array<(req: Req) => Response | Promise<Response>>) {
  const requests: Req[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const req: Req = { url: String(url), init: init ?? {}, body: init?.body ? JSON.parse(String(init.body)) : {} };
    requests.push(req);
    const next = responses.shift();
    if (!next) throw new Error("no more fake responses");
    return next(req);
  }) as typeof fetch;
  return { impl, requests };
}

const ok = (content: string, usage = { prompt_tokens: 100, completion_tokens: 50 }) => () =>
  new Response(JSON.stringify({ model: "served-model", choices: [{ message: { content }, finish_reason: "stop" }], usage }), { status: 200 });
const status = (code: number, body = "{}", headers: Record<string, string> = {}) => () => new Response(body, { status: code, headers });

const noSleep = async () => {};

describe("NemotronProvider", () => {
  it("posts an OpenAI-compatible chat request with bearer auth, reasoning toggle and json_schema", async () => {
    const { impl, requests } = fakeFetch([ok('{"a":1}')]);
    const p = new NemotronProvider({ apiKey: "k-test", baseUrl: "https://tf.example/v1/", fetchImpl: impl, sleep: noSleep });
    const r = await p.chat([{ role: "system", content: "sys" }, { role: "user", content: "hi" }], {
      model: "nvidia/nemotron-3-super-120b-a12b",
      responseFormat: { type: "json_schema", name: "x", schema: { type: "object" } },
      thinking: false,
      temperature: 0.2,
      maxTokens: 500,
    });
    expect(requests[0].url).toBe("https://tf.example/v1/chat/completions");
    expect((requests[0].init.headers as Record<string, string>).Authorization).toBe("Bearer k-test");
    expect(requests[0].body).toMatchObject({
      model: "nvidia/nemotron-3-super-120b-a12b",
      temperature: 0.2,
      max_tokens: 500,
      chat_template_kwargs: { enable_thinking: false },
      response_format: { type: "json_schema", json_schema: { name: "x", schema: { type: "object" }, strict: true } },
    });
    expect(r.text).toBe('{"a":1}');
    expect(r.model).toBe("served-model");
    expect(r.usage).toEqual({ promptTokens: 100, completionTokens: 50 });
    expect(r.attempts).toBe(1);
    expect(r.costUsd).toBeCloseTo((100 * 0.3 + 50 * 0.9) / 1e6, 10);
  });

  it("sends frequency_penalty only when asked (model-keyed tuning, D96)", async () => {
    const { impl, requests } = fakeFetch([ok("a"), ok("b")]);
    const p = new NemotronProvider({ apiKey: "k", fetchImpl: impl, sleep: noSleep });
    await p.chat([{ role: "user", content: "x" }], { model: "m", frequencyPenalty: 0.3, thinking: false });
    await p.chat([{ role: "user", content: "x" }], { model: "m" });
    expect(requests[0].body).toMatchObject({ frequency_penalty: 0.3, chat_template_kwargs: { enable_thinking: false } });
    expect(requests[1].body).not.toHaveProperty("frequency_penalty");
    expect(requests[1].body).not.toHaveProperty("chat_template_kwargs");
    expect(requestTuning("nvidia/Nemotron-3.5-Super-VL", "artist")).toEqual({ thinking: false, frequencyPenalty: 0.3 });
    expect(requestTuning("NVIDIA/nemotron-3.5-super-vl", "cast")).toEqual({ thinking: false, frequencyPenalty: 0.3 });
    expect(requestTuning("nvidia/Nemotron-3.5-Super-VL", "critic")).toEqual({});
    expect(requestTuning("nvidia/Nemotron-3_5-Lightning", "editor")).toEqual({});
    // the Ultra fallback Artist: reasoning off, no penalty; Ultra as the Director is untouched
    expect(requestTuning("nvidia/Nemotron-3-Ultra-550b-a55b", "artist")).toEqual({ thinking: false });
    expect(requestTuning("nvidia/Nemotron-3-Ultra-550b-a55b", "cast")).toEqual({ thinking: false });
    expect(requestTuning("nvidia/Nemotron-3-Ultra-550b-a55b", "director")).toEqual({});
    expect(requestTuning("nvidia/Nemotron-3_5-Lightning", "artist")).toEqual({});
    expect(Object.keys(MODEL_TUNING)).toEqual(["nvidia/Nemotron-3.5-Super-VL", "nvidia/Nemotron-3-Ultra-550b-a55b"]);
  });

  it("sends images as image_url content parts and rejects non-data URIs", async () => {
    const { impl, requests } = fakeFetch([ok("fine")]);
    const p = new NemotronProvider({ apiKey: "k", fetchImpl: impl, sleep: noSleep });
    const img = "data:image/png;base64,iVBORw0KGgo=";
    await p.chat([{ role: "user", content: "look", images: [img] }], { model: "vision" });
    expect((requests[0].body.messages as unknown[])[0]).toEqual({
      role: "user",
      content: [{ type: "text", text: "look" }, { type: "image_url", image_url: { url: img } }],
    });
    await expect(p.chat([{ role: "user", content: "x", images: ["https://evil.example/a.png"] }], { model: "v" })).rejects.toMatchObject({
      kind: "bad_request",
    });
  });

  it("falls back from json_schema to json_object on 400 and remembers the model", async () => {
    const { impl, requests } = fakeFetch([status(400, '{"error":"response_format json_schema unsupported"}'), ok("{}"), ok("{}")]);
    const p = new NemotronProvider({ apiKey: "k", fetchImpl: impl, sleep: noSleep });
    const fmt = { type: "json_schema", name: "n", schema: {} } as const;
    const r1 = await p.chat([{ role: "user", content: "a" }], { model: "m", responseFormat: fmt });
    expect(r1.formatFallback).toBe(true);
    expect(requests[1].body.response_format).toEqual({ type: "json_object" });
    const r2 = await p.chat([{ role: "user", content: "b" }], { model: "m", responseFormat: fmt });
    expect(r2.formatFallback).toBe(true);
    expect(requests[2].body.response_format).toEqual({ type: "json_object" }); // straight to fallback
  });

  it("retries 429/5xx with backoff (Retry-After honoured) and counts attempts", async () => {
    const waits: number[] = [];
    const { impl } = fakeFetch([status(429, "", { "retry-after": "2" }), status(503), ok("done")]);
    const p = new NemotronProvider({ apiKey: "k", fetchImpl: impl, sleep: async (ms) => void waits.push(ms) });
    const r = await p.chat([{ role: "user", content: "x" }], { model: "m" });
    expect(r.text).toBe("done");
    expect(r.attempts).toBe(3);
    expect(waits[0]).toBe(2000);
    expect(waits[1]).toBeGreaterThanOrEqual(2000); // 1000·2^1 + jitter
  });

  it("gives up after maxRetries and does not retry auth errors", async () => {
    const { impl } = fakeFetch([status(500), status(500), status(500)]);
    const p = new NemotronProvider({ apiKey: "k", fetchImpl: impl, sleep: noSleep, maxRetries: 2 });
    await expect(p.chat([{ role: "user", content: "x" }], { model: "m" })).rejects.toMatchObject({ kind: "server", status: 500 });
    const auth = fakeFetch([status(401)]);
    const p2 = new NemotronProvider({ apiKey: "k", fetchImpl: auth.impl, sleep: noSleep });
    await expect(p2.chat([{ role: "user", content: "x" }], { model: "m" })).rejects.toMatchObject({ kind: "auth" });
    expect(auth.requests).toHaveLength(1);
  });

  it("times out a hung request, retries, and honours the caller's abort signal", async () => {
    const hang = (req: Req) =>
      new Promise<Response>((_, reject) => req.init.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    const { impl } = fakeFetch([hang, ok("late but fine")]);
    const p = new NemotronProvider({ apiKey: "k", fetchImpl: impl, sleep: noSleep });
    const r = await p.chat([{ role: "user", content: "x" }], { model: "m", timeoutMs: 20 });
    expect(r.attempts).toBe(2);

    const ctrl = new AbortController();
    const slow = fakeFetch([hang]);
    const p2 = new NemotronProvider({ apiKey: "k", fetchImpl: slow.impl, sleep: noSleep });
    const pending = p2.chat([{ role: "user", content: "x" }], { model: "m", signal: ctrl.signal });
    ctrl.abort();
    await expect(pending).rejects.toMatchObject({ kind: "aborted" });
  });

  it("strips inline reasoning and estimates usage when the provider omits it", async () => {
    const { impl } = fakeFetch([
      () => new Response(JSON.stringify({ choices: [{ message: { content: "<think>hmm</think>\n{\"ok\":true}" } }] }), { status: 200 }),
    ]);
    const p = new NemotronProvider({ apiKey: "k", fetchImpl: impl, sleep: noSleep });
    const r = await p.chat([{ role: "user", content: "x".repeat(400) }], { model: "m" });
    expect(r.text).toBe('{"ok":true}');
    expect(r.usage.promptTokens).toBeGreaterThan(90);
    expect(stripReasoning("a</think>b")).toBe("b");
  });

  it("lists models from GET /models", async () => {
    const { impl, requests } = fakeFetch([() => new Response(JSON.stringify({ data: [{ id: "a" }, { id: "b" }] }), { status: 200 })]);
    const p = new NemotronProvider({ apiKey: "k", baseUrl: "https://x/v1", fetchImpl: impl });
    expect(await p.listModels()).toEqual(["a", "b"]);
    expect(requests[0].url).toBe("https://x/v1/models");
  });

  it("requires an API key", () => {
    expect(() => new NemotronProvider({ apiKey: "" })).toThrow(LlmError);
  });
});

describe("MockLlmProvider", () => {
  it("replays a queue, records calls, serialises objects, throws scripted errors", async () => {
    const m = new MockLlmProvider([{ a: 1 }, "plain", new LlmError("rate_limit", "slow down", 429)]);
    expect((await m.chat([{ role: "user", content: "1" }], { model: "mock-a" })).text).toBe('{"a":1}');
    expect((await m.chat([{ role: "user", content: "2" }], { model: "mock-a" })).text).toBe("plain");
    await expect(m.chat([{ role: "user", content: "3" }], { model: "mock-a" })).rejects.toMatchObject({ kind: "rate_limit" });
    expect(m.calls).toHaveLength(3);
    expect(m.calls[1].messages[0].content).toBe("2");
  });
});

describe("pricing", () => {
  it("prices by family, honours overrides, stays conservative for unknown models", () => {
    expect(priceOf("nvidia/Nemotron-3-Ultra-550b-a55b")).toEqual([0.6, 2.4]);
    expect(priceOf("nvidia/Nemotron-3-Nano-Omni-30B")).toEqual([0.1, 0.4]);
    expect(priceOf("nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B")).toEqual([0.06, 0.24]);
    // the successors (D96): exact catalog prices, never a family guess
    expect(priceOf("nvidia/Nemotron-3.5-Super-VL")).toEqual([0.3, 0.9]);
    expect(priceOf("nvidia/Nemotron-3_5-Lightning")).toEqual([0.06, 0.24]);
    expect(EXACT_PRICES["nvidia/Nemotron-3.5-Super-VL"]).toEqual([0.3, 0.9]);
    expect(priceOf("nvidia/Nemotron-3.5-Super-VL", { "nvidia/Nemotron-3.5-Super-VL": [1, 1] })).toEqual([1, 1]);
    expect(priceOf("who-knows")).toEqual([0.6, 2.4]);
    expect(priceOf("mock-fast")).toEqual([0, 0]);
    const o = priceOverrides({ NEBIUS_PRICES_JSON: '{"x":[1,2],"bad":[1]}' } as unknown as NodeJS.ProcessEnv);
    expect(o).toEqual({ x: [1, 2] });
    expect(costOf("x", 1_000_000, 500_000, o)).toBe(2);
  });
});

describe("crew models", () => {
  it("reads env overrides and defaults", () => {
    expect(configuredModels({} as unknown as NodeJS.ProcessEnv)).toEqual(DEFAULT_MODELS);
    expect(configuredModels({ NEMOTRON_MID_MODEL: " m " } as unknown as unknown as NodeJS.ProcessEnv).mid).toBe("m");
  });

  it("resolves against the live catalog: exact, case-insensitive, tier pattern, missing vision → text critic", () => {
    const listed = ["nvidia/nemotron-3-ultra-550b-a55b", "nvidia/nemotron-3-super-120b-a12b", "nvidia/Nemotron-3-Nano-30B", "meta/llama"];
    const r = resolveAgainstCatalog({ ...DEFAULT_MODELS, mid: "nvidia/Nemotron-3-Super-120b-a12b", fast: "nvidia/gone" }, listed);
    expect(r.models.strong).toBe("nvidia/nemotron-3-ultra-550b-a55b");
    expect(r.models.mid).toBe("nvidia/nemotron-3-super-120b-a12b");
    expect(r.models.fast).toBe("nvidia/Nemotron-3-Nano-30B");
    expect(r.visionAvailable).toBe(false);
    expect(r.notes.join(" ")).toMatch(/TEXT mode/);
    const withOmni = resolveAgainstCatalog(DEFAULT_MODELS, [...listed, "nvidia/Nemotron-3-Nano-Omni-30B-A3B"]);
    expect(withOmni.models.vision).toBe("nvidia/Nemotron-3-Nano-Omni-30B-A3B");
    expect(withOmni.models.fast).toBe("nvidia/Nemotron-3-Nano-30B");
  });

  it("no NVIDIA VLM: an open VLM looks (labelled), never the eval judge; an NVIDIA VLM always wins (D33)", () => {
    const crew = ["nvidia/Nemotron-3-Ultra-550b-a55b", "nvidia/nemotron-3-super-120b-a12b", "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B"];
    const old = { ...DEFAULT_MODELS, vision: "" };
    const open = resolveAgainstCatalog(old, [...crew, "google/gemma-3-27b-it", "openbmb/MiniCPM-V-4_5"], { visionFallbacks: ["openbmb/MiniCPM-V-4_5"] });
    expect(open.models.vision).toBe("openbmb/MiniCPM-V-4_5");
    expect(open.visionAvailable).toBe(true);
    expect(open.notes.join(" ")).toMatch(/vision critic: openbmb\/MiniCPM-V-4_5/);
    const judgeOnly = resolveAgainstCatalog(old, [...crew, "google/gemma-3-27b-it", "moonshotai/Kimi-K3"]);
    expect(judgeOnly.models.vision).toBe("");
    const nv = resolveAgainstCatalog(old, [...crew, "openbmb/MiniCPM-V-4_5", "nvidia/Nemotron-Nano-12B-v2-VL"]);
    expect(nv.models.vision).toBe("nvidia/Nemotron-Nano-12B-v2-VL");
  });

  it("pins the 2026-11-09 successors (D96): every tier resolves exactly against the post-retirement catalog", () => {
    // owner + QC 2026-10-31: Ultra plans AND draws, Super-VL looks, Lightning scores/edits
    expect(DEFAULT_MODELS).toEqual({ strong: "nvidia/Nemotron-3-Ultra-550b-a55b", mid: "nvidia/Nemotron-3-Ultra-550b-a55b", fast: "nvidia/Nemotron-3_5-Lightning", vision: "nvidia/Nemotron-3.5-Super-VL" });
    expect(VISION_FALLBACKS).toEqual(["nvidia/Nemotron-3.5-Super-VL"]);
    const after = ["nvidia/Nemotron-3-Ultra-550b-a55b", "nvidia/Nemotron-3.5-Super-VL", "nvidia/Nemotron-3_5-Lightning", "google/gemma-3-27b-it", "moonshotai/Kimi-K3"];
    const r = resolveAgainstCatalog(configuredModels({} as unknown as NodeJS.ProcessEnv), after);
    expect(r.models).toEqual(DEFAULT_MODELS);
    expect(r.notes).toEqual([]);
    expect(r.visionAvailable).toBe(true);
    // an old id left in NEMOTRON_*_MODEL after the retirement falls back to a listed model of the same tier
    const stale = resolveAgainstCatalog({ ...DEFAULT_MODELS, mid: "nvidia/nemotron-3-super-120b-a12b", fast: "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B", vision: "openbmb/MiniCPM-V-4_5" }, after);
    expect(stale.models).toEqual({ ...DEFAULT_MODELS, mid: "nvidia/Nemotron-3.5-Super-VL" });
    expect(stale.notes).toHaveLength(3);
    // the critic's eyes are never an eval judge
    expect(JUDGE_MODELS).not.toContain(r.models.vision);
  });
});
