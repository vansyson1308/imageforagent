import { describe, expect, it } from "vitest";
import {
  closeWithZ,
  countPathCommands,
  normalizeSelfUnion,
  quantizePathData,
  runBoolean,
} from "@/lib/services/construct/pathBoolean";
import {
  circlePath,
  placementToAffine,
  rectPath,
  segmentsToPathData,
  starPath,
  transformSegments,
} from "@/lib/services/construct/geometry2d";
import { AppError } from "@/lib/services/apiError";
import { CONSTRUCT_LIMITS } from "@/lib/config/limits";

const P = 2;
const at = (x: number, y: number) => placementToAffine({ at: [x, y] });
const rect = (w: number, h: number, x = 0, y = 0) =>
  segmentsToPathData(transformSegments(rectPath(w, h), at(x, y)), P);
const circle = (r: number, x = 0, y = 0) =>
  segmentsToPathData(transformSegments(circlePath(r), at(x, y)), P);

/**
 * Điểm có nằm trong path không — ray casting even-odd trên từng subpath
 * riêng biệt (không nối cạnh ma giữa các ring; hố khoét = ring chẵn-lẻ).
 * Đa giác lấy từ on-curve points (M/L + endpoint của C) — đủ thô cho các
 * assertion chọn điểm nằm sâu trong/ngoài.
 */
function pointInPathData(d: string, px: number, py: number): boolean {
  const rings: Array<Array<readonly [number, number]>> = [];
  for (const sub of d.split(/(?=M )/).map((s) => s.trim()).filter(Boolean)) {
    const ring: Array<readonly [number, number]> = [];
    for (const cmd of sub.matchAll(/([MLC]) ((?:-?[\d.]+[ ,]*)+)/g)) {
      const nums = cmd[2].trim().split(/[\s,]+/).map(Number);
      // Với C chỉ lấy cặp cuối (điểm on-curve); M/L lấy cặp duy nhất
      ring.push([nums[nums.length - 2], nums[nums.length - 1]]);
    }
    if (ring.length >= 3) rings.push(ring);
  }
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

describe("runBoolean — 4 phép trên hình thật", () => {
  it("union rect+circle: điểm của cả hai đều nằm trong", () => {
    const { d, isEmpty } = runBoolean("union", [rect(100, 100), circle(60, 80, 0)], P, "test");
    expect(isEmpty).toBe(false);
    expect(pointInPathData(d, -40, 0)).toBe(true); // trong rect
    expect(pointInPathData(d, 130, 0)).toBe(true); // trong circle
    expect(pointInPathData(d, 200, 200)).toBe(false);
  });

  it("difference rect−circle: vùng circle bị khoét", () => {
    const { d } = runBoolean("difference", [rect(100, 100), circle(30, 50, 0)], P, "test");
    expect(pointInPathData(d, -40, 0)).toBe(true); // xa lỗ → còn
    expect(pointInPathData(d, 45, 0)).toBe(false); // trong lỗ → mất
  });

  it("intersection: chỉ vùng overlap", () => {
    const { d } = runBoolean("intersection", [rect(100, 100, 0, 0), rect(100, 100, 60, 0)], P, "t");
    expect(pointInPathData(d, 30, 0)).toBe(true);
    expect(pointInPathData(d, -30, 0)).toBe(false);
    expect(pointInPathData(d, 90, 0)).toBe(false);
  });

  it("exclusion: overlap bị loại, hai phần rời còn lại", () => {
    const { d } = runBoolean("exclusion", [rect(100, 100, 0, 0), rect(100, 100, 60, 0)], P, "t");
    expect(pointInPathData(d, 30, 0)).toBe(false); // vùng phủ 2 lần
    expect(pointInPathData(d, -30, 0)).toBe(true);
    expect(pointInPathData(d, 100, 0)).toBe(true);
  });

  it("disjoint difference: giữ nguyên A", () => {
    const { d, isEmpty } = runBoolean("difference", [rect(10, 10), rect(10, 10, 100, 100)], P, "t");
    expect(isEmpty).toBe(false);
    expect(pointInPathData(d, 0, 0)).toBe(true);
  });

  it("contained intersection: B nằm trọn trong A → ra B", () => {
    const { d } = runBoolean("intersection", [rect(100, 100), rect(20, 20)], P, "t");
    expect(pointInPathData(d, 0, 0)).toBe(true);
    expect(pointInPathData(d, 30, 30)).toBe(false);
  });

  it("kết quả rỗng (intersection 2 hình rời) → isEmpty", () => {
    const result = runBoolean("intersection", [rect(10, 10), rect(10, 10, 100, 0)], P, "t");
    expect(result.isEmpty).toBe(true);
    expect(result.d).toBe("");
  });

  it("multi-operand difference: A trừ union(B, C)", () => {
    const { d } = runBoolean(
      "difference",
      [rect(200, 100), circle(20, -60, 0), circle(20, 60, 0)],
      P,
      "t",
    );
    expect(pointInPathData(d, 0, 0)).toBe(true);
    expect(pointInPathData(d, -60, 0)).toBe(false);
    expect(pointInPathData(d, 60, 0)).toBe(false);
  });

  it("deterministic: 2 lần chạy → string giống hệt", () => {
    const run = () => runBoolean("union", [rect(100, 100), circle(60, 80, 0), starPathData()], P, "t").d;
    expect(run()).toBe(run());
  });

  function starPathData(): string {
    return segmentsToPathData(transformSegments(starPath(6, 70, 30), at(-70, 20)), P);
  }
});

describe("runBoolean — limits + lỗi", () => {
  it("quá maxBooleanOperands → CONSTRUCTION_INVALID kèm hint", () => {
    const operands = Array.from({ length: CONSTRUCT_LIMITS.maxBooleanOperands + 1 }, (_, i) =>
      rect(10, 10, i * 20, 0),
    );
    try {
      runBoolean("union", operands, P, "big");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("CONSTRUCTION_INVALID");
      expect((err as AppError).message).toContain("big");
      expect((err as AppError).hint).toBeTruthy();
    }
  });

  it("quá maxBooleanInputSegments → CONSTRUCTION_INVALID", () => {
    // 2 operand hợp lệ nhưng tổng segment vượt trần
    const segs = Math.ceil(CONSTRUCT_LIMITS.maxBooleanInputSegments / 2) + 5;
    const bigPath =
      "M 0 0 " + Array.from({ length: segs }, (_, i) => `L ${i} ${i % 2}`).join(" ") + " Z";
    expect(() => runBoolean("union", [bigPath, bigPath], P, "seg")).toThrowError(
      /input segments/,
    );
  });

  it("path rác → CONSTRUCTION_INVALID (không leak exception thô)", () => {
    try {
      runBoolean("union", ["M banana", "M 0 0 L 1 0 L 1 1 Z"], P, "junk");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("CONSTRUCTION_INVALID");
    }
  });
});

describe("helpers", () => {
  it("quantizePathData ép 12 số lẻ về precision", () => {
    expect(quantizePathData("M 1.000000000000 -0.000000000001 L 2.5 3.14159", 2)).toBe(
      "M 1 0 L 2.5 3.14",
    );
  });

  it("closeWithZ thay 'L điểm-đầu' cuối bằng Z, từng subpath", () => {
    expect(closeWithZ("M 0 0 L 10 0 L 10 10 L 0 0")).toBe("M 0 0 L 10 0 L 10 10 Z");
    expect(closeWithZ("M 0 0 L 5 0 L 0 0 M 20 20 L 30 20 L 20 20")).toBe(
      "M 0 0 L 5 0 Z M 20 20 L 30 20 Z",
    );
  });

  it("countPathCommands đếm đúng", () => {
    expect(countPathCommands("M 0 0 L 1 1 C 1 1 2 2 3 3 Z")).toBe(4);
  });

  it("normalizeSelfUnion nắn path tự cắt (bowtie) thành outline nonzero", () => {
    const bowtie = "M 0 0 L 100 100 L 100 0 L 0 100 Z";
    const normalized = normalizeSelfUnion(bowtie, P, "bowtie");
    expect(normalized).not.toBe("");
    expect(normalized).not.toBe(bowtie);
  });
});
