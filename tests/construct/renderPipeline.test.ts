import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { boxMesh, transformMesh } from "@/lib/services/construct/geometry3d";
import { CAMERA_PRESETS, viewMatrix, viewNormal } from "@/lib/services/construct/camera";
import { projectAndSort, overlapWarnings } from "@/lib/services/construct/painterSort";
import {
  applyLuminance,
  DEFAULT_LIGHT_DIRECTION,
  lambertFactor,
  luminance,
  parseHex,
  quantizeFactor,
  shadeFaceHex,
  sphereGradient,
  toHex,
} from "@/lib/services/construct/shading";
import {
  emitFragment,
  faceToPathData,
  countFragmentPathCommands,
} from "@/lib/services/construct/svgEmitter";
import { sanitizeSvg, renderArtwork } from "@/lib/services/svgRenderer";
import { translation4, normalize3 } from "@/lib/services/construct/math3d";
import type { Vec3 } from "@/lib/services/construct/types";

const ORTHO = { kind: "orthographic", zoom: 1 } as const;
const ISO = viewMatrix(CAMERA_PRESETS.isometric);

describe("projectAndSort — cube isometric", () => {
  const cube = { solidId: "cube", solidIndex: 0, mesh: boxMesh([100, 100, 100]) };

  it("đúng 3 mặt sống sót sau cull: top/front/right (az 45, el 35)", () => {
    const faces = projectAndSort([cube], ISO, ORTHO);
    expect(faces).toHaveLength(3);
    expect(faces.map((f) => f.label).sort()).toEqual(["front", "right", "top"]);
  });

  it("thứ tự vẽ deterministic, 2 lần chạy giống hệt", () => {
    const a = projectAndSort([cube], ISO, ORTHO).map((f) => f.label);
    const b = projectAndSort([cube], ISO, ORTHO).map((f) => f.label);
    expect(a).toEqual(b);
  });

  it("2 khối chồng dọc: khối xa (dưới) vẽ trước theo depth", () => {
    const low = { solidId: "low", solidIndex: 0, mesh: transformMesh(translation4([0, -100, 0]), boxMesh([80, 80, 80])) };
    const high = { solidId: "high", solidIndex: 1, mesh: transformMesh(translation4([0, 100, 0]), boxMesh([80, 80, 80])) };
    const faces = projectAndSort([low, high], ISO, ORTHO);
    // Mặt cuối (gần camera nhất) phải là của khối trên (y cao → z_view lớn trong iso)
    expect(faces[faces.length - 1].solidId).toBe("high");
  });

  it("overlapWarnings báo khi AABB giao nhau", () => {
    const a = { solidId: "a", solidIndex: 0, mesh: boxMesh([100, 100, 100]) };
    const b = { solidId: "b", solidIndex: 1, mesh: transformMesh(translation4([30, 0, 0]), boxMesh([100, 100, 100])) };
    const apart = { solidId: "c", solidIndex: 2, mesh: transformMesh(translation4([500, 0, 0]), boxMesh([10, 10, 10])) };
    const warnings = overlapWarnings([a, b, apart]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"a"');
    expect(warnings[0]).toContain('"b"');
  });
});

describe("shading", () => {
  it("parseHex/toHex roundtrip + dạng #rgb", () => {
    expect(parseHex("#F2E3C6")).toEqual({ r: 242, g: 227, b: 198 });
    expect(parseHex("#fff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHex("url(#x)")).toBeNull();
    expect(toHex({ r: 242, g: 227, b: 198 })).toBe("#f2e3c6");
  });

  it("lambert: mặt đối diện nguồn sáng = 1, vuông góc = 0", () => {
    const lightDown: Vec3 = [0, -1, 0]; // sáng rọi xuống
    expect(lambertFactor([0, 1, 0], lightDown)).toBeCloseTo(1, 10); // mặt ngửa lên
    expect(lambertFactor([1, 0, 0], lightDown)).toBeCloseTo(0, 10);
    expect(lambertFactor([0, -1, 0], lightDown)).toBe(0); // mặt úp — clamp 0
  });

  it("quantize: 3 tông → {0, 0.5, 1}; biên chia đều", () => {
    expect(quantizeFactor(0.9, 3)).toBe(1);
    expect(quantizeFactor(0.5, 3)).toBe(0.5);
    expect(quantizeFactor(0.2, 3)).toBe(0);
    expect(quantizeFactor(0.26, 3)).toBe(0.5); // > 0.25 → mức giữa
    const levels = new Set(
      Array.from({ length: 101 }, (_, i) => quantizeFactor(i / 100, 4)),
    );
    expect(levels.size).toBe(4);
  });

  it("luminance có ambient floor; applyLuminance scale + clamp", () => {
    expect(luminance(0, 0.3)).toBe(0.3);
    expect(luminance(1, 0.3)).toBe(1);
    expect(applyLuminance("#808080", 0.5)).toBe("#404040");
    expect(applyLuminance("#ffffff", 2)).toBe("#ffffff"); // clamp 255
  });

  it("shadeFaceHex quantized deterministic", () => {
    const light = { direction: normalize3([-0.5, -1, -0.35]) as Vec3, tones: 3, ambient: 0.3, mode: "quantized" as const };
    const a = shadeFaceHex("#F2E3C6", [0, 1, 0], light);
    expect(a).toBe(shadeFaceHex("#F2E3C6", [0, 1, 0], light));
  });

  it("sphereGradient: id prefix cg-, 3 stops, highlight lệch về nguồn sáng", () => {
    const light = { direction: [-0.5, -1, 0] as Vec3, tones: 3, ambient: 0.3, mode: "smooth" as const };
    const g = sphereGradient("ball", "#d94", light, [-0.45, -0.89]);
    expect(g.id).toBe("cg-ball");
    expect(g.stops).toHaveLength(3);
    expect(Number(g.attrs.fx)).toBeGreaterThan(0.5); // sáng từ trái-trên → fx lệch... hướng −x → fx = 0.5 − (−0.45)·0.25 > 0.5
  });
});

describe("svgEmitter", () => {
  const FACE = {
    points: [[0, 0], [100, 0], [100, 100], [0, 100]] as const,
    depth: 0,
    normal: [0, 0, 1] as Vec3,
    solidId: "s",
    solidIndex: 0,
    faceIndex: 0,
  };

  it("faceToPathData polygon + holes (evenodd subpaths)", () => {
    expect(faceToPathData(FACE, 1)).toBe("M 0 0 L 100 0 L 100 100 L 0 100 Z");
    const withHole = { ...FACE, holes: [[[40, 40], [60, 40], [60, 60], [40, 60]]] as const };
    const d = faceToPathData(withHole, 1);
    expect(d.match(/M /g)?.length).toBe(2);
    expect(d.match(/Z/g)?.length).toBe(2);
  });

  it("emitFragment qua sanitizeSvg('frame') — hợp lệ tuyệt đối", () => {
    const g = sphereGradient("b", "#d94", { direction: [0, -1, 0], tones: 3, ambient: 0.3, mode: "smooth" }, [0, -1]);
    const fragment = emitFragment(
      [g],
      [{ d: faceToPathData(FACE, 2), fill: "url(#cg-b)", fillRule: "evenodd", stroke: "#222", strokeWidth: 2 }],
      { at: [960, 540], scale: 1.5, rotate: 0 },
      2,
    );
    expect(() => sanitizeSvg(fragment, "frame")).not.toThrow();
    expect(fragment).toContain('transform="translate(960 540) scale(1.5)"');
  });

  it("chỉ emit element trong allowlist g/path/gradient/stop", () => {
    const fragment = emitFragment([], [{ d: "M 0 0 L 1 1 Z", fill: "#fff" }], { at: [0, 0], scale: 1, rotate: 0 }, 2);
    const tags = [...fragment.matchAll(/<([a-zA-Z]+)[\s>]/g)].map((m) => m[1]);
    for (const tag of tags) {
      expect(["g", "path", "linearGradient", "radialGradient", "stop"]).toContain(tag);
    }
  });

  it("escape attr chống injection qua fill/id", () => {
    const fragment = emitFragment([], [{ d: "M 0 0 Z", fill: '#fff" onload="x' }], { at: [0, 0], scale: 1, rotate: 0 }, 2);
    expect(fragment).not.toContain('onload="x');
  });

  it("countFragmentPathCommands", () => {
    const fragment = emitFragment([], [{ d: "M 0 0 L 1 1 L 2 2 Z", fill: "#fff" }], { at: [0, 0], scale: 1, rotate: 0 }, 2);
    expect(countFragmentPathCommands(fragment)).toBe(4);
  });
});

describe("PIXEL PROOF — cube isometric 3 tông render thật qua sharp", () => {
  it("mặt top sáng nhất, front vừa, right tối; render đúng hình", async () => {
    const cube = { solidId: "cube", solidIndex: 0, mesh: boxMesh([400, 400, 400]) };
    const faces = projectAndSort([cube], ISO, ORTHO);
    const lightView = viewNormal(ISO, normalize3(DEFAULT_LIGHT_DIRECTION));
    const light = { direction: lightView, tones: 3, ambient: 0.3, mode: "quantized" as const };

    const fills = new Map<string, string>();
    const paths = faces.map((f) => {
      const fill = shadeFaceHex("#e07b39", f.normal, light);
      fills.set(f.label!, fill);
      return { d: faceToPathData(f, 2), fill };
    });
    const fragment = emitFragment([], paths, { at: [960, 540], scale: 1, rotate: 0 }, 2);
    sanitizeSvg(fragment, "frame");

    // 3 mặt phải ra 3 tông khác nhau, top sáng nhất
    const lum = (hex: string) => {
      const c = parseHex(hex)!;
      return c.r + c.g + c.b;
    };
    expect(new Set(fills.values()).size).toBe(3);
    expect(lum(fills.get("top")!)).toBeGreaterThan(lum(fills.get("front")!));
    expect(lum(fills.get("front")!)).toBeGreaterThan(lum(fills.get("right")!));

    // Render PNG thật và soi pixel từng mặt
    const svg = `<rect width="1920" height="1080" fill="#101020"/>${fragment}`;
    const png = await renderArtwork(null, svg, "16:9", "1K");
    const raw = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => {
      // Toạ độ logical 1920×1080 → render 1024×576 (scale 8/15)
      const sx = Math.round((x * 1024) / 1920);
      const sy = Math.round((y * 576) / 1080);
      const i = (sy * raw.info.width + sx) * raw.info.channels;
      return raw.data[i] + raw.data[i + 1] + raw.data[i + 2];
    };
    // Top ở trên tâm, front dưới-trái, right dưới-phải (world x→phải, z→trái màn hình)
    const topPx = px(960, 540 - 200);
    const frontLeftPx = px(960 - 120, 540 + 120);
    const frontRightPx = px(960 + 120, 540 + 120);
    const bgPx = px(200, 200);
    expect(topPx).toBeGreaterThan(frontLeftPx);
    expect(topPx).toBeGreaterThan(frontRightPx);
    expect(frontLeftPx).not.toBe(frontRightPx); // 2 mặt bên khác tông
    expect(bgPx).toBeLessThan(150); // nền tối
  });
});
