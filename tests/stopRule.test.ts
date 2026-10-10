import { describe, expect, it } from "vitest";
import { DEMO_STOP_RULE, stopRuleOverRuns, stopRuleVerdict } from "@/lib/services/director/stopRule";

describe("demo stop rule (D37)", () => {
  it("per run: $ per finished minute and wall minutes per 8 shots", () => {
    expect(DEMO_STOP_RULE).toEqual({ maxUsdPerMin: 0.4, maxWallMinPer8Shots: 8 });
    // v1 crew median-ish: $0.08 for a 40 s film in 4 minutes, 8 shots → fine
    expect(stopRuleVerdict({ usd: 0.08, filmSec: 40, wallSec: 240, shots: 8 })).toEqual({ usdPerMin: 0.12, wallPer8ShotsMin: 4, tripped: false, reasons: [] });
    const costly = stopRuleVerdict({ usd: 0.3, filmSec: 30, wallSec: 600, shots: 4 });
    expect(costly.usdPerMin).toBe(0.6);
    expect(costly.wallPer8ShotsMin).toBe(20); // 10 min for 4 shots = 20 min per 8
    expect(costly.reasons).toEqual(["$0.6/finished min > $0.4", "20 min per 8 shots > 8"]);
    expect(stopRuleVerdict({ usd: 0.1, filmSec: 0, wallSec: 0, shots: 0 })).toEqual({ usdPerMin: null, wallPer8ShotsMin: null, tripped: false, reasons: [] });
  });

  it("over runs: the median of the last 3, one outlier doesn't flip it, fewer than 2 runs never trips", () => {
    const ok = { usd: 0.08, filmSec: 40, wallSec: 240, shots: 8 };
    const slow = { usd: 0.08, filmSec: 40, wallSec: 1200, shots: 8 };
    expect(stopRuleOverRuns([slow]).tripped).toBe(false);
    expect(stopRuleOverRuns([slow, ok, ok]).tripped).toBe(false);
    const v = stopRuleOverRuns([slow, slow, ok, ok]);
    expect(v.tripped).toBe(true);
    expect(v.runs).toBe(3);
    expect(v.reasons[0]).toMatch(/median 20 min per 8 shots > 8 over the last 3 demo runs/);
  });
});
