import { describe, expect, it } from "vitest";
import {
  BACK,
  classifyPoint,
  COPLANAR,
  flipPlane,
  flipPolygon,
  FRONT,
  planeFromPolygon,
  relativeEps,
  signedDistance,
  splitPolygonByPlane,
  weldVertices,
  type Plane,
  type Polygon3,
  type SplitBuckets,
} from "@/lib/services/construct/plane3";
import type { Vec3 } from "@/lib/services/construct/types";

const TAG = { solidId: "s", solidIndex: 0, faceIndex: 0 } as const;
const EPS = 1e-5;

function poly(vertices: Vec3[]): Polygon3 {
  return { vertices, shared: TAG };
}

function emptyBuckets(): SplitBuckets {
  return { coplanarFront: [], coplanarBack: [], front: [], back: [] };
}

/** Plane z = 0, normal +z. */
const PLANE_Z: Plane = { normal: [0, 0, 1], w: 0 };

describe("plane cơ bản", () => {
  it("planeFromPolygon: quad XY tại z=5, CCW nhìn từ +z → normal +z, w=5", () => {
    const p = planeFromPolygon([
      [0, 0, 5],
      [1, 0, 5],
      [1, 1, 5],
      [0, 1, 5],
    ]);
    expect(p).not.toBeNull();
    expect(p!.normal[2]).toBeCloseTo(1, 10);
    expect(p!.w).toBeCloseTo(5, 10);
  });

  it("đa giác suy biến (thẳng hàng) → null", () => {
    expect(planeFromPolygon([[0, 0, 0], [1, 1, 1], [2, 2, 2]])).toBeNull();
  });

  it("signedDistance + classifyPoint đúng dấu và eps", () => {
    expect(signedDistance(PLANE_Z, [0, 0, 3])).toBe(3);
    expect(classifyPoint(PLANE_Z, [0, 0, 3], EPS)).toBe(FRONT);
    expect(classifyPoint(PLANE_Z, [0, 0, -3], EPS)).toBe(BACK);
    expect(classifyPoint(PLANE_Z, [0, 0, 1e-7], EPS)).toBe(COPLANAR);
  });

  it("flipPlane/flipPolygon đảo chiều", () => {
    const flipped = flipPlane(PLANE_Z);
    expect(flipped.normal[2]).toBe(-1);
    expect(Math.abs(flipped.w)).toBe(0); // -0 hay 0 đều được
    const fp = flipPolygon(poly([[0, 0, 0], [1, 0, 0], [1, 1, 0]]));
    expect(fp.vertices[0]).toEqual([1, 1, 0]);
    expect(fp.shared).toBe(TAG);
  });

  it("relativeEps scale theo bán kính scene", () => {
    expect(relativeEps(0.5)).toBe(1e-5);
    expect(relativeEps(1000)).toBeCloseTo(1e-2, 10);
  });
});

describe("splitPolygonByPlane — 4 route", () => {
  it("FRONT toàn phần → nguyên mảnh vào front", () => {
    const out = emptyBuckets();
    const p = poly([[0, 0, 1], [1, 0, 1], [1, 1, 2]]);
    splitPolygonByPlane(PLANE_Z, p, EPS, out);
    expect(out.front).toEqual([p]);
    expect(out.back).toHaveLength(0);
  });

  it("BACK toàn phần → back", () => {
    const out = emptyBuckets();
    splitPolygonByPlane(PLANE_Z, poly([[0, 0, -1], [1, 0, -1], [1, 1, -2]]), EPS, out);
    expect(out.back).toHaveLength(1);
  });

  it("COPLANAR cùng chiều normal → coplanarFront; ngược chiều → coplanarBack", () => {
    const outSame = emptyBuckets();
    // CCW nhìn từ +z → normal +z, cùng chiều PLANE_Z
    splitPolygonByPlane(PLANE_Z, poly([[0, 0, 0], [1, 0, 0], [1, 1, 0]]), EPS, outSame);
    expect(outSame.coplanarFront).toHaveLength(1);

    const outOpp = emptyBuckets();
    splitPolygonByPlane(PLANE_Z, poly([[0, 0, 0], [1, 1, 0], [1, 0, 0]]), EPS, outOpp);
    expect(outOpp.coplanarBack).toHaveLength(1);
  });

  it("SPANNING đa giác lồi → ĐÚNG 1 front + 1 back, đỉnh giao nội suy đúng", () => {
    const out = emptyBuckets();
    // Quad thẳng đứng cắt z=0: z từ −1 tới +1
    splitPolygonByPlane(
      PLANE_Z,
      poly([[0, 0, -1], [2, 0, -1], [2, 0, 1], [0, 0, 1]]),
      EPS,
      out,
    );
    expect(out.front).toHaveLength(1);
    expect(out.back).toHaveLength(1);
    // Mảnh front chứa 2 đỉnh giao tại z=0
    const zs = out.front[0].vertices.map((v) => v[2]);
    expect(Math.min(...zs)).toBeCloseTo(0, 10);
    expect(Math.max(...zs)).toBeCloseTo(1, 10);
    // Diện tích bảo toàn: front + back = tổng (quad 2×2 = 4 → mỗi nửa 2)
    expect(out.front[0].vertices).toHaveLength(4);
    expect(out.back[0].vertices).toHaveLength(4);
    // SharedTag kế thừa
    expect(out.front[0].shared).toBe(TAG);
  });

  it("tam giác chạm plane bằng 1 đỉnh (COPLANAR đỉnh) không sinh mảnh rác", () => {
    const out = emptyBuckets();
    splitPolygonByPlane(PLANE_Z, poly([[0, 0, 0], [1, 0, 1], [-1, 0, 1]]), EPS, out);
    // Toàn bộ phía front (1 đỉnh coplanar) → nguyên mảnh front, không split
    expect(out.front).toHaveLength(1);
    expect(out.back).toHaveLength(0);
  });

  it("mảnh cắt suy biến (diện tích < eps²) bị bỏ", () => {
    const out = emptyBuckets();
    const eps = 0.01;
    // Tam giác tí hon vắt qua plane: mảnh front ~2e-5 < eps² (1e-4) → bỏ;
    // mảnh back to hơn nhưng cũng nhỏ... đỉnh back đủ xa để giữ
    splitPolygonByPlane(
      PLANE_Z,
      poly([[0, 0, -0.02], [0.001, 0, 0.02], [0.002, 0, -0.02]]),
      eps,
      out,
    );
    expect(out.front).toHaveLength(0); // sliver bị lọc
  });
});

describe("weldVertices", () => {
  it("đỉnh gần trùng (≤eps) hàn về CÙNG instance", () => {
    const a = poly([[0, 0, 0], [1, 0, 0], [1, 1, 0]]);
    const b = poly([[1 + 1e-7, 0, 0], [2, 0, 0], [2, 1, 0]]);
    const welded = weldVertices([a, b], 1e-5);
    // Đỉnh (1,0,0) của a và (1+1e-7,0,0) của b → cùng reference
    expect(welded[0].vertices[1]).toBe(welded[1].vertices[0]);
  });

  it("first-seen wins — giá trị canonical là đỉnh xuất hiện trước", () => {
    const a = poly([[5, 5, 5], [6, 5, 5], [6, 6, 5]]);
    const b = poly([[5 + 2e-6, 5, 5], [7, 5, 5], [7, 7, 5]]);
    const welded = weldVertices([a, b], 1e-5);
    expect(welded[1].vertices[0]).toEqual([5, 5, 5]);
  });

  it("deterministic: hai lần chạy cùng input → cùng kết quả sâu", () => {
    const polys = [
      poly([[0, 0, 0], [1, 0, 0], [1, 1, 0]]),
      poly([[1e-7, 0, 0], [0, 1, 0], [1, 1, 1e-7]]),
    ];
    expect(weldVertices(polys, 1e-5)).toEqual(weldVertices(polys, 1e-5));
  });

  it("đa giác co về <3 đỉnh sau weld bị loại", () => {
    const sliver = poly([[0, 0, 0], [1e-8, 0, 0], [0, 1e-8, 0]]);
    expect(weldVertices([sliver], 1e-5)).toHaveLength(0);
  });

  it("đỉnh xa nhau KHÔNG bị hàn", () => {
    const a = poly([[0, 0, 0], [1, 0, 0], [1, 1, 0]]);
    const welded = weldVertices([a], 1e-5);
    expect(welded[0].vertices).toHaveLength(3);
  });
});
