import { afterAll, beforeAll, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { budgetFromEnv, operatorTokenCap, runCeiling } from "@/lib/services/director/budget";
import { demoConfig, isOperatorRequest, OPERATOR_HEADER } from "@/lib/services/demoMode";
import { resetHealthCache, runHealthChecks } from "@/lib/services/health";

/** O10 (owner, 2026-10-11): operator runs get their own per-run token cap; public and judge runs keep theirs. */
const OPERATOR = "operator-passcode-long-enough-0123456789";
const JUDGE = "judge-pass";
const env = { DEMO_MODE: "true", DEMO_PASSCODE: JUDGE, DEMO_OPERATOR_PASSCODE: OPERATOR, DIRECTOR_MAX_TOKENS_PER_RUN: "500000", DIRECTOR_MAX_TOKENS_PER_RUN_OPERATOR: "800000" };
const req = (headers: Record<string, string>) => new Request("https://studio.example/api/projects/p/director", { method: "POST", headers });

describe("operator per-run token cap", () => {
  it("reads DIRECTOR_MAX_TOKENS_PER_RUN_OPERATOR, never below the public cap, and defaults to the public cap", () => {
    expect(budgetFromEnv(env).maxTokens).toBe(500_000);
    expect(operatorTokenCap(env)).toBe(800_000);
    expect(operatorTokenCap({ DIRECTOR_MAX_TOKENS_PER_RUN: "500000" })).toBe(500_000);
    expect(operatorTokenCap({ DIRECTOR_MAX_TOKENS_PER_RUN: "500000", DIRECTOR_MAX_TOKENS_PER_RUN_OPERATOR: "100000" })).toBe(500_000);
    expect(operatorTokenCap({ DIRECTOR_MAX_TOKENS_PER_RUN: "500000", DIRECTOR_MAX_TOKENS_PER_RUN_OPERATOR: "nonsense" })).toBe(500_000);
  });

  it("only the operator passcode in the operator header raises a run's ceiling (judges, no header, a wrong one: public cap)", () => {
    const cfg = demoConfig(env);
    const pub = budgetFromEnv(env);
    expect(isOperatorRequest(req({ [OPERATOR_HEADER]: OPERATOR }), cfg)).toBe(true);
    for (const h of [{}, { [OPERATOR_HEADER]: JUDGE }, { [OPERATOR_HEADER]: `${OPERATOR}x` }, { [OPERATOR_HEADER]: "" }]) expect(isOperatorRequest(req(h), cfg)).toBe(false);
    // no operator passcode configured on the server: nobody is an operator
    expect(isOperatorRequest(req({ [OPERATOR_HEADER]: OPERATOR }), demoConfig({ ...env, DEMO_OPERATOR_PASSCODE: "" }))).toBe(false);
    expect(runCeiling(pub, true, env).maxTokens).toBe(800_000);
    expect(runCeiling(pub, false, env)).toBe(pub);
    // every other limit of the ceiling is unchanged for an operator
    const op = runCeiling(pub, true, env);
    expect({ ...op, maxTokens: pub.maxTokens }).toEqual(pub);
  });
});

describe("/api/health reports both caps", () => {
  let storage: string;
  beforeAll(async () => {
    storage = await fs.mkdtemp(path.join(os.tmpdir(), "health-caps-"));
    process.env.STORAGE_ROOT = storage;
  });
  afterAll(async () => fs.rm(storage, { recursive: true, force: true }));

  it("shows the public and the operator per-run token caps, and never the operator passcode", async () => {
    resetHealthCache();
    const r = await runHealthChecks({ env: { ...env, AI_PROVIDER: "mock" }, binaryVersion: (c) => `${c} 1.0` });
    expect(r.runCaps).toEqual({ publicTokensPerRun: 500_000, operatorTokensPerRun: 800_000 });
    expect(r.checks.runCaps).toEqual({ status: "ok", detail: "per-run token cap: public 500,000 · operator 800,000" });
    expect(JSON.stringify(r)).not.toContain(OPERATOR);
  });
});
