import { describe, expect, it } from "vitest";
import {
  autoDistance,
  CAMERA_PRESETS,
  projectViewPoint,
  projectWorldPoint,
  TRUE_ISO_ELEVATION,
  viewMatrix,
  viewNormal,
} from "@/lib/services/construct/camera";
import { AppError } from "@/lib/services/apiError";

const ORTHO = { kind: "orthographic", zoom: 1 } as const;

describe("viewMatrix — isometric chuẩn (az 45, el 35.264)", () => {
  const view = viewMatrix(CAMERA_PRESETS.isometric);

  it("TRUE_ISO_ELEVATION = arctan(1/√2)", () => {
    expect(TRUE_ISO_ELEVATION).toBeCloseTo(35.26438968, 6);
  });

  it("trục y world → thẳng đứng hướng LÊN màn hình", () => {
    const { screen } = projectWorldPoint(view, [0, 1, 0], ORTHO);
    expect(screen[0]).toBeCloseTo(0, 10);
    expect(screen[1]).toBeCloseTo(-0.81649658, 6); // âm = lên (y-down)
  });

  it("trục x world → chếch xuống-phải đúng 30° (tính chất isometric)", () => {
    const { screen } = projectWorldPoint(view, [1, 0, 0], ORTHO);
    expect(screen[0]).toBeCloseTo(Math.SQRT1_2, 6); // 0.7071
    expect(screen[1]).toBeCloseTo(0.40824829, 6);
    const angleDeg = (Math.atan2(screen[1], screen[0]) * 180) / Math.PI;
    expect(angleDeg).toBeCloseTo(30, 5);
  });

  it("trục z world → đối xứng gương của trục x (chếch xuống-trái 30°)", () => {
    const { screen } = projectWorldPoint(view, [0, 0, 1], ORTHO);
    expect(screen[0]).toBeCloseTo(-Math.SQRT1_2, 6);
    expect(screen[1]).toBeCloseTo(0.40824829, 6);
  });

  it("3 trục cách đều 120° trên màn hình", () => {
    const angle = (p: readonly [number, number]) => (Math.atan2(p[1], p[0]) * 180) / Math.PI;
    const ax = angle(projectWorldPoint(view, [1, 0, 0], ORTHO).screen);
    const ay = angle(projectWorldPoint(view, [0, 1, 0], ORTHO).screen);
    const az = angle(projectWorldPoint(view, [0, 0, 1], ORTHO).screen);
    expect(Math.abs(ax - az)).toBeCloseTo(120, 4); // 30 − (150) = −120
    expect(Math.abs(ay - ax)).toBeCloseTo(120, 4); // −90 − 30 = −120
  });
});

describe("preset isometric-2:1 — slope đúng 2:1", () => {
  it("trục x: |dy/dx| = 0.5", () => {
    const view = viewMatrix(CAMERA_PRESETS["isometric-2:1"]);
    const { screen } = projectWorldPoint(view, [1, 0, 0], ORTHO);
    expect(screen[1] / screen[0]).toBeCloseTo(0.5, 6);
  });
});

describe("preset top/front/side", () => {
  it("top (el 90): nhìn thẳng từ trên — x giữ nguyên, z thành y màn hình", () => {
    const view = viewMatrix(CAMERA_PRESETS.top);
    expect(projectWorldPoint(view, [1, 0, 0], ORTHO).screen[0]).toBeCloseTo(1, 10);
    const z = projectWorldPoint(view, [0, 0, 1], ORTHO);
    expect(z.screen[1]).toBeCloseTo(1, 10);
  });

  it("front (el 0): x giữ nguyên, y lên trên, z là depth", () => {
    const view = viewMatrix(CAMERA_PRESETS.front);
    const p = projectWorldPoint(view, [3, 2, 7], ORTHO);
    expect(p.screen[0]).toBeCloseTo(3, 10);
    expect(p.screen[1]).toBeCloseTo(-2, 10);
    expect(p.depth).toBeCloseTo(7, 10); // z lớn = gần camera
  });

  it("side (az 90): z world thành x màn hình", () => {
    const view = viewMatrix(CAMERA_PRESETS.side);
    // az=90: camera nhìn từ +x; z world → −x view? kiểm bằng depth của (1,0,0)
    const px = projectWorldPoint(view, [1, 0, 0], ORTHO);
    expect(px.depth).toBeCloseTo(1, 10); // trục x hướng về camera
    const pz = projectWorldPoint(view, [0, 0, 1], ORTHO);
    expect(Math.abs(pz.screen[0])).toBeCloseTo(1, 10);
  });
});

describe("perspective", () => {
  const PERSP = { kind: "perspective", zoom: 1, distance: 100 } as const;

  it("mặt phẳng qua gốc (z=0) giữ scale 1 (khớp ortho)", () => {
    const { screen } = projectViewPoint([5, 3, 0], PERSP);
    expect(screen[0]).toBeCloseTo(5, 10);
    expect(screen[1]).toBeCloseTo(-3, 10);
  });

  it("điểm ở nửa khoảng cách camera → phóng đại 2×", () => {
    const { screen } = projectViewPoint([5, 0, 50], PERSP);
    expect(screen[0]).toBeCloseTo(10, 10);
  });

  it("điểm xa hơn gốc → thu nhỏ", () => {
    const { screen } = projectViewPoint([5, 0, -100], PERSP);
    expect(screen[0]).toBeCloseTo(2.5, 10);
  });

  it("điểm sau camera → CONSTRUCTION_INVALID kèm hint", () => {
    try {
      projectViewPoint([0, 0, 100], PERSP);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("CONSTRUCTION_INVALID");
      expect((err as AppError).hint).toContain("distance");
    }
  });
});

describe("viewNormal + autoDistance", () => {
  it("normal +y trong iso view chếch về camera (z_view > 0)", () => {
    const view = viewMatrix(CAMERA_PRESETS.isometric);
    const n = viewNormal(view, [0, 1, 0]);
    expect(n[2]).toBeGreaterThan(0); // mặt top nhìn thấy được
  });

  it("autoDistance = 4× bán kính, tối thiểu 1", () => {
    expect(autoDistance(100)).toBe(400);
    expect(autoDistance(0)).toBe(1);
  });
});
