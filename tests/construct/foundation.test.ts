import { describe, expect, it } from "vitest";
import {
  FillRule,
  PathBoolean,
  PathBooleanOperation,
  pathFromPathData,
  pathToPathData,
} from "path-bool";
import { CONSTRUCT_LIMITS, MAX_SVG_BYTES } from "@/lib/config/limits";
import { AppError } from "@/lib/services/apiError";

describe("foundation — path-bool chạy được trong môi trường test (Node ESM)", () => {
  const SQUARE_A = "M 0 0 L 100 0 L 100 100 L 0 100 Z";
  const SQUARE_B = "M 50 50 L 150 50 L 150 150 L 50 150 Z";

  function op(operation: PathBooleanOperation): string[] {
    const bool = new PathBoolean([
      { path: pathFromPathData(SQUARE_A), fillRule: FillRule.NonZero },
      { path: pathFromPathData(SQUARE_B), fillRule: FillRule.NonZero },
    ]);
    return bool.get(operation).map((p) => pathToPathData(p));
  }

  it("union 2 hình vuông chồng nhau → 1 path 8 đỉnh (hình chữ L kép)", () => {
    const result = op(PathBooleanOperation.Union);
    expect(result).toHaveLength(1);
    // 8 lệnh L + 1 M (path đóng bằng cách lặp điểm đầu)
    expect(result[0].match(/L /g)?.length).toBe(8);
  });

  it("difference → phần A trừ overlap (6 đỉnh)", () => {
    const result = op(PathBooleanOperation.Difference);
    expect(result).toHaveLength(1);
    expect(result[0].match(/L /g)?.length).toBe(6);
  });

  it("intersection → đúng ô vuông overlap 50×50", () => {
    const result = op(PathBooleanOperation.Intersection);
    expect(result).toHaveLength(1);
    const nums = result[0].match(/[\d.]+/g)!.map(Number);
    expect(Math.min(...nums)).toBe(50);
    expect(Math.max(...nums)).toBe(100);
  });

  it("deterministic: hai lần chạy cho cùng string", () => {
    expect(op(PathBooleanOperation.Union)).toEqual(op(PathBooleanOperation.Union));
  });
});

describe("foundation — CONSTRUCT_LIMITS", () => {
  it("output cap phải dưới MAX_SVG_BYTES để agent còn ghép thêm nội dung", () => {
    expect(CONSTRUCT_LIMITS.maxOutputBytes).toBeLessThan(MAX_SVG_BYTES);
  });

  it("mọi limit đều dương và defaultSegments ≤ maxSegments", () => {
    for (const value of Object.values(CONSTRUCT_LIMITS)) {
      expect(value).toBeGreaterThan(0);
    }
    expect(CONSTRUCT_LIMITS.defaultSegments).toBeLessThanOrEqual(CONSTRUCT_LIMITS.maxSegments);
  });
});

describe("foundation — error code CONSTRUCTION_INVALID", () => {
  it("mặc định status 422 và giữ hint", () => {
    const err = new AppError("CONSTRUCTION_INVALID", "Spec invalid.", "Fix the spec.");
    expect(err.status).toBe(422);
    expect(err.hint).toBe("Fix the spec.");
  });
});
