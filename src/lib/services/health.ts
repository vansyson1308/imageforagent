import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { configuredModels, createNemotronProvider } from "@/lib/providers";
import type { NemotronProvider } from "@/lib/providers/nemotronProvider";
import { storageRoot } from "@/lib/services/storage";
import { demoConfig } from "@/lib/services/demoMode";
import { tokensToday } from "@/lib/services/demoGuard";
import { ttsEngines } from "@/lib/services/tts";

/**
 * Public health report (`GET /api/health`) for judges, the daily GitHub
 * Actions check and the owner. It never contains a secret: keys are reported
 * as present/absent, the Token Factory check is the free `GET /v1/models`,
 * and no paid model or Tavily call is made.
 *
 * Status per check: "ok" · "fail" (broken; makes the report fail) · "off"
 * (an optional feature that is not configured, e.g. no Tavily key).
 */

export type CheckStatus = "ok" | "fail" | "off";

export interface HealthCheck {
  readonly status: CheckStatus;
  readonly detail: string;
  readonly ms?: number;
}

export interface HealthReport {
  readonly ok: boolean;
  readonly version: string;
  readonly commit: string | null;
  readonly time: string;
  readonly checks: Record<string, HealthCheck>;
  readonly demo: { enabled: boolean; dailyTokenBudget: number; tokensToday: number; maxConcurrentRuns: number; retentionHours: number } | null;
  readonly catalog: { models: string[]; crew: Record<string, boolean> } | null;
}

export interface HealthDeps {
  readonly env: Record<string, string | undefined>;
  readonly listModels?: () => Promise<string[]>;
  readonly binaryVersion?: (cmd: string, args: string[]) => string | null;
  readonly now?: () => Date;
}

/** First line of `cmd args` stdout, or null when the binary is missing. */
export function binaryVersion(cmd: string, args: string[]): string | null {
  try {
    const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 8000 });
    if (r.status !== 0) return null;
    return (r.stdout || r.stderr).split("\n")[0].trim().slice(0, 120) || cmd;
  } catch {
    return null;
  }
}

const timed = async (fn: () => Promise<HealthCheck>): Promise<HealthCheck> => {
  const t0 = Date.now();
  try {
    const r = await fn();
    return { ...r, ms: Date.now() - t0 };
  } catch (e) {
    return { status: "fail", detail: e instanceof Error ? e.message.slice(0, 200) : String(e), ms: Date.now() - t0 };
  }
};

let catalogCache: { at: number; models: string[] } | null = null;

export async function runHealthChecks(deps: HealthDeps): Promise<HealthReport> {
  const env = deps.env as NodeJS.ProcessEnv;
  const ver = deps.binaryVersion ?? binaryVersion;
  const now = deps.now?.() ?? new Date();
  const checks: Record<string, HealthCheck> = {};

  checks.database = await timed(async () => {
    await prisma.$queryRawUnsafe("SELECT 1");
    const projects = await prisma.project.count();
    return { status: "ok", detail: `SQLite reachable (${projects} projects)` };
  });

  checks.storage = await timed(async () => {
    const dir = path.join(storageRoot(), ".health");
    await fs.mkdir(dir, { recursive: true });
    const f = path.join(dir, `probe-${process.pid}.txt`);
    await fs.writeFile(f, now.toISOString());
    await fs.rm(f, { force: true });
    return { status: "ok", detail: "writable" };
  });

  const ffmpeg = ver("ffmpeg", ["-version"]);
  checks.ffmpeg = ffmpeg ? { status: "ok", detail: ffmpeg } : { status: "fail", detail: "ffmpeg not found (the film assembler needs it)" };

  const engines = ttsEngines();
  checks.tts = engines.length ? { status: "ok", detail: engines.join(", ") } : { status: "fail", detail: "no local TTS engine (espeak-ng / Piper) found" };

  let catalog: HealthReport["catalog"] = null;
  if (env.LLM_PROVIDER === "mock") {
    checks.tokenFactory = { status: "off", detail: "mock provider (scripted crew, no model calls)" };
  } else if (!env.NEBIUS_API_KEY) {
    checks.tokenFactory = { status: "fail", detail: "NEBIUS_API_KEY is not set: the Director is unavailable" };
  } else {
    checks.tokenFactory = await timed(async () => {
      const t = Date.now();
      if (!catalogCache || t - catalogCache.at > 5 * 60_000) {
        const list = deps.listModels ?? (() => (createNemotronProvider(env) as NemotronProvider).listModels(AbortSignal.timeout(8000)));
        catalogCache = { at: t, models: await list() };
      }
      const crew = configuredModels(env);
      const lower = new Set(catalogCache.models.map((m) => m.toLowerCase()));
      const listed = Object.fromEntries((["strong", "mid", "fast", "vision"] as const).filter((k) => crew[k]).map((k) => [k, lower.has(crew[k].toLowerCase())]));
      catalog = { models: [...catalogCache.models].sort(), crew: listed };
      const missing = Object.entries(listed).filter(([, v]) => !v).map(([k]) => k);
      return missing.length
        ? { status: "fail", detail: `GET /v1/models OK (${catalogCache.models.length} models) but crew model(s) not listed: ${missing.join(", ")}` }
        : { status: "ok", detail: `GET /v1/models OK (${catalogCache.models.length} models, crew listed)` };
    });
  }

  checks.tavily = env.TAVILY_API_KEY ? { status: "ok", detail: "key present (no call made)" } : { status: "off", detail: "no TAVILY_API_KEY: research is not enabled on this server" };

  const cfg = demoConfig(env);
  let demo: HealthReport["demo"] = null;
  if (cfg.enabled) {
    const used = await tokensToday(now).catch(() => 0);
    demo = { enabled: true, dailyTokenBudget: cfg.dailyTokenBudget, tokensToday: used, maxConcurrentRuns: cfg.maxConcurrentRuns, retentionHours: cfg.retentionHours };
    checks.demoBudget =
      used >= cfg.dailyTokenBudget
        ? { status: "fail", detail: `today's demo token budget is used up (${used} / ${cfg.dailyTokenBudget})` }
        : { status: "ok", detail: `${Math.round((used / cfg.dailyTokenBudget) * 100)}% of today's token budget used` };
    checks.passcode = cfg.passcode ? { status: "ok", detail: "set" } : { status: "fail", detail: "DEMO_MODE is on but DEMO_PASSCODE is empty: nobody can unlock" };
  }

  const ok = Object.values(checks).every((c) => c.status !== "fail");
  return {
    ok,
    version: APP_VERSION,
    commit: env.RAILWAY_GIT_COMMIT_SHA ?? env.GIT_COMMIT_SHA ?? env.SOURCE_COMMIT ?? null,
    time: now.toISOString(),
    checks,
    demo,
    catalog,
  };
}

/** Kept in sync with package.json by a test. */
export const APP_VERSION = "2.0.0";

/** Test hook. */
export function resetHealthCache(): void {
  catalogCache = null;
}
