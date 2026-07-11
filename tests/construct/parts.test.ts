import { describe, expect, it } from "vitest";
import { expandParts } from "@/lib/services/construct/partsExpand";
import { compileConstruction } from "@/lib/services/construct/compile";
import { constructSpecSchema } from "@/lib/validation/constructSchema";
import { transformPoint, composePlacement4, mul4 } from "@/lib/services/construct/math3d";
import { AppError } from "@/lib/services/apiError";

const parse = (raw: unknown) => constructSpecSchema.parse(raw);

describe("expandParts — groups (khung FK)", () => {
  it("chuỗi cha-con: world = M(cha)·M(con)·SRT(solid) — golden vs mul4 tay", () => {
    const spec = parse({
      version: 1,
      groups: [
        { id: "root", at: [100, 0, 0], rotate: [0, 90, 0] },
        { id: "child", parent: "root", at: [0, 50, 0] },
      ],
      solids: [{ id: "b", type: "box", size: [10, 10, 10], at: [5, 0, 0], group: "child" }],
    });
    const { worldMatrixById } = expandParts(spec);
    const expected = mul4(
      mul4(
        composePlacement4([100, 0, 0], [0, 90, 0], 1),
        composePlacement4([0, 50, 0], [0, 0, 0], 1),
      ),
      composePlacement4([5, 0, 0], [0, 0, 0], 1),
    );
    const m = worldMatrixById.get("b")!;
    // Điểm gốc solid qua 2 ma trận phải trùng
    const p = transformPoint(m, [1, 2, 3]);
    const q = transformPoint(expected, [1, 2, 3]);
    expect(p[0]).toBeCloseTo(q[0], 10);
    expect(p[1]).toBeCloseTo(q[1], 10);
    expect(p[2]).toBeCloseTo(q[2], 10);
  });

  it("group cycle → lỗi rõ", () => {
    expect(() =>
      expandParts(
        parse({
          version: 1,
          groups: [
            { id: "a", parent: "b" },
            { id: "b", parent: "a" },
          ],
          solids: [{ id: "s", type: "box", size: [1, 1, 1], group: "a" }],
        }),
      ),
    ).toThrowError(/cycle/);
  });

  it("group không tồn tại → hint liệt kê groups", () => {
    try {
      expandParts(
        parse({
          version: 1,
          groups: [{ id: "arm" }],
          solids: [{ id: "s", type: "box", size: [1, 1, 1], group: "amr" }],
        }),
      );
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).hint).toContain("arm");
    }
  });

  it("trùng id xuyên namespace (solid vs part) → lỗi", () => {
    expect(() =>
      expandParts(
        parse({
          version: 1,
          solids: [{ id: "w", type: "box", size: [1, 1, 1] }],
          parts: [{ id: "w", type: "wheel", radius: 10, width: 4 }],
        }),
      ),
    ).toThrowError(/Duplicate/);
  });
});

describe("expandParts — wheel", () => {
  const WHEEL = parse({
    version: 1,
    parts: [
      { id: "w", type: "wheel", radius: 50, width: 16, boreRadius: 4, spokes: 4 },
    ],
  });

  it("sinh đủ segment: tire (ring extrude), hub (ring có bore), 4 spokes", () => {
    const { shapes, solids } = expandParts(WHEEL);
    const solidIds = solids.map((s) => s.id);
    expect(solidIds).toContain("w:tire");
    expect(solidIds).toContain("w:hub");
    expect(solidIds.filter((id) => id.startsWith("w:spoke"))).toHaveLength(4);
    // Profile 2D: tire ring + hub ring (bore > 0)
    const shapeIds = shapes.map((s) => s.id);
    expect(shapeIds).toContain("w:tire2d");
    expect(shapeIds).toContain("w:hub2d");
  });

  it("spoke 90° đặt đúng vị trí radial (golden matrix)", () => {
    const { worldMatrixById } = expandParts(WHEEL);
    // spoke1 = góc 90°: tâm spoke nằm trên trục +y local
    const m = worldMatrixById.get("w:spoke1")!;
    const center = transformPoint(m, [0, 0, 0]);
    expect(center[0]).toBeCloseTo(0, 6);
    expect(center[1]).toBeGreaterThan(10); // dọc +y
    expect(center[2]).toBeCloseTo(0, 6);
  });

  it("double-expansion deterministic", () => {
    expect(expandParts(WHEEL)).toEqual(expandParts(WHEEL));
  });
});

describe("compile với parts + groups", () => {
  it("wheel compile sạch: tire có lỗ (evenodd), stats.partsExpanded", () => {
    const result = compileConstruction(
      parse({
        version: 1,
        parts: [{ id: "w", type: "wheel", radius: 60, width: 20, spokes: 6 }],
        camera: { preset: "front" },
      }),
    );
    expect(result.svg).toContain('fill-rule="evenodd"'); // cap ring lốp
    expect(result.stats.partsExpanded).toBe(1);
    expect(result.stats.compileMs).toBeLessThan(500);
  });

  it("tree 3 style compile; cloud + arrow là shape 2D tự emit", () => {
    const result = compileConstruction(
      parse({
        version: 1,
        parts: [
          { id: "t1", type: "tree", trunkH: 60, trunkR: 8, canopyR: 30, at: [-150, 0, 0] },
          { id: "t2", type: "tree", trunkH: 60, trunkR: 8, canopyR: 30, style: "layered", at: [150, 0, 0] },
          { id: "cl", type: "cloud", width: 200, height: 60, at: [0, -300] },
          { id: "ar", type: "arrow", length: 150, shaftWidth: 20, headWidth: 50, headLength: 40, at: [0, 300] },
        ],
      }),
    );
    // Cloud fill trắng default + arrow vàng default xuất hiện
    expect(result.svg).toContain('fill="#ffffff"');
    expect(result.svg).toContain('fill="#f2b134"');
    expect(result.stats.partsExpanded).toBe(4);
  });

  it("group FK: xoay group cha di chuyển solid con (khớp quay tay)", () => {
    const make = (angle: number) =>
      compileConstruction(
        parse({
          version: 1,
          groups: [{ id: "arm", rotate: [0, 0, angle] }],
          solids: [
            { id: "seg", type: "box", size: [100, 20, 20], at: [60, 0, 0], group: "arm", fill: "#cc6644" },
          ],
          camera: { preset: "front" },
        }),
      );
    // Khác góc → khác hình
    expect(make(0).svg).not.toBe(make(45).svg);
    // Cùng góc → determinism
    expect(make(30).svg).toBe(make(30).svg);
  });

  it("csg trỏ vào nội bộ part: đục lỗ qua hub của wheel", () => {
    const result = compileConstruction(
      parse({
        version: 1,
        parts: [{ id: "w", type: "wheel", radius: 50, width: 16, spokeStyle: "none" }],
        solids: [
          { id: "cutter", type: "box", size: [20, 20, 40], fill: "#dd3333" },
          { id: "carved", type: "csg", op: "difference", of: ["w:disc", "cutter"] },
        ],
        camera: { preset: "front" },
      }),
    );
    expect(result.stats.csgOps).toBe(1);
  });

  it("node cap sau expansion → lỗi kèm hint", () => {
    // 16 wheel × 12 spokes ≈ 16×(2+12+3 shapes...) — vượt 256 node
    const parts = Array.from({ length: 16 }, (_, i) => ({
      id: `w${i}`,
      type: "wheel",
      radius: 40,
      width: 10,
      spokes: 12,
      boreRadius: 2,
      at: [i * 100, 0, 0],
    }));
    expect(() => compileConstruction(parse({ version: 1, parts }))).toThrowError(/expands to/);
  });
});
