import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as judge } from "@/app/api/eval/judge/route";
import { JUDGE_MODELS, V1_JUDGE } from "@/lib/services/evalJudges";

/**
 * Operator-only judge route (D48): the benchmark's judges run on the server,
 * where the provider key lives. Without the operator passcode the route does
 * not exist; only judge models can be called; no network in tests.
 */
const OP = "operator-passcode-long-enough-0001";
const IMG = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
const req = (body: unknown, pass?: string) => new Request("http://t/api/eval/judge", { method: "POST", headers: { "content-type": "application/json", ...(pass !== undefined && { "x-operator-passcode": pass }) }, body: JSON.stringify(body) });

describe("POST /api/eval/judge (D48)", () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ model: V1_JUDGE, choices: [{ message: { content: '{"score": 7, "reason": "ok"}' } }], usage: { prompt_tokens: 900, completion_tokens: 20 } }), { status: 200, headers: { "content-type": "application/json" } }));
  beforeEach(() => {
    process.env.DEMO_OPERATOR_PASSCODE = OP;
    process.env.NEBIUS_API_KEY = "test-key-not-real";
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    delete process.env.DEMO_OPERATOR_PASSCODE;
    delete process.env.NEBIUS_API_KEY;
    vi.unstubAllGlobals();
    fetchMock.mockClear();
  });

  it("does not exist without the operator passcode (none configured, missing, wrong)", async () => {
    const body = { model: V1_JUDGE, prompt: "Shot 1", image: IMG };
    expect((await judge(req(body))).status).toBe(404);
    expect((await judge(req(body, "wrong-passcode-wrong-passcode-00"))).status).toBe(404);
    delete process.env.DEMO_OPERATOR_PASSCODE;
    expect((await judge(req(body, OP))).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls only judge models, with one data-URI image", async () => {
    for (const model of ["nvidia/nemotron-3-super-120b-a12b", "openbmb/MiniCPM-V-4_5"]) {
      expect((await judge(req({ model, prompt: "Shot 1", image: IMG }, OP))).status).toBe(400);
    }
    expect((await judge(req({ model: V1_JUDGE, prompt: "Shot 1", image: "https://example.com/x.jpg" }, OP))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JUDGE_MODELS).not.toContain("openbmb/MiniCPM-V-4_5");
  });

  it("returns the judge's reply with usage and cost for the client's ledger", async () => {
    const res = await judge(req({ model: V1_JUDGE, prompt: "Shot 1 (Wide shot): a kite", image: IMG }, OP));
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out).toMatchObject({ text: '{"score": 7, "reason": "ok"}', usage: { promptTokens: 900, completionTokens: 20 } });
    expect(typeof out.costUsd).toBe("number");
    const sent = JSON.parse(String((fetchMock.mock.calls[0] as unknown[])[1] && ((fetchMock.mock.calls[0] as unknown[])[1] as RequestInit).body));
    expect(sent.model).toBe(V1_JUDGE);
    expect(JSON.stringify(sent.messages)).toContain(IMG);
    expect(JSON.stringify(out)).not.toContain("test-key-not-real");
  });
});
