import { describe, expect, it } from "vitest";
import {
  add3,
  centroid3,
  composePlacement4,
  cross3,
  dot3,
  faceNormal,
  IDENTITY_4,
  length3,
  mul4,
  normalize3,
  rotationX4,
  rotationY4,
  rotationZ4,
  scaling4,
  sub3,
  transformDirection,
  transformPoint,
  translation4,
} from "@/lib/services/construct/math3d";
import type { Vec3 } from "@/lib/services/construct/types";

function expectVec3(actual: Vec3, expected: Vec3, digits = 10): void {
  expect(actual[0]).toBeCloseTo(expected[0], digits);
  expect(actual[1]).toBeCloseTo(expected[1], digits);
  expect(actual[2]).toBeCloseTo(expected[2], digits);
}

describe("Vec3", () => {
  it("add/sub/dot/cross/length/normalize", () => {
    expect(add3([1, 2, 3], [4, 5, 6])).toEqual([5, 7, 9]);
    expect(sub3([4, 5, 6], [1, 2, 3])).toEqual([3, 3, 3]);
    expect(dot3([1, 0, 0], [0, 1, 0])).toBe(0);
    expect(cross3([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]); // right-handed
    expect(length3([3, 4, 0])).toBe(5);
    expectVec3(normalize3([0, 0, 5]), [0, 0, 1]);
    expect(normalize3([0, 0, 0])).toEqual([0, 0, 0]);
  });
});

describe("Mat4 — golden values", () => {
  it("identity không đổi điểm", () => {
    expect(transformPoint(IDENTITY_4, [1, 2, 3])).toEqual([1, 2, 3]);
  });

  it("rotationY(90): x-axis → −z (right-handed)", () => {
    expectVec3(transformPoint(rotationY4(90), [1, 0, 0]), [0, 0, -1]);
    expectVec3(transformPoint(rotationY4(90), [0, 0, 1]), [1, 0, 0]);
  });

  it("rotationX(90): y-axis → +z", () => {
    expectVec3(transformPoint(rotationX4(90), [0, 1, 0]), [0, 0, 1]);
  });

  it("rotationZ(90): x-axis → +y", () => {
    expectVec3(transformPoint(rotationZ4(90), [1, 0, 0]), [0, 1, 0]);
  });

  it("mul4(a,b): b áp dụng trước — translate(scale(p))", () => {
    const m = mul4(translation4([10, 0, 0]), scaling4([2, 2, 2]));
    expect(transformPoint(m, [1, 1, 1])).toEqual([12, 2, 2]);
  });

  it("transformDirection bỏ qua translate", () => {
    const m = translation4([100, 100, 100]);
    expect(transformDirection(m, [0, 1, 0])).toEqual([0, 1, 0]);
  });

  it("composePlacement4: scale→rotate→translate", () => {
    // Điểm (1,0,0) scale 2 → (2,0,0), xoay Y 90° → (0,0,−2), đặt tại (5,5,5)
    const m = composePlacement4([5, 5, 5], [0, 90, 0], 2);
    expectVec3(transformPoint(m, [1, 0, 0]), [5, 5, 3]);
  });
});

describe("faceNormal (Newell) + centroid", () => {
  it("mặt đáy XZ ngược chiều kim đồng hồ nhìn từ trên (+y) → normal +y", () => {
    // CCW nhìn từ +y (từ trên nhìn xuống, x phải z "xuống"): đi ngược z trước
    const n = faceNormal([
      [0, 0, 0],
      [0, 0, 1],
      [1, 0, 1],
      [1, 0, 0],
    ]);
    expectVec3(n, [0, 1, 0]);
  });

  it("mặt trước XY (CCW nhìn từ +z) → normal +z", () => {
    const n = faceNormal([
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
    ]);
    expectVec3(n, [0, 0, 1]);
  });

  it("centroid trung bình đỉnh", () => {
    expectVec3(centroid3([[0, 0, 0], [2, 0, 0], [2, 2, 0], [0, 2, 0]]), [1, 1, 0]);
  });
});
