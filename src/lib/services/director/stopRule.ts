/**
 * Demo stop rule (owner QC, D37): on the hosted demo a crew film must stay at
 * or under $0.40 per finished minute and 8 minutes of wall time per 8 shots.
 * When recent demo runs break either bound, the floor redraw (D33), the most
 * expensive optional step, is switched off in demo mode, and the run
 * records why. Pure: callers pass the measurements.
 */
export const DEMO_STOP_RULE = { maxUsdPerMin: 0.4, maxWallMinPer8Shots: 8 } as const;

export interface RunCost {
  /** estimated USD of the run */
  readonly usd: number;
  /** finished film length in seconds */
  readonly filmSec: number;
  /** server wall time of the run in seconds */
  readonly wallSec: number;
  /** shots planned */
  readonly shots: number;
}

export interface StopVerdict {
  readonly usdPerMin: number | null;
  readonly wallPer8ShotsMin: number | null;
  readonly tripped: boolean;
  readonly reasons: string[];
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

export function stopRuleVerdict(c: RunCost): StopVerdict {
  const usdPerMin = c.filmSec > 0 ? r3((c.usd / c.filmSec) * 60) : null;
  const wallPer8ShotsMin = c.shots > 0 ? r3((c.wallSec / 60) * (8 / c.shots)) : null;
  const reasons: string[] = [];
  if (usdPerMin !== null && usdPerMin > DEMO_STOP_RULE.maxUsdPerMin) reasons.push(`$${usdPerMin}/finished min > $${DEMO_STOP_RULE.maxUsdPerMin}`);
  if (wallPer8ShotsMin !== null && wallPer8ShotsMin > DEMO_STOP_RULE.maxWallMinPer8Shots) reasons.push(`${wallPer8ShotsMin} min per 8 shots > ${DEMO_STOP_RULE.maxWallMinPer8Shots}`);
  return { usdPerMin, wallPer8ShotsMin, tripped: reasons.length > 0, reasons };
}

/**
 * The rule over recent runs: the median of the last runs (newest first),
 * so one slow outlier doesn't switch the floor off and one fast run
 * doesn't switch it back on. Fewer than `min` runs → not tripped.
 */
export function stopRuleOverRuns(runs: readonly RunCost[], min = 2, window = 3): StopVerdict & { runs: number } {
  const recent = runs.slice(0, window);
  if (recent.length < min) return { usdPerMin: null, wallPer8ShotsMin: null, tripped: false, reasons: [], runs: recent.length };
  const median = (xs: number[]) => {
    const v = [...xs].sort((a, b) => a - b);
    return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
  };
  const verdicts = recent.map(stopRuleVerdict);
  const per = verdicts.map((v) => v.usdPerMin).filter((x): x is number => x !== null);
  const wall = verdicts.map((v) => v.wallPer8ShotsMin).filter((x): x is number => x !== null);
  const usdPerMin = per.length ? r3(median(per)) : null;
  const wallPer8ShotsMin = wall.length ? r3(median(wall)) : null;
  const reasons: string[] = [];
  if (usdPerMin !== null && usdPerMin > DEMO_STOP_RULE.maxUsdPerMin) reasons.push(`median $${usdPerMin}/finished min > $${DEMO_STOP_RULE.maxUsdPerMin} over the last ${recent.length} demo runs`);
  if (wallPer8ShotsMin !== null && wallPer8ShotsMin > DEMO_STOP_RULE.maxWallMinPer8Shots) reasons.push(`median ${wallPer8ShotsMin} min per 8 shots > ${DEMO_STOP_RULE.maxWallMinPer8Shots} over the last ${recent.length} demo runs`);
  return { usdPerMin, wallPer8ShotsMin, tripped: reasons.length > 0, reasons, runs: recent.length };
}
