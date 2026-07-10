import { describe, expect, it } from "vitest";
import {
  boxMesh,
  coneMesh,
  cylinderMesh,
  extrudeMesh,
  meshFaceCount,
  meshRadius,
  transformMesh,
} from "@/lib/services/construct/geometry3d";
import { faceNormal, dot3, centroid3, normalize3 } from "@/lib/services/construct/math3d";
import { sphereMesh } from "@/lib/services/construct/geometry3d";
import { flattenToContours, rectPath, circlePath, transformSegments, placementToAffine } from "@/lib/services/construct/geometry2d";
import { translation4 } from "@/lib/services/construct/math3d";
import type { Mesh, Vec3 } from "@/lib/services/construct/types";
import { AppError } from "@/lib/services/apiError";

/** Mọi normal mặt phải hướng RA khỏi tâm khối (khối lồi tâm gốc). */
function expectOutwardNormals(mesh: Mesh): void {
  for (const face of mesh.faces) {
    const pts = face.vertices.map((i) => mesh.vertices[i]);
    const n = faceNormal(pts);
    const c = centroid3(pts);
    // Với khối lồi tâm gốc: normal · hướng-từ-tâm-ra-centroid > 0
    expect(dot3(n, normalize3(c))).toBeGreaterThan(0);
  }
}

describe("boxMesh", () => {
  const box = boxMesh([2, 4, 6]);

  it("8 đỉnh, 6 mặt, đủ 6 nhãn", () => {
    expect(box.vertices).toHaveLength(8);
    expect(box.faces).toHaveLength(6);
    const labels = box.faces.map((f) => f.label).sort();
    expect(labels).toEqual(["back", "bottom", "front", "left", "right", "top"]);
  });

  it("normal từng mặt đúng trục theo nhãn", () => {
    const expected: Record<string, Vec3> = {
      top: [0, 1, 0],
      bottom: [0, -1, 0],
      front: [0, 0, 1],
      back: [0, 0, -1],
      right: [1, 0, 0],
      left: [-1, 0, 0],
    };
    for (const face of box.faces) {
      const n = faceNormal(face.vertices.map((i) => box.vertices[i]));
      const e = expected[face.label!];
      expect(n[0]).toBeCloseTo(e[0], 10);
      expect(n[1]).toBeCloseTo(e[1], 10);
      expect(n[2]).toBeCloseTo(e[2], 10);
    }
  });

  it("kích thước đúng size", () => {
    const xs = box.vertices.map((v) => v[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBe(2);
    const ys = box.vertices.map((v) => v[1]);
    expect(Math.max(...ys) - Math.min(...ys)).toBe(4);
  });
});

describe("cylinderMesh / coneMesh / sphereMesh", () => {
  it("cylinder(seg): seg+2 mặt, normals hướng ra", () => {
    const cyl = cylinderMesh(10, 20, 12);
    expect(cyl.faces).toHaveLength(14);
    expect(cyl.vertices).toHaveLength(24);
    expectOutwardNormals(cyl);
    expect(cyl.faces.filter((f) => f.label === "top")).toHaveLength(1);
    expect(cyl.faces.filter((f) => f.label === "bottom")).toHaveLength(1);
  });

  it("cone nhọn (rTop=0): seg+1 mặt, không nhãn top", () => {
    const cone = coneMesh(10, 0, 20, 8);
    expect(cone.faces).toHaveLength(9);
    expect(cone.faces.some((f) => f.label === "top")).toBe(false);
    expectOutwardNormals(cone);
  });

  it("nón cụt (rTop>0): seg+2 mặt có top", () => {
    const frustum = coneMesh(10, 6, 20, 8);
    expect(frustum.faces).toHaveLength(10);
    expect(frustum.faces.some((f) => f.label === "top")).toBe(true);
    expectOutwardNormals(frustum);
  });

  it("sphere(seg=8): 8×(4−1) quad + 2×8 tam giác... đếm tổng quát rings", () => {
    const s = sphereMesh(10, 8); // rings = 4
    // quạt bắc 8 + quạt nam 8 + quad giữa 8×(4−2)=16 → 32
    expect(s.faces).toHaveLength(32);
    expectOutwardNormals(s);
    // Đỉnh: 2 cực + 8×(4−1) = 26
    expect(s.vertices).toHaveLength(26);
  });
});

describe("extrudeMesh", () => {
  const P = placementToAffine({ at: [0, 0] });

  it("profile rect → 2 cap + 4 tường = 6 mặt (như box)", () => {
    const contours = flattenToContours(rectPath(20, 10), 4);
    const mesh = extrudeMesh(contours, 30);
    expect(mesh.faces).toHaveLength(6);
    expectOutwardNormals(mesh);
    expect(mesh.faces.filter((f) => f.label === "front")).toHaveLength(1);
    expect(mesh.faces.filter((f) => f.label === "back")).toHaveLength(1);
  });

  it("profile có lỗ (rect − circle): 2 cap CÓ holes + tường ngoài + tường trong", () => {
    const outer = flattenToContours(rectPath(100, 100), 4)[0];
    const hole = flattenToContours(
      transformSegments(circlePath(20), P),
      4, // 4 bước/cung × 4 cung = 16 đoạn
    )[0];
    const mesh = extrudeMesh([outer, hole], 10);
    const caps = mesh.faces.filter((f) => f.label);
    expect(caps).toHaveLength(2);
    for (const cap of caps) {
      expect(cap.holes).toHaveLength(1);
      expect(cap.holes![0].length).toBe(hole.length);
    }
    // Tường: 4 (outer) + 16 (hole) + 2 caps = 22 mặt
    expect(mesh.faces).toHaveLength(4 + hole.length + 2);
  });

  it("tường lỗ có normal hướng VÀO lòng lỗ (ra khỏi vật liệu)", () => {
    const outer = flattenToContours(rectPath(100, 100), 4)[0];
    const hole = flattenToContours(transformSegments(circlePath(20), P), 4)[0];
    const mesh = extrudeMesh([outer, hole], 10);
    // Tường lỗ: mặt không nhãn có centroid gần tâm (bán kính ~20)
    const holeWalls = mesh.faces.filter((f) => {
      if (f.label) return false;
      const c = centroid3(f.vertices.map((i) => mesh.vertices[i]));
      return Math.hypot(c[0], c[1]) < 30;
    });
    expect(holeWalls.length).toBeGreaterThan(0);
    for (const wall of holeWalls) {
      const pts = wall.vertices.map((i) => mesh.vertices[i]);
      const n = faceNormal(pts);
      const c = centroid3(pts);
      // Normal hướng về tâm lỗ (ngược hướng centroid xy)
      expect(n[0] * c[0] + n[1] * c[1]).toBeLessThan(0);
    }
  });

  it("depth tâm gốc: z ∈ [−d/2, +d/2]", () => {
    const mesh = extrudeMesh(flattenToContours(rectPath(10, 10), 4), 40);
    const zs = mesh.vertices.map((v) => v[2]);
    expect(Math.min(...zs)).toBe(-20);
    expect(Math.max(...zs)).toBe(20);
  });

  it("profile y-down SVG map sang y-up world (đỉnh trên hình → y dương)", () => {
    // Tam giác SVG có đỉnh tại y=−95 (trên màn hình)
    const contours = flattenToContours(
      [
        { kind: "M", to: [-150, 0] },
        { kind: "L", to: [150, 0] },
        { kind: "L", to: [0, -95] },
        { kind: "Z" },
      ],
      1,
    );
    const mesh = extrudeMesh(contours, 10);
    const ys = mesh.vertices.map((v) => v[1]);
    expect(Math.max(...ys)).toBe(95); // đỉnh nhọn giờ ở y=+95
  });

  it("profile rỗng/hở → CONSTRUCTION_INVALID", () => {
    try {
      extrudeMesh([], 10);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).hint).toContain("closed profile");
    }
  });
});

describe("transformMesh + đo đạc", () => {
  it("transform dời đỉnh, giữ nguyên topology", () => {
    const box = boxMesh([2, 2, 2]);
    const moved = transformMesh(translation4([10, 0, 0]), box);
    expect(moved.faces).toBe(box.faces);
    expect(moved.vertices[0][0]).toBe(box.vertices[0][0] + 10);
  });

  it("meshFaceCount + meshRadius", () => {
    const box = boxMesh([2, 2, 2]);
    expect(meshFaceCount(box)).toBe(6);
    expect(meshRadius([box])).toBeCloseTo(Math.sqrt(3), 10);
    const moved = transformMesh(translation4([10, 0, 0]), box);
    expect(meshRadius([moved])).toBeCloseTo(Math.hypot(11, 1, 1), 10);
  });
});
