import { describe, expect, it } from "vitest";
import { compileConstruction } from "@/lib/services/construct/compile";
import { constructSpecSchema } from "@/lib/validation/constructSchema";

/**
 * Regression (audit "quảng trường đêm"): bóng của vành CSG mỏng (difference
 * 2 cylinder segments 36) ở camera orbit lẻ làm path-bool chết nội bộ
 * ("undefined winding") khi union footprint per-face — TRƯỚC fix, cả
 * compile chết vì một lớp trang trí. SAU fix: degrade convex hull + warning.
 * Cần solid to trong scene để relativeEps khớp bối cảnh gốc (mesh CSG
 * weld khác theo scene radius).
 */
describe("shadow — degrade mềm khi footprint suy biến", () => {
  const SPEC = {
    version: 1,
    solids: [
      { id: "earth", type: "box", size: [3600, 6, 2800], at: [0, -3, -250], fill: "#171d33", shadow: false },
      { id: "rimOuter", type: "cylinder", r: 471, h: 3, segments: 36, at: [0, 9.8, 0], fill: "#46548a", shading: "none", shadow: false },
      { id: "rimInner", type: "cylinder", r: 455, h: 5, segments: 36, at: [0, 9.8, 0], fill: "#46548a", shading: "none" },
      { id: "plazaRim", type: "csg", op: "difference", of: ["rimOuter", "rimInner"], fill: "#46548a" },
    ],
    shadow: { style: "silhouette", color: "#0a0f1f", opacity: 0.3, blur: 6, ground: 0 },
    light: { direction: [0.55, -1.5, 0.65], ambient: 0.36, mode: "smooth" },
    camera: { orbit: { azimuth: -29.9980034577918, elevation: 21.998668971861195 } },
    place: { at: [979.9833621520983, 615.0088735088542], scale: 0.6800842549140719 },
  } as const;

  it("không throw; bóng degrade convex hull kèm warning", () => {
    const { svg, warnings } = compileConstruction(constructSpecSchema.parse(SPEC));
    expect(warnings.some((w) => w.includes("degraded to its convex hull"))).toBe(true);
    // Bóng vẫn được vẽ (path fill màu bóng, có filter blur)
    expect(svg).toContain('fill="#0a0f1f"');
  });

  it("deterministic sau degrade: double compile byte-identical", () => {
    const a = compileConstruction(constructSpecSchema.parse(SPEC));
    const b = compileConstruction(constructSpecSchema.parse(SPEC));
    expect(a.svg).toBe(b.svg);
  });
});
