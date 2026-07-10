import { describe, expect, it } from "vitest";
import {
  applyAffine,
  circlePath,
  ellipsePath,
  flattenToContours,
  fmt,
  linePath,
  mulAffine,
  placementToAffine,
  polygonPath,
  rectPath,
  regularPolygonPath,
  segmentsToPathData,
  signedArea,
  starPath,
  transformSegments,
} from "@/lib/services/construct/geometry2d";

describe("fmt — formatter deterministic duy nhất", () => {
  it("không '-0', không exponent, cắt 0 thừa", () => {
    expect(fmt(-0.0001, 2)).toBe("0");
    expect(fmt(-0, 2)).toBe("0");
    expect(fmt(1.5, 2)).toBe("1.5");
    expect(fmt(1.506, 2)).toBe("1.51");
    expect(fmt(100, 2)).toBe("100");
    expect(fmt(1e-7, 2)).toBe("0");
    expect(fmt(123456.789, 0)).toBe("123457");
  });
});

describe("primitives → path data", () => {
  it("rect không bo góc: 4 đỉnh quanh tâm (0,0)", () => {
    expect(segmentsToPathData(rectPath(100, 60), 1)).toBe(
      "M -50 -30 L 50 -30 L 50 30 L -50 30 Z",
    );
  });

  it("rect bo góc rx clamp về min(w,h)/2", () => {
    const d = segmentsToPathData(rectPath(100, 60, 999), 1);
    expect(d).toContain("C"); // có cung
    expect(d).toContain("M -20 -30"); // r clamp = 30 → bắt đầu tại x+r
  });

  it("circle = 4 cung cubic, đi qua 4 điểm trục", () => {
    const d = segmentsToPathData(circlePath(50), 1);
    expect(d.match(/C/g)?.length).toBe(4);
    expect(d).toContain("M 50 0");
    expect(d).toContain("0 50"); // điểm đáy
    expect(d).toContain("-50 0");
  });

  it("ellipse rx≠ry giữ đúng bán trục", () => {
    const d = segmentsToPathData(ellipsePath(80, 40), 1);
    expect(d).toContain("M 80 0");
    expect(d).toContain("0 40");
  });

  it("regularPolygon: tam giác đều đỉnh hướng lên", () => {
    const d = segmentsToPathData(regularPolygonPath(3, 100), 1);
    expect(d).toContain("M 0 -100"); // đỉnh đầu trên cùng (y-down)
    expect(d.match(/L/g)?.length).toBe(2);
  });

  it("star 5 cánh: 10 đỉnh xen kẽ", () => {
    const d = segmentsToPathData(starPath(5, 100, 40), 1);
    expect(d).toContain("M 0 -100");
    expect(d.match(/L/g)?.length).toBe(9);
  });

  it("polygon + line giữ nguyên điểm; line KHÔNG đóng Z", () => {
    expect(segmentsToPathData(polygonPath([[0, 0], [10, 0], [5, 8]]), 1)).toBe(
      "M 0 0 L 10 0 L 5 8 Z",
    );
    expect(segmentsToPathData(linePath([[0, 0], [10, 10]]), 1)).toBe("M 0 0 L 10 10");
  });
});

describe("affine 2D", () => {
  it("mulAffine: translate ∘ scale áp dụng scale trước", () => {
    const t = { a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 };
    const s = { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 };
    expect(applyAffine(mulAffine(t, s), [3, 4])).toEqual([16, 28]);
  });

  it("placementToAffine: rotate 90° quanh gốc rồi đặt vào at", () => {
    const m = placementToAffine({ at: [100, 50], rotate: 90 });
    const [x, y] = applyAffine(m, [10, 0]);
    expect(x).toBeCloseTo(100, 6); // (10,0) xoay 90° (y-down CW) → (0,10)
    expect(y).toBeCloseTo(60, 6);
  });

  it("mirror x lật trước mọi thứ", () => {
    const m = placementToAffine({ mirror: "x", at: [0, 0] });
    expect(applyAffine(m, [5, 3])).toEqual([-5, 3]);
  });

  it("scale không đều [2,3]", () => {
    const m = placementToAffine({ scale: [2, 3] });
    expect(applyAffine(m, [4, 5])).toEqual([8, 15]);
  });

  it("transformSegments biến đổi cả control points của C", () => {
    const segs = transformSegments(circlePath(10), placementToAffine({ at: [100, 100] }));
    const d = segmentsToPathData(segs, 1);
    expect(d).toContain("M 110 100");
    expect(d).not.toContain("M 10 0");
  });
});

describe("flattenToContours + signedArea", () => {
  it("rect → 1 contour 4 điểm, diện tích đúng w*h", () => {
    const contours = flattenToContours(rectPath(100, 60), 8);
    expect(contours).toHaveLength(1);
    expect(contours[0]).toHaveLength(4);
    expect(Math.abs(signedArea(contours[0]))).toBeCloseTo(6000, 6);
  });

  it("circle flatten 16 bước/cung → diện tích ≈ πr² (sai số <1%)", () => {
    const contours = flattenToContours(circlePath(50), 16);
    expect(contours).toHaveLength(1);
    const area = Math.abs(signedArea(contours[0]));
    expect(area).toBeGreaterThan(Math.PI * 2500 * 0.99);
    expect(area).toBeLessThan(Math.PI * 2500 * 1.01);
  });

  it("2 subpath (M mới) → 2 contour riêng", () => {
    const segs = [...rectPath(10, 10), ...transformSegments(rectPath(4, 4), placementToAffine({ at: [0, 0] }))];
    expect(flattenToContours(segs, 4)).toHaveLength(2);
  });
});
