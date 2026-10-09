import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { APP_VERSION, resetHealthCache, runHealthChecks } from "@/lib/services/health";
import { isPublicPath } from "@/lib/services/demoMode";
import pkg from "../package.json";

let storage: string;
beforeAll(async () => {
  storage = await fs.mkdtemp(path.join(os.tmpdir(), "health-"));
  process.env.STORAGE_ROOT = storage;
});
afterAll(async () => {
  await fs.rm(storage, { recursive: true, force: true });
});
beforeEach(() => resetHealthCache());

const SECRET_KEY = "nb-SECRET-should-never-appear";
const SECRET_PASS = "judge-pass-should-never-appear";
const SECRET_TAVILY = "tvly-SECRET-should-never-appear";
const tools = (cmd: string) => `${cmd} version 1.0`;
const crewCatalog = ["nvidia/Nemotron-3-Ultra-550b-a55b", "nvidia/nemotron-3-super-120b-a12b", "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B", "google/gemma-3-27b-it"];

describe("GET /api/health report", () => {
  it("is public, green with a reachable catalog, and never contains a secret", async () => {
    expect(isPublicPath("/api/health")).toBe(true);
    const r = await runHealthChecks({
      env: { NEBIUS_API_KEY: SECRET_KEY, TAVILY_API_KEY: SECRET_TAVILY, DEMO_MODE: "true", DEMO_PASSCODE: SECRET_PASS, RAILWAY_GIT_COMMIT_SHA: "abc123" },
      listModels: async () => crewCatalog,
      binaryVersion: tools,
    });
    const text = JSON.stringify(r);
    for (const s of [SECRET_KEY, SECRET_PASS, SECRET_TAVILY]) expect(text).not.toContain(s);
    expect(r.checks.database.status).toBe("ok");
    expect(r.checks.storage.status).toBe("ok");
    expect(r.checks.ffmpeg.status).toBe("ok");
    expect(r.checks.tokenFactory).toMatchObject({ status: "ok" });
    expect(r.checks.tavily.status).toBe("ok");
    expect(r.checks.passcode).toMatchObject({ status: "ok", detail: "set" });
    expect(r.catalog?.crew).toEqual({ strong: true, mid: true, fast: true });
    expect(r.commit).toBe("abc123");
    expect(r.version).toBe(pkg.version);
    expect(APP_VERSION).toBe(pkg.version);
  });

  it("fails loudly when the key is missing, the catalog is unreachable or a crew model vanished", async () => {
    const noKey = await runHealthChecks({ env: {}, binaryVersion: tools });
    expect(noKey.ok).toBe(false);
    expect(noKey.checks.tokenFactory.status).toBe("fail");
    expect(noKey.checks.tavily.status).toBe("off");

    const down = await runHealthChecks({ env: { NEBIUS_API_KEY: SECRET_KEY }, binaryVersion: tools, listModels: async () => Promise.reject(new Error("GET /models → 503")) });
    expect(down.ok).toBe(false);
    expect(down.checks.tokenFactory.detail).toContain("503");

    resetHealthCache();
    const gone = await runHealthChecks({ env: { NEBIUS_API_KEY: SECRET_KEY }, binaryVersion: tools, listModels: async () => crewCatalog.slice(1) });
    expect(gone.ok).toBe(false);
    expect(gone.checks.tokenFactory.detail).toContain("strong");

    const noFfmpeg = await runHealthChecks({ env: { LLM_PROVIDER: "mock" }, binaryVersion: () => null });
    expect(noFfmpeg.checks.ffmpeg.status).toBe("fail");
    expect(noFfmpeg.checks.tokenFactory.status).toBe("off");
  });

  it("reports an exhausted demo budget and an empty passcode as failures", async () => {
    const r = await runHealthChecks({ env: { LLM_PROVIDER: "mock", DEMO_MODE: "true", DEMO_PASSCODE: "", DEMO_DAILY_TOKEN_BUDGET: "1" }, binaryVersion: tools });
    expect(r.checks.passcode.status).toBe("fail");
    expect(r.demo?.dailyTokenBudget).toBe(1);
  });
});
