import { describe, expect, it } from "vitest";
import { buildFigure } from "@/lib/services/construct/partFigure";
import { compileConstruction } from "@/lib/services/construct/compile";
import { constructSpecSchema, type Part } from "@/lib/validation/constructSchema";
import { transformPoint } from "@/lib/services/construct/math3d";
import { AppError } from "@/lib/services/apiError";
import type { Vec3 } from "@/lib/services/construct/types";

type FigurePart = Extract<Part, { type: "figure" }>;

function figure(overrides: Partial<FigurePart> = {}): FigurePart {
  return constructSpecSchema.parse({
    version: 1,
    parts: [{ id: "f", type: "figure", ...overrides }],
  }).parts[0] as FigurePart;
}

/** Vị trí world-local của solid sinh ra (tâm local qua localM). */
function solidCenter(part: FigurePart, segId: string): Vec3 {
  const build = buildFigure(part);
  const gen = build.solids.find((s) => s.solid.id === `f:${segId}`);
  expect(gen, `thiếu solid f:${segId}`).toBeDefined();
  return transformPoint(gen!.localM, [0, 0, 0]);
}

describe("buildFigure — FK + proportions", () => {
  it("~15 solid, đủ bộ phận, đứng trên đất (minY ≈ 0)", () => {
    const build = buildFigure(figure());
    expect(build.solids.length).toBeGreaterThanOrEqual(15);
    const ids = build.solids.map((s) => s.solid.id);
    for (const seg of ["torso", "head", "handL", "handR", "thighL", "shinR", "footL", "footR"]) {
      expect(ids).toContain(`f:${seg}`);
    }
  });

  it("đỉnh đầu ≈ height (88-102% — đầu chồng cổ 45% bán kính cho liền khối)", () => {
    const headTopOf = (headCount: number) => {
      const p = figure({ height: 300, headCount });
      const c = solidCenter(p, "head");
      const headR = 300 / headCount / 2;
      return c[1] + headR;
    };
    expect(headTopOf(3)).toBeGreaterThan(300 * 0.88);
    expect(headTopOf(3)).toBeLessThan(300 * 1.02);
    expect(headTopOf(7)).toBeGreaterThan(300 * 0.88);
    expect(headTopOf(7)).toBeLessThan(300 * 1.02);
  });

  it("GẬP ELBOW dịch chuyển bàn tay đúng hướng (FK golden)", () => {
    const straight = solidCenter(figure(), "handL");
    // Gập elbow x=−90°: cẳng tay từ dọc xuống → chĩa về trước (+z)
    const bent = solidCenter(figure({ pose: { elbowL: [-90, 0, 0] } }), "handL");
    expect(bent[1]).toBeGreaterThan(straight[1]); // tay nâng lên
    expect(Math.abs(bent[2])).toBeGreaterThan(Math.abs(straight[2]) + 10); // chĩa ra z
    // Vai không đổi khi chỉ gập elbow
    const s1 = solidCenter(figure(), "upperArmL");
    const s2 = solidCenter(figure({ pose: { elbowL: [-90, 0, 0] } }), "upperArmL");
    expect(s1).toEqual(s2);
  });

  it("pose scalar ≡ [0,0,z]", () => {
    const a = solidCenter(figure({ pose: { shoulderL: 45 } }), "handL");
    const b = solidCenter(figure({ pose: { shoulderL: [0, 0, 45] } }), "handL");
    expect(a).toEqual(b);
  });

  it("khớp không tồn tại → lỗi kèm danh sách khớp", () => {
    try {
      buildFigure(figure({ pose: { shoulderX: 10 } }));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).hint).toContain("shoulderL");
    }
  });

  it("chibiness: headCount thấp → chi ngắn + mập (limbRadius tăng)", () => {
    const chibi = buildFigure(figure({ headCount: 2.5, height: 300 }));
    const real = buildFigure(figure({ headCount: 8, height: 300 }));
    const armLen = (b: typeof chibi) => {
      const arm = b.solids.find((s) => s.solid.id === "f:upperArmL")!.solid;
      return arm.type === "cylinder" ? arm.h : 0;
    };
    const armR = (b: typeof chibi) => {
      const arm = b.solids.find((s) => s.solid.id === "f:upperArmL")!.solid;
      return arm.type === "cylinder" ? arm.r : 0;
    };
    expect(armLen(chibi)).toBeLessThan(armLen(real));
    expect(armR(chibi)).toBeGreaterThan(armR(real));
  });

  it("deterministic: double-build identical", () => {
    const p = figure({ pose: { shoulderL: 120, kneeR: 30 } });
    expect(buildFigure(p)).toEqual(buildFigure(p));
  });
});

describe("compile với figure", () => {
  it("figure trong scene compile sạch + gắn group FK ngoài", () => {
    const result = compileConstruction(
      constructSpecSchema.parse({
        version: 1,
        groups: [{ id: "rig", at: [100, 0, 0], rotate: [0, 30, 0] }],
        parts: [
          { id: "hero", type: "figure", height: 300, group: "rig", pose: { shoulderR: -140 } },
        ],
        shadow: {},
      }),
    );
    expect(result.stats.partsExpanded).toBe(1);
    expect(result.stats.facesEmitted).toBeGreaterThan(10);
    expect(result.stats.compileMs).toBeLessThan(500);
  });

  it("determinism: double-compile byte-identical", () => {
    const spec = constructSpecSchema.parse({
      version: 1,
      parts: [{ id: "f", type: "figure", pose: { spine: [15, 0, 0] } }],
    });
    expect(compileConstruction(spec).svg).toBe(compileConstruction(spec).svg);
  });
});
