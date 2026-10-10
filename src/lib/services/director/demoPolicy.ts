import { prisma } from "@/lib/db";
import { stopRuleOverRuns, type RunCost } from "@/lib/services/director/stopRule";

export interface FloorPolicy {
  readonly enabled: boolean;
  /** why the floor redraw is off (null when on) */
  readonly reason: string | null;
  readonly verdict: ReturnType<typeof stopRuleOverRuns>;
}

/**
 * Demo mode's floor-redraw switch (D37): off when `DEMO_FLOOR_REDRAW=off`,
 * or when the median of the last finished demo crew runs breaks the stop
 * rule (> $0.40 per finished minute or > 8 min per 8 shots).
 */
export async function demoFloorPolicy(env: NodeJS.ProcessEnv = process.env): Promise<FloorPolicy> {
  const runs = await prisma.directorRun.findMany({
    where: { status: "done", project: { demoSession: { not: null } } },
    orderBy: { finishedAt: "desc" },
    take: 12,
    select: { summary: true, config: true },
  });
  const costs: RunCost[] = [];
  for (const r of runs) {
    try {
      const cfg = JSON.parse(r.config) as { profile?: string; critic?: boolean };
      const s = JSON.parse(r.summary ?? "null") as { costUsd?: number; durationSec?: number; wallMs?: number; shots?: number } | null;
      if (!s || (cfg.profile ?? "crew") !== "crew" || cfg.critic === false) continue;
      costs.push({ usd: Number(s.costUsd ?? 0), filmSec: Number(s.durationSec ?? 0), wallSec: Number(s.wallMs ?? 0) / 1000, shots: Number(s.shots ?? 0) });
    } catch {
      // a malformed row is skipped, never fatal
    }
  }
  const verdict = stopRuleOverRuns(costs);
  if (/^(off|false|0|no)$/i.test(env.DEMO_FLOOR_REDRAW?.trim() ?? "")) return { enabled: false, reason: "DEMO_FLOOR_REDRAW=off on this server", verdict };
  return { enabled: !verdict.tripped, reason: verdict.tripped ? `demo stop rule: ${verdict.reasons.join("; ")}` : null, verdict };
}
