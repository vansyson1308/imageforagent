import { describe, expect, it } from "vitest";
import { repairPolygons, repairedToMesh } from "@/lib/services/construct/meshRepair";
import { csgOperation, prepareOperand } from "@/lib/services/construct/csg";
import { boxMesh, cylinderMesh, transformMesh } from "@/lib/services/construct/geometry3d";
import { translation4 } from "@/lib/services/construct/math3d";
import { relativeEps } from "@/lib/services/construct/plane3";
import { compileConstruction } from "@/lib/services/construct/compile";
import { constructSpecSchema } from "@/lib/validation/constructSchema";
import type { Vec3 } from "@/lib/services/construct/types";

const EPS = relativeEps(100);

function prep(mesh: ReturnType<typeof boxMesh>, solidId: string, fill?: string) {
  return prepareOperand(mesh, { solidId, solidIndex: 0, fill }, EPS).polygons;
}

describe("repairPolygons", () => {
  it("union 2 cube cùng hàng: mặt đồng phẳng gộp lại — path count giảm mạnh", () => {
    const a = prep(boxMesh([40, 40, 40]), "a", "#abc");
    const b = prep(transformMesh(translation4([20, 0, 0]), boxMesh([40, 40, 40])), "b", "#abc");
    const { polygons } = csgOperation("union", a, b, EPS, "t");
    const before = polygons.length;
    const repaired = repairPolygons(polygons, EPS);
    expect(repaired.length).toBeLessThan(before);
    // Khối hợp là hộp 60×40×40 → tối ưu tuyệt đối là 6 mặt
    expect(repaired.length).toBeLessThanOrEqual(10);
  });

  it("KHÔNG gộp chéo fill khác nhau (giữ CSG đa màu)", () => {
    const a = prep(boxMesh([40, 40, 40]), "a", "#ff0000");
    const b = prep(transformMesh(translation4([40, 0, 0]), boxMesh([40, 40, 40])), "b", "#00ff00");
    const { polygons } = csgOperation("union", a, b, EPS, "t");
    const repaired = repairPolygons(polygons, EPS);
    // Mặt trước của 2 cube đồng phẳng nhưng khác fill → vẫn 2 mặt riêng
    const frontFaces = repaired.filter((f) => {
      const zs = f.outer.map((v) => v[2]);
      return zs.every((z) => Math.abs(z - 20) < 0.01);
    });
    expect(frontFaces.length).toBeGreaterThanOrEqual(2);
    const fills = new Set(frontFaces.map((f) => f.shared.fill));
    expect(fills.size).toBe(2);
  });

  it("washer (ống trừ): cap gộp lại thành mặt CÓ LỖ (holes)", () => {
    const outer = prep(cylinderMesh(30, 20, 12), "outer", "#888");
    const inner = prep(cylinderMesh(15, 24, 12), "inner", "#444");
    const { polygons } = csgOperation("difference", outer, inner, EPS, "t");
    const repaired = repairPolygons(polygons, EPS);
    // Có ít nhất một mặt có lỗ (cap trên/dưới của vành khuyên)
    const withHoles = repaired.filter((f) => f.holes.length > 0);
    expect(withHoles.length).toBeGreaterThanOrEqual(1);
  });

  it("bảo toàn diện tích per plane-group (không mất/thêm hình)", () => {
    const areaOf = (ring: readonly Vec3[]) => {
      let nx = 0, ny = 0, nz = 0;
      for (let i = 0; i < ring.length; i++) {
        const [x1, y1, z1] = ring[i];
        const [x2, y2, z2] = ring[(i + 1) % ring.length];
        nx += (y1 - y2) * (z1 + z2);
        ny += (z1 - z2) * (x1 + x2);
        nz += (x1 - x2) * (y1 + y2);
      }
      return Math.hypot(nx, ny, nz) / 2;
    };
    const a = prep(boxMesh([40, 40, 40]), "a", "#abc");
    const b = prep(transformMesh(translation4([20, 0, 0]), boxMesh([40, 40, 40])), "b", "#abc");
    const { polygons } = csgOperation("union", a, b, EPS, "t");
    // Mặt front (z=20): tổng diện tích trước = sau (outer − holes)
    const frontBefore = polygons
      .filter((p) => p.vertices.every((v) => Math.abs(v[2] - 20) < 0.01))
      .reduce((s, p) => s + areaOf(p.vertices), 0);
    const repaired = repairPolygons(polygons, EPS);
    const frontAfter = repaired
      .filter((f) => f.outer.every((v) => Math.abs(v[2] - 20) < 0.01))
      .reduce((s, f) => s + areaOf(f.outer) - f.holes.reduce((h, r) => h + areaOf(r), 0), 0);
    expect(frontAfter).toBeCloseTo(frontBefore, 3);
    // Hộp hợp 60×40 → mặt front đúng 2400
    expect(frontAfter).toBeCloseTo(2400, 3);
  });

  it("deterministic: double-run cùng kết quả sâu", () => {
    const run = () => {
      const a = prep(boxMesh([40, 40, 40]), "a", "#abc");
      const b = prep(transformMesh(translation4([20, 10, 0]), boxMesh([40, 40, 40])), "b", "#abc");
      const { polygons } = csgOperation("union", a, b, EPS, "t");
      return repairPolygons(polygons, EPS);
    };
    expect(run()).toEqual(run());
  });

  it("repairedToMesh giữ holes + fill + label", () => {
    const face = {
      outer: [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]] as Vec3[],
      holes: [[[3, 3, 0], [3, 6, 0], [6, 6, 0], [6, 3, 0]] as Vec3[]],
      shared: { solidId: "s", solidIndex: 0, faceIndex: 1, label: "front", fill: "#123456" },
    };
    const mesh = repairedToMesh([face]);
    expect(mesh.faces[0].holes).toHaveLength(1);
    expect(mesh.faces[0].fill).toBe("#123456");
    expect(mesh.faces[0].label).toBe("front");
    expect(mesh.vertices).toHaveLength(8);
  });
});

describe("compile CSG + repair end-to-end", () => {
  it("dice: path count giảm rõ so với polygon soup + evenodd khi có lỗ xuyên", () => {
    const spec = constructSpecSchema.parse({
      version: 1,
      solids: [
        { id: "body", type: "box", size: [200, 200, 200], fill: "#f5f0e6" },
        { id: "bore", type: "cylinder", r: 50, h: 240, segments: 16, rotate: [90, 0, 0], fill: "#3a6ea5", shading: "faceted" },
        { id: "block", type: "csg", op: "difference", of: ["body", "bore"] },
      ],
    });
    const result = compileConstruction(spec);
    // Trước repair: front cap bị BSP băm ~chục mảnh; sau repair mặt front
    // là 1 path có lỗ → tổng facesEmitted nhỏ
    expect(result.stats.facesEmitted).toBeLessThan(60);
    expect(result.svg).toContain('fill-rule="evenodd"'); // mặt có lỗ
    expect(result.stats.compileMs).toBeLessThan(500);
  });

  it("extrude profile có lỗ đi qua CSG: cap khôi phục holes sau repair", () => {
    const spec = constructSpecSchema.parse({
      version: 1,
      shapes: [
        { id: "plate", type: "rect", w: 120, h: 120 },
        { id: "hole", type: "circle", r: 30 },
        { id: "washer2d", type: "boolean", op: "difference", of: ["plate", "hole"] },
      ],
      solids: [
        { id: "washer", type: "extrude", profile: "washer2d", depth: 20, fill: "#999999" },
        { id: "cutter", type: "box", size: [60, 60, 30], at: [60, 60, 0], fill: "#cc6644" },
        { id: "result", type: "csg", op: "difference", of: ["washer", "cutter"] },
      ],
    });
    const result = compileConstruction(spec);
    expect(result.stats.facesEmitted).toBeLessThan(80);
  });
});
