import { prisma } from "@/lib/db";
import { AppError } from "@/lib/services/apiError";
import { removeDirQuiet } from "@/lib/services/storage";
import { logger } from "@/lib/services/logger";
import { BudgetExceededError } from "@/lib/services/director/budget";
import { demoConfig, demoSessionOf, type DemoConfig } from "@/lib/services/demoMode";

/**
 * DB-backed demo caps. There is no cron and no queue: cleanup runs
 * opportunistically when a demo project is created or a run starts.
 */

export function requireDemoSession(req: Request, cfg: DemoConfig = demoConfig()): string | null {
  if (!cfg.enabled) return null;
  const sid = demoSessionOf(req, cfg);
  if (!sid) throw new AppError("UNAUTHORIZED", "Demo passcode required.", "Open /unlock and enter the passcode from the submission's testing instructions.");
  return sid;
}

export async function assertProjectQuota(sid: string, cfg: DemoConfig = demoConfig()): Promise<void> {
  const n = await prisma.project.count({ where: { demoSession: sid } });
  if (n >= cfg.maxProjectsPerSession) {
    throw new AppError("QUOTA_EXCEEDED", `Demo sessions can create up to ${cfg.maxProjectsPerSession} projects.`, "Delete one of your demo projects, or watch the showcase films.");
  }
}

/** Delete demo projects older than the retention window (files included). */
export async function cleanupDemoProjects(cfg: DemoConfig = demoConfig(), now = Date.now()): Promise<number> {
  const cutoff = new Date(now - cfg.retentionHours * 3600_000);
  const old = await prisma.project.findMany({ where: { demoSession: { not: null }, createdAt: { lt: cutoff } }, select: { id: true } });
  for (const p of old) {
    await prisma.project.delete({ where: { id: p.id } }).catch(() => {});
    await removeDirQuiet(p.id);
  }
  if (old.length) logger.info({ removed: old.length }, "demo cleanup");
  return old.length;
}

/** Tokens spent today (UTC) across all Director runs (live runs update their totals per step). */
export async function tokensToday(now = new Date()): Promise<number> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const agg = await prisma.directorRun.aggregate({ where: { startedAt: { gte: start } }, _sum: { tokensIn: true, tokensOut: true } });
  return (agg._sum.tokensIn ?? 0) + (agg._sum.tokensOut ?? 0);
}

/**
 * Daily budget gate for BudgetTracker (synchronous): refreshed from the DB
 * at run start and advanced by the tokens this process spends.
 */
export async function dailyGate(cfg: DemoConfig = demoConfig()): Promise<{ gate: () => void; spend: (tokens: number) => void }> {
  let used = await tokensToday();
  if (used >= cfg.dailyTokenBudget) {
    throw new AppError("QUOTA_EXCEEDED", "Today's demo token budget is used up.", "Try again tomorrow (UTC), or watch the showcase films.");
  }
  return {
    gate: () => {
      if (used >= cfg.dailyTokenBudget) throw new BudgetExceededError("daily", "The demo's daily token budget was reached during this run.");
    },
    spend: (tokens: number) => {
      used += tokens;
    },
  };
}
