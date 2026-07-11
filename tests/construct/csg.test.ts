import { describe, expect, it } from "vitest";
import { csgOperation, meshToPolygons, polygonsToMesh, prepareOperand } from "@/lib/services/construct/csg";
import { weldVertices, relativeEps, type Polygon3 } from "@/lib/services/construct/plane3";
import { boxMesh, cylinderMesh, sphereMesh, transformMesh, extrudeMesh } from "@/lib/services/construct/geometry3d";
import { translation4 } from "@/lib/services/construct/math3d";
import { flattenToContours, rectPath, circlePath } from "@/lib/services/construct/geometry2d";
import { compileConstruction } from "@/lib/services/construct/compile";
import { constructSpecSchema } from "@/lib/validation/constructSchema";
import { AppError } from "@/lib/services/apiError";
import type { Mesh } from "@/lib/services/construct/types";

const EPS = relativeEps(100);

function prep(mesh: Mesh, solidId: string, fill?: string) {
  return prepareOperand(mesh, { solidId, solidIndex: 0, fill }, EPS).polygons;
}

/**
 * Bất biến watertight: sau weld, mỗi cạnh vô hướng xuất hiện ĐÚNG 2 lần
 * (một lần mỗi chiều) trên toàn bộ khối kín.
 */
function expectWatertight(polygons: readonly Polygon3[]): void {
  const welded = weldVertices(polygons, EPS);
  const refs = new Map<object, number>();
  const idOf = (v: object) => {
    let id = refs.get(v);
    if (id === undefined) {
      id = refs.size;
      refs.set(v, id);
    }
    return id;
  };
  const edgeCount = new Map<string, number>();
  for (const poly of welded) {
    for (let i = 0; i < poly.vertices.length; i++) {
      const a = idOf(poly.vertices[i]);
      const b = idOf(poly.vertices[(i + 1) % poly.vertices.length]);
      if (a === b) continue;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
    }
  }
  const bad = [...edgeCount.entries()].filter(([, n]) => n !== 2);
  expect(bad.length, `${bad.length} cạnh không chia đúng 2 mặt (vd ${bad[0]?.[0]}×${bad[0]?.[1]})`).toBe(0);
}

describe("csgOperation — các phép cơ bản trên khối thật", () => {
  it("union 2 cube chồng nhau: watertight, đỉnh vượt ra ngoài từng cube", () => {
    const a = prep(boxMesh([40, 40, 40]), "a", "#ff0000");
    const b = prep(transformMesh(translation4([20, 0, 0]), boxMesh([40, 40, 40])), "b", "#00ff00");
    const { polygons } = csgOperation("union", a, b, EPS, "t");
    expectWatertight(polygons);
    const xs = polygons.flatMap((p) => p.vertices.map((v) => v[0]));
    expect(Math.min(...xs)).toBeCloseTo(-20, 5);
    expect(Math.max(...xs)).toBeCloseTo(40, 5);
  });

  it("cube − sphere góc: watertight, giữ fill hai nguồn (đa màu)", () => {
    const a = prep(boxMesh([60, 60, 60]), "cube", "#ffffff");
    const b = prep(
      transformMesh(translation4([30, 30, 30]), sphereMesh(20, 12)),
      "ball",
      "#cc2222",
    );
    const { polygons } = csgOperation("difference", a, b, EPS, "t");
    expectWatertight(polygons);
    const fills = new Set(polygons.map((p) => p.shared.fill));
    expect(fills.has("#ffffff")).toBe(true); // mặt cube còn lại
    expect(fills.has("#cc2222")).toBe(true); // lòng hõm = màu dao cắt
  });

  it("cylinder − cylinder đồng trục = ống: watertight, có mặt trong", () => {
    const outer = prep(cylinderMesh(20, 40, 16), "outer", "#8888ff");
    const inner = prep(cylinderMesh(10, 44, 16), "inner", "#222244");
    const { polygons } = csgOperation("difference", outer, inner, EPS, "t");
    expectWatertight(polygons);
    // Có mặt bán kính ~10 (thành trong)
    const hasInnerWall = polygons.some((p) =>
      p.vertices.every((v) => Math.abs(Math.hypot(v[0], v[2]) - 10) < 0.5),
    );
    expect(hasInnerWall).toBe(true);
  });

  it("intersection 2 cube lệch → khối giao đúng kích thước", () => {
    const a = prep(boxMesh([40, 40, 40]), "a");
    const b = prep(transformMesh(translation4([20, 0, 0]), boxMesh([40, 40, 40])), "b");
    const { polygons } = csgOperation("intersection", a, b, EPS, "t");
    expectWatertight(polygons);
    const xs = polygons.flatMap((p) => p.vertices.map((v) => v[0]));
    expect(Math.min(...xs)).toBeCloseTo(0, 5);
    expect(Math.max(...xs)).toBeCloseTo(20, 5);
  });

  it("AABB rời nhau: union ghép, difference warning + giữ A, intersection lỗi", () => {
    const a = prep(boxMesh([10, 10, 10]), "a");
    const b = prep(transformMesh(translation4([100, 0, 0]), boxMesh([10, 10, 10])), "b");
    expect(csgOperation("union", a, b, EPS, "t").polygons).toHaveLength(a.length + b.length);
    const diff = csgOperation("difference", a, b, EPS, "t");
    expect(diff.polygons).toHaveLength(a.length);
    expect(diff.warnings[0]).toContain("no effect");
    expect(() => csgOperation("intersection", a, b, EPS, "t")).toThrowError(/no volume/);
  });

  it("deterministic: double-run cùng kết quả sâu", () => {
    const run = () => {
      const a = prep(boxMesh([60, 60, 60]), "a", "#fff");
      const b = prep(transformMesh(translation4([30, 30, 30]), sphereMesh(20, 8)), "b", "#f00");
      return csgOperation("difference", a, b, EPS, "t").polygons;
    };
    expect(run()).toEqual(run());
  });
});

describe("meshToPolygons — mặt lõm/có lỗ tam giác hoá", () => {
  it("box: 6 mặt lồi giữ nguyên (không tam giác hoá)", () => {
    const { polygons, degraded } = meshToPolygons(boxMesh([10, 10, 10]), { solidId: "b", solidIndex: 0 });
    expect(polygons).toHaveLength(6);
    expect(degraded).toBe(false);
  });

  it("extrude washer (cap có lỗ) → cap thành tam giác, kế thừa label", () => {
    const outer = flattenToContours(rectPath(100, 100), 4)[0];
    const hole = flattenToContours(circlePath(20), 4)[0];
    const mesh = extrudeMesh([outer, hole], 10);
    const { polygons } = meshToPolygons(mesh, { solidId: "w", solidIndex: 0 });
    // Cap front/back giờ là nhiều tam giác giữ label
    const frontTris = polygons.filter((p) => p.shared.label === "front");
    expect(frontTris.length).toBeGreaterThan(2);
    expect(frontTris.every((p) => p.vertices.length === 3)).toBe(true);
  });

  it("polygonsToMesh dedup đỉnh + giữ fill/label per face", () => {
    const { polygons } = meshToPolygons(boxMesh([10, 10, 10]), { solidId: "b", solidIndex: 0, fill: "#abc" });
    const mesh = polygonsToMesh(polygons);
    expect(mesh.vertices).toHaveLength(8);
    expect(mesh.faces.every((f) => f.fill === "#abc")).toBe(true);
    expect(mesh.faces.some((f) => f.label === "top")).toBe(true);
  });
});

describe("compile với solid csg", () => {
  const DICE_ISH = {
    version: 1,
    solids: [
      { id: "body", type: "box", size: [200, 200, 200], fill: "#f5f0e6" },
      { id: "pip", type: "sphere", r: 60, segments: 10, at: [100, 100, 100], fill: "#c0392b", shading: "faceted" },
      { id: "dice", type: "csg", op: "difference", of: ["body", "pip"] },
    ],
  } as const;

  it("cube − sphere compile sạch, operand không vẽ riêng, đa màu", () => {
    const result = compileConstruction(constructSpecSchema.parse(DICE_ISH));
    expect(result.svg).toContain("#"); // có fill
    // Không còn path màu pip NGUYÊN KHỐI (sphere đầy đủ ~100 mặt) — chỉ lòng hõm
    expect(result.stats.solids).toBe(3);
    expect(result.svg).toMatch(/9c2d22|c0392b|af3327|82251c/i); // tông đỏ shaded xuất hiện (lòng hõm)
  });

  it("csg.fill override toàn bộ mặt", () => {
    const spec = constructSpecSchema.parse({
      ...DICE_ISH,
      solids: DICE_ISH.solids.map((s) =>
        s.id === "dice" ? { ...s, fill: "#3355ff" } : s,
      ),
    });
    const result = compileConstruction(spec);
    expect(result.svg).not.toMatch(/c0392b/i);
  });

  it("nested csg (ống = trừ 2 lần) hoạt động", () => {
    const spec = constructSpecSchema.parse({
      version: 1,
      solids: [
        { id: "a", type: "box", size: [100, 40, 100], fill: "#999999" },
        { id: "b", type: "cylinder", r: 20, h: 50, segments: 12, fill: "#446688", shading: "faceted" },
        { id: "step1", type: "csg", op: "difference", of: ["a", "b"] },
        { id: "c", type: "box", size: [30, 50, 30], at: [35, 0, 35], fill: "#886644" },
        { id: "final", type: "csg", op: "difference", of: ["step1", "c"] },
      ],
    });
    const result = compileConstruction(spec);
    expect(result.stats.facesEmitted).toBeGreaterThan(6);
  });

  it("csg shading smooth → reject kèm hint", () => {
    try {
      compileConstruction(
        constructSpecSchema.parse({
          version: 1,
          solids: [
            { id: "a", type: "box", size: [10, 10, 10] },
            { id: "b", type: "box", size: [10, 10, 10], at: [5, 0, 0] },
            { id: "u", type: "csg", op: "union", of: ["a", "b"], shading: "smooth" },
          ],
        }),
      );
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).hint).toContain("faceted");
    }
  });

  it("csg cycle → lỗi rõ", () => {
    expect(() =>
      compileConstruction(
        constructSpecSchema.parse({
          version: 1,
          solids: [
            { id: "x", type: "csg", op: "union", of: ["y", "y"] },
            { id: "y", type: "csg", op: "union", of: ["x", "x"] },
          ],
        }),
      ),
    ).toThrowError(/cycle/);
  });

  it("operand smooth bị tiêu thụ — không silhouette riêng", () => {
    const result = compileConstruction(constructSpecSchema.parse({
      version: 1,
      solids: [
        { id: "a", type: "box", size: [80, 80, 80], fill: "#888888" },
        { id: "ball", type: "sphere", r: 50, segments: 10, at: [40, 40, 0], fill: "#dd4444" },
        { id: "cut", type: "csg", op: "difference", of: ["a", "ball"] },
      ],
    }));
    // Sphere smooth bình thường sẽ sinh radialGradient — bị tiêu thụ thì không
    expect(result.svg).not.toContain("radialGradient");
  });

  it("determinism: double-compile byte-identical", () => {
    const spec = constructSpecSchema.parse(DICE_ISH);
    expect(compileConstruction(spec).svg).toBe(compileConstruction(spec).svg);
  });
});
