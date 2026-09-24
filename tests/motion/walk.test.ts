import { describe, expect, it } from "vitest";
import { buildFigure, figureProportions } from "@/lib/services/construct/partFigure";
import { composePlacement4, mul4, transformPoint } from "@/lib/services/construct/math3d";
import { evaluateMotionAt, prepareMotion } from "@/lib/services/motion/evaluate";
import { WALK_DUTY, walkState } from "@/lib/services/motion/rigs";
import { createMotionCompiler } from "@/lib/services/motion/compileMotion";
import { motionSpecSchema, type MotionSpec } from "@/lib/validation/motionSchema";
import type { Part } from "@/lib/validation/constructSchema";
import type { Vec3 } from "@/lib/services/construct/types";

type FigurePart = Extract<Part, { type: "figure" }>;

const walkMotion = (rig: Record<string, unknown> = {}, part: Record<string, unknown> = {}): MotionSpec =>
  motionSpecSchema.parse({
    version: 1,
    fps: 24,
    duration: 4,
    scene: {
      version: 1,
      parts: [{ id: "hero", type: "figure", height: 300, headCount: 3, ...part }],
      camera: { orbit: { azimuth: 90, elevation: 10 } },
    },
    rigs: [{ type: "walk", part: "hero", path: [[-400, 0], [400, 0]], ...rig }],
  });

/** Điểm thấp nhất (đế) của bàn chân trong world. */
function soleWorld(figure: FigurePart, side: "L" | "R"): Vec3 {
  const build = buildFigure(figure);
  const foot = build.solids.find((s) => s.solid.id === `hero:foot${side}`)!;
  const partM = composePlacement4(figure.at, figure.rotate, figure.scale);
  const footH = figureProportions(figure.height, figure.headCount).footH;
  return transformPoint(mul4(partM, foot.localM), [0, -footH / 2, 0]);
}

describe("walk rig", () => {
  it("đi hết đường: đầu ở path[0], cuối ở path[n], hướng mặt theo đường đi", () => {
    const p = prepareMotion(walkMotion());
    const at = (t: number) => (evaluateMotionAt(p, t).parts[0] as FigurePart);
    expect(at(0).at[0]).toBeCloseTo(-400, 6);
    expect(at(4).at[0]).toBeCloseTo(400, 6);
    expect(at(2).at[0]).toBeGreaterThan(-100);
    expect(at(2).at[0]).toBeLessThan(100);
    // Đi +x: figure local nhìn +z → yaw 90°
    expect(at(2).rotate[1]).toBeCloseTo(90, 6);
  });

  it("đứng yên (pose trung tính) ngoài cửa sổ start/end", () => {
    const p = prepareMotion(walkMotion({ start: 1, end: 3 }));
    const f = evaluateMotionAt(p, 0.5).parts[0] as FigurePart;
    for (const v of Object.values(f.pose)) {
      const arr = typeof v === "number" ? [v] : v;
      for (const x of arr) expect(Math.abs(x)).toBeLessThan(1e-9);
    }
  });

  it("biên độ tự suy ra nhịp ~cadence bước/giây, trong [6°, 38°]", () => {
    const m = walkMotion();
    const part = m.scene.parts[0] as FigurePart;
    const st = walkState(m.rigs[0] as Extract<MotionSpec["rigs"][number], { type: "walk" }>, part, 2, 4);
    expect(st.envelope).toBe(1);
    expect(st.amplitude).toBeGreaterThanOrEqual(6);
    expect(st.amplitude).toBeLessThanOrEqual(38);
    // Số bước trong đoạn đều ≈ cadence × thời gian
    // bước = nửa chu kỳ = X/DUTY; nhịp = v/bước ≈ cadence 2
    const stepLen = st.halfStride / WALK_DUTY;
    const speed = 800 / (4 - 0.35);
    expect(speed / stepLen).toBeCloseTo(2, 1);
  });

  it("BÀN CHÂN TRỤ KHÔNG TRƯỢT: đế chân sát đất gần như đứng yên trong pha trụ", () => {
    const m = walkMotion();
    const p = prepareMotion(m);
    const rig = m.rigs[0] as Extract<MotionSpec["rigs"][number], { type: "walk" }>;
    const base = m.scene.parts[0] as FigurePart;
    let worst = 0;
    let checked = 0;
    // Chỉ đoạn vận tốc đều (bỏ ramp 0.35s mỗi đầu)
    for (let t = 0.6; t < 3.4; t += 1 / 24) {
      const st = walkState(rig, base, t, 4);
      // Chân trái trụ khi phase ∈ [0, DUTY); chân phải lệch nửa chu kỳ.
      // Chỉ xét chân trụ DUY NHẤT (bỏ pha hai chân cùng trụ + sát biên)
      const pR = (st.phase + 0.5) % 1;
      const inStance = (p: number) => p > 0.05 && p < WALK_DUTY - 0.05;
      const stanceSide = inStance(st.phase) ? "L" : inStance(pR) ? "R" : null;
      if (!stanceSide) continue;
      const dt = 1 / 240;
      const a = soleWorld(evaluateMotionAt(p, t).parts[0] as FigurePart, stanceSide);
      const b = soleWorld(evaluateMotionAt(p, t + dt).parts[0] as FigurePart, stanceSide);
      const footSpeed = Math.hypot(b[0] - a[0], b[2] - a[2]) / dt;
      worst = Math.max(worst, footSpeed);
      checked++;
    }
    const bodySpeed = 800 / (4 - 0.35);
    expect(checked).toBeGreaterThan(20);
    // Mắt cá lùi tuyến tính đúng tốc độ thân ⇒ đế gần như bất động
    expect(worst).toBeLessThan(bodySpeed * 0.03);
  });

  it("chân trụ chạm đất: đế thấp nhất luôn ở gần y=0 (±4% chiều cao)", () => {
    const p = prepareMotion(walkMotion());
    for (let t = 0.5; t < 3.5; t += 0.25) {
      const f = evaluateMotionAt(p, t).parts[0] as FigurePart;
      const minY = Math.min(soleWorld(f, "L")[1], soleWorld(f, "R")[1]);
      expect(Math.abs(minY)).toBeLessThan(300 * 0.04);
    }
  });

  it("rẽ theo polyline: hướng mặt đổi theo đoạn", () => {
    const p = prepareMotion(walkMotion({ path: [[0, 0], [300, 0], [300, 300]] }));
    expect((evaluateMotionAt(p, 0.8).parts[0] as FigurePart).rotate[1]).toBeCloseTo(90, 6);
    expect((evaluateMotionAt(p, 3.5).parts[0] as FigurePart).rotate[1]).toBeCloseTo(0, 6);
  });

  it("walk trên part không phải figure → lỗi rõ", () => {
    expect(() =>
      prepareMotion(
        motionSpecSchema.parse({
          version: 1,
          duration: 1,
          scene: { version: 1, parts: [{ id: "w", type: "wheel", radius: 10, width: 5 }] },
          rigs: [{ type: "walk", part: "w", path: [[0, 0], [1, 0]] }],
        }),
      ),
    ).toThrow(/not a figure/);
  });

  it("compile cả clip walk: mọi frame hợp lệ, pose thay đổi theo thời gian", () => {
    const m = motionSpecSchema.parse({ ...walkMotion(), fps: 6, duration: 2, rigs: [{ type: "walk", part: "hero", path: [[-200, 0], [200, 0]] }] });
    const c = createMotionCompiler(m);
    const svgs = Array.from({ length: c.frameCount }, (_, i) => c.compileFrame(i).svg);
    expect(new Set(svgs).size).toBeGreaterThan(c.frameCount - 2);
  });
});
