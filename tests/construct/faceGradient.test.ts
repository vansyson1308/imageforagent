import { describe, expect, it } from "vitest";
import { faceGradientFill } from "@/lib/services/construct/faceGradient";
import { compileConstruction } from "@/lib/services/construct/compile";
import { constructSpecSchema } from "@/lib/validation/constructSchema";
import { sanitizeSvg } from "@/lib/services/svgRenderer";
import type { ProjectedFace, Vec3 } from "@/lib/services/construct/types";

function face(points: [number, number][], normal: Vec3): ProjectedFace {
  return {
    points,
    depth: 0,
    normal,
    solidId: "s",
    solidIndex: 0,
    faceIndex: 0,
  };
}

describe("faceGradientFill", () => {
  const SQUARE = face(
    [[0, 0], [100, 0], [100, 100], [0, 100]],
    [0, 0, 1],
  );

  it("golden: sáng chéo trên mặt phẳng → gradient dọc trục sáng, đầu sáng phía nguồn", () => {
    // Sáng đi tới hướng (+x, −z-ish): lp trên mặt (normal +z) = thành phần x
    const light: Vec3 = [0.7, 0, -0.7];
    const { fill, gradient } = faceGradientFill(SQUARE, "#808080", light, 0.3, 0, 10);
    expect(gradient).toBeDefined();
    expect(fill).toBe("url(#cg-f0)");
    expect(gradient!.attrs.gradientUnits).toBe("userSpaceOnUse");
    // Trục màn hình ax = [−lp.x, lp.y] = [−0.7, 0] → cực đại theo ax là x=0
    // → p2 (đầu SÁNG) là điểm x=0; x1 = đầu sáng
    expect(Number(gradient!.attrs.x1)).toBe(0);
    expect(Number(gradient!.attrs.x2)).toBe(100);
    // Stop 0 sáng hơn stop 1
    expect(gradient!.stops[0].color > gradient!.stops[1].color).toBe(true);
  });

  it("sáng vuông góc mặt → flat fill, không gradient", () => {
    const { fill, gradient } = faceGradientFill(SQUARE, "#808080", [0, 0, -1], 0.3, 0, 10);
    expect(gradient).toBeUndefined();
    expect(fill).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("hết budget → flat fill", () => {
    const { fill, gradient } = faceGradientFill(SQUARE, "#808080", [0.7, 0, -0.7], 0.3, 0, 0);
    expect(gradient).toBeUndefined();
    expect(fill).toMatch(/^#/);
  });

  it("deterministic theo seq: id cg-f<seq>", () => {
    const r = faceGradientFill(SQUARE, "#808080", [0.7, 0, -0.7], 0.3, 42, 10);
    expect(r.gradient!.id).toBe("cg-f42");
  });
});

describe("compile với light.mode gradient", () => {
  const SPEC = {
    version: 1,
    solids: [{ id: "cube", type: "box", size: [200, 200, 200], fill: "#e07b39" }],
    light: { mode: "gradient" },
  } as const;

  it("mặt 3D fill bằng url(#cg-f*), gradient userSpaceOnUse, pass sanitizer", () => {
    const result = compileConstruction(constructSpecSchema.parse(SPEC));
    expect(result.svg).toContain('gradientUnits="userSpaceOnUse"');
    expect(result.svg).toContain('fill="url(#cg-f0)"');
    expect(() => sanitizeSvg(result.svg, "frame")).not.toThrow();
  });

  it("budget overflow → flat + warning nêu knob", () => {
    // Sphere faceted segments lớn → nhiều mặt hơn maxGradients (128)
    const result = compileConstruction(
      constructSpecSchema.parse({
        version: 1,
        solids: [
          { id: "ball", type: "sphere", r: 100, segments: 24, fill: "#4488cc", shading: "faceted" },
        ],
        light: { mode: "gradient" },
      }),
    );
    expect(result.warnings.some((w) => w.includes("Gradient budget"))).toBe(true);
    expect(result.stats.compileMs).toBeLessThan(500);
  });

  it("determinism: double-compile byte-identical", () => {
    const spec = constructSpecSchema.parse(SPEC);
    expect(compileConstruction(spec).svg).toBe(compileConstruction(spec).svg);
  });
});
