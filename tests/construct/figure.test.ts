import { describe, expect, it } from "vitest";
import { buildFigure } from "@/lib/services/construct/partFigure";
import { compileConstruction } from "@/lib/services/construct/compile";
import { constructSpecSchema, type Part } from "@/lib/validation/constructSchema";
import { transformPoint } from "@/lib/services/construct/math3d";
import { AppError } from "@/lib/services/apiError";
import { expandParts } from "@/lib/services/construct/partsExpand";
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

describe("solid attach — đạo cụ / tóc / nón bám khớp figure", () => {
  const specWith = (pose: Record<string, number | [number, number, number]>, solids: unknown[]) =>
    constructSpecSchema.parse({
      version: 1,
      parts: [{ id: "kid", type: "figure", height: 180, headCount: 3, pose, at: [100, 0, -40], rotate: [0, 30, 0] }],
      solids,
    });
  const lantern = { id: "lantern", type: "sphere", r: 12, at: [0, -20, 0], attach: { part: "kid", joint: "wristR" } };
  const worldOf = (spec: ReturnType<typeof specWith>, id: string) =>
    transformPoint(expandParts(spec).worldMatrixById.get(id)!, [0, 0, 0]);
  const handOf = (spec: ReturnType<typeof specWith>) => worldOf(spec, "kid:handR");

  it("đi theo bàn tay khi gập khuỷu (khoảng cách tay↔đạo cụ bất biến)", () => {
    const rest = specWith({}, [lantern]);
    const bent = specWith({ elbowR: [-90, 0, 0], shoulderR: [0, 0, 40] }, [lantern]);
    const d = (s: ReturnType<typeof specWith>) => {
      const [a, b] = [handOf(s), worldOf(s, "lantern")];
      return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    };
    expect(d(bent)).toBeCloseTo(d(rest), 6);
    expect(d(rest)).toBeCloseTo(20, 6);
    // và thật sự đã di chuyển cùng tay
    const moved = worldOf(bent, "lantern")[1] - worldOf(rest, "lantern")[1];
    expect(Math.abs(moved)).toBeGreaterThan(10);
  });

  it('neo "head" = tâm đầu (nón/tóc), tôn trọng at/rotate của part', () => {
    const spec = specWith({}, [{ id: "hat", type: "cone", r: 40, h: 30, attach: { part: "kid", joint: "head" } }]);
    const hat = worldOf(spec, "hat");
    const head = worldOf(spec, "kid:head");
    expect(hat[0]).toBeCloseTo(head[0], 6);
    expect(hat[1]).toBeCloseTo(head[1], 6);
    expect(hat[2]).toBeCloseTo(head[2], 6);
  });

  it("compile sạch; không đổi output khi không dùng attach (figure không thêm khớp)", () => {
    const spec = specWith({}, [lantern]);
    expect(() => compileConstruction(spec)).not.toThrow();
    expect(buildFigure(figure()).joints!.map((j) => j.name)).not.toContain("head");
  });

  it("lỗi rõ ràng: sai khớp, part không phải figure, attach + group", () => {
    const bad = (solids: unknown[], extra: Record<string, unknown> = {}) => () =>
      expandParts(
        constructSpecSchema.parse({
          version: 1,
          parts: [{ id: "kid", type: "figure" }, { id: "oak", type: "tree", trunkH: 50, trunkR: 5, canopyR: 20 }],
          solids,
          ...extra,
        }),
      );
    expect(bad([{ ...lantern, attach: { part: "kid", joint: "tail" } }])).toThrow(/no joint "tail"/);
    expect(bad([{ ...lantern, attach: { part: "oak", joint: "head" } }])).toThrow(/not a figure/);
    expect(bad([{ ...lantern, group: "g" }], { groups: [{ id: "g" }] })).toThrow(/both "group" and "attach"/);
  });
});
