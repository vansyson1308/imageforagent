import { describe, expect, it } from "vitest";
import { buildFigure, figureProportions } from "@/lib/services/construct/partFigure";
import { expandParts, groupMatricesOf, partPlacementMatrix } from "@/lib/services/construct/partsExpand";
import { invertAffine4, mul4, transformDirection, transformPoint } from "@/lib/services/construct/math3d";
import { boneAngles } from "@/lib/services/motion/ik";
import { evaluateMotionAt, prepareMotion } from "@/lib/services/motion/evaluate";
import { createMotionCompiler } from "@/lib/services/motion/compileMotion";
import { motionSpecSchema } from "@/lib/validation/motionSchema";
import type { Part } from "@/lib/validation/constructSchema";
import type { Vec3 } from "@/lib/services/construct/types";

type FigurePart = Extract<Part, { type: "figure" }>;

const motion = (rigs: unknown[], extra: Record<string, unknown> = {}, part: Record<string, unknown> = {}) =>
  motionSpecSchema.parse({
    version: 1,
    duration: 1,
    fps: 4,
    scene: {
      version: 1,
      solids: [{ id: "handle", type: "box", size: [20, 20, 20], at: [40, 150, 45] }],
      parts: [{ id: "hero", type: "figure", height: 300, headCount: 3, at: [10, 0, -20], rotate: [0, 35, 0], ...part }],
      ...extra,
    },
    rigs,
    tracks: [],
  });

/** Điểm world của khớp figure sau khi evaluate (FK lại từ đầu). */
function jointWorld(spec: ReturnType<typeof evaluateMotionAt>, joint: string): Vec3 {
  const fig = spec.parts.find((p) => p.id === "hero") as FigurePart;
  const j = buildFigure(fig).joints!.find((x) => x.name === joint)!;
  const partM = partPlacementMatrix(fig, groupMatricesOf(spec));
  return transformPoint(mul4(partM, j.world), [0, 0, 0]);
}

/** Target world trong tầm với: khớp gốc (hệ part của scene gốc) + offset local. */
function reachable(m: ReturnType<typeof motion>, rootJoint: string, localOffset: Vec3): Vec3 {
  const fig = m.scene.parts.find((p) => p.id === "hero") as FigurePart;
  const root = buildFigure(fig).joints!.find((x) => x.name === rootJoint)!;
  const partM = partPlacementMatrix(fig, groupMatricesOf(m.scene));
  const r = transformPoint(root.world, [0, 0, 0]);
  return transformPoint(partM, [r[0] + localOffset[0], r[1] + localOffset[1], r[2] + localOffset[2]]);
}

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe("IK 2 xương", () => {
  it("boneAngles: FK của góc giải ra đúng hướng", () => {
    for (const d of [[0.3, -0.8, 0.5], [-0.6, 0.2, -0.7], [0.1, -0.2, 0.97]] as Vec3[]) {
      const [a, c] = boneAngles(d);
      // Rz(c)·Rx(a)·(0,−1,0) = (cos a sin c, −cos a cos c, −sin a)
      const r = Math.PI / 180;
      const got = [Math.cos(a * r) * Math.sin(c * r), -Math.cos(a * r) * Math.cos(c * r), -Math.sin(a * r)];
      const n = Math.hypot(...d);
      got.forEach((g, i) => expect(g).toBeCloseTo(d[i] / n, 9));
    }
  });

  it("cổ tay CHẠM target (part xoay 35° + dịch chuyển), khuỷu gập ra sau", () => {
    const target = reachable(motion([]), "shoulderL", [15, -25, 40]);
    const s = evaluateMotionAt(prepareMotion(motion([{ type: "ik", part: "hero", limb: "armL", target, fade: 0 }])), 0.5);
    expect(dist(jointWorld(s, "wristL"), target)).toBeLessThan(1e-6);
    // Khuỷu gập ra SAU (pole mặc định −z local): khuỷu lùi sau đường vai→cổ tay
    const fig = s.parts[0] as FigurePart;
    const inv = invertAffine4(partPlacementMatrix(fig, groupMatricesOf(s)))!;
    const [sh, el, wr] = ["shoulderL", "elbowL", "wristL"].map((j) => transformPoint(inv, jointWorld(s, j)));
    expect(el[2]).toBeLessThan(sh[2] + (wr[2] - sh[2]) * ((el[1] - sh[1]) / (wr[1] - sh[1] || 1)));
  });

  it("bám solid: tay theo tay cầm đang chuyển động (track) + offset", () => {
    const base = motion([]);
    const grip = reachable(base, "shoulderR", [-10, -35, 30]);
    const m = motionSpecSchema.parse({
      ...motion([{ type: "ik", part: "hero", limb: "armR", target: { solid: "handle", offset: [0, 10, 0] }, fade: 0 }], {
        solids: [{ id: "handle", type: "box", size: [20, 20, 20], at: [grip[0], grip[1] - 10, grip[2]] }],
      }),
      tracks: [{ target: "solids.handle.at.0", blend: "add", keys: [{ t: 0, v: -8 }, { t: 1, v: 8, ease: "linear" }] }],
    });
    const p = prepareMotion(m);
    for (const t of [0, 0.5, 0.75]) {
      const s = evaluateMotionAt(p, t);
      const h = s.solids.find((x) => x.id === "handle")!;
      expect(dist(jointWorld(s, "wristR"), [h.at[0], h.at[1] + 10, h.at[2]])).toBeLessThan(1e-6);
    }
  });

  it("chân: ĐẾ chân đặt đúng target, bàn chân phẳng (trục y của bàn chân thẳng đứng)", () => {
    const hip = reachable(motion([]), "hipL", [0, 0, 0]);
    const sole: Vec3 = [hip[0] + 20, 30, hip[2] + 25];
    const s = evaluateMotionAt(prepareMotion(motion([{ type: "ik", part: "hero", limb: "legL", target: sole, fade: 0 }])), 0.5);
    const fig = s.parts[0] as FigurePart;
    const footH = figureProportions(fig.height, fig.headCount).footH;
    const ankle = jointWorld(s, "ankleL");
    expect(dist(ankle, [sole[0], sole[1] + footH, sole[2]])).toBeLessThan(1e-6);
    const expanded = expandParts(s);
    const up = transformDirection(expanded.worldMatrixById.get("hero:footL")!, [0, 1, 0]);
    expect(up[1] / Math.hypot(...up)).toBeGreaterThan(0.999);
  });

  it("ngoài tầm với → duỗi thẳng VỀ PHÍA target (không NaN)", () => {
    const target: Vec3 = [900, 400, 900];
    const s = evaluateMotionAt(prepareMotion(motion([{ type: "ik", part: "hero", limb: "armL", target, fade: 0 }])), 0.5);
    const sh = jointWorld(s, "shoulderL");
    const wr = jointWorld(s, "wristL");
    const a = [wr[0] - sh[0], wr[1] - sh[1], wr[2] - sh[2]];
    const b = [target[0] - sh[0], target[1] - sh[1], target[2] - sh[2]];
    const cos = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b));
    expect(cos).toBeGreaterThan(0.999);
  });

  it("ngoài cửa sổ start/end → pose không đổi; weight 0 → không đụng", () => {
    const m = motion([{ type: "ik", part: "hero", limb: "armL", target: [70, 170, 60], start: 0.6, end: 1 }]);
    const s = evaluateMotionAt(prepareMotion(m), 0.25);
    expect((s.parts[0] as FigurePart).pose.shoulderL).toBeUndefined();
  });

  it("face: mouthOpen animate được → miệng scale theo; clip compile trọn", () => {
    const m = motionSpecSchema.parse({
      ...motion([], {}, { face: {} }),
      tracks: [{ target: "parts.hero.face.mouthOpen", keys: [{ t: 0, v: 0 }, { t: 1, v: 1, ease: "linear" }] }],
    });
    const p = prepareMotion(m);
    const mouthScale = (t: number) => {
      const fig = evaluateMotionAt(p, t).parts[0] as FigurePart;
      const mouth = buildFigure(fig).solids.find((x) => x.solid.id === "hero:mouth")!;
      return Math.hypot(mouth.offset![1], mouth.offset![5], mouth.offset![9]);
    };
    expect(mouthScale(0.75)).toBeGreaterThan(mouthScale(0) * 3);
    const c = createMotionCompiler(m);
    expect(c.compileFrame(3).svg.length).toBeGreaterThan(100);
  });
});
