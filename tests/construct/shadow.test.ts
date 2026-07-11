import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { buildShadowLayer } from "@/lib/services/construct/shadow";
import { boxMesh, cylinderMesh, transformMesh } from "@/lib/services/construct/geometry3d";
import { csgOperation, prepareOperand } from "@/lib/services/construct/csg";
import { repairPolygons, repairedToMesh } from "@/lib/services/construct/meshRepair";
import { CAMERA_PRESETS, viewMatrix } from "@/lib/services/construct/camera";
import { translation4 } from "@/lib/services/construct/math3d";
import { relativeEps } from "@/lib/services/construct/plane3";
import { compileConstruction } from "@/lib/services/construct/compile";
import { constructSpecSchema } from "@/lib/validation/constructSchema";
import { renderArtwork, sanitizeSvg } from "@/lib/services/svgRenderer";

const ISO = viewMatrix(CAMERA_PRESETS.isometric);
const ORTHO = { kind: "orthographic", zoom: 1 } as const;
const BASE_SHADOW = { style: "silhouette", color: "#000000", opacity: 0.25, blur: 0, ground: 0 } as const;

describe("buildShadowLayer", () => {
  const box = (y: number) => ({
    solidId: "b",
    solidIndex: 0,
    mesh: transformMesh(translation4([0, y, 0]), boxMesh([100, 100, 100])),
  });

  it("silhouette: 1 path màu shadow + opacity, không gradient/filter", () => {
    const layer = buildShadowLayer([box(50)], [-0.3, -1.7, -1], ISO, ORTHO, BASE_SHADOW, 2);
    expect(layer.paths).toHaveLength(1);
    expect(layer.paths[0].fill).toBe("#000000");
    expect(layer.paths[0].opacity).toBe(0.25);
    expect(layer.paths[0].filter).toBeUndefined();
    expect(layer.gradients).toHaveLength(0);
    expect(layer.filters).toHaveLength(0);
  });

  it("ánh sáng gần ngang → skip + warning", () => {
    const layer = buildShadowLayer([box(50)], [1, 1e-9, 0], ISO, ORTHO, BASE_SHADOW, 2);
    expect(layer.paths).toHaveLength(0);
    expect(layer.warnings[0]).toContain("horizontal");
  });

  it("blur > 0 → FilterDescriptor + filter ref trên path", () => {
    const layer = buildShadowLayer(
      [box(50)],
      [-0.3, -1.7, -1],
      ISO,
      ORTHO,
      { ...BASE_SHADOW, blur: 6 },
      2,
    );
    expect(layer.filters).toHaveLength(1);
    expect(layer.filters[0].stdDeviation).toBe(6);
    expect(layer.paths[0].filter).toBe("url(#cg-blur-shadow)");
  });

  it("blob: gradient radial chung + 1 path/solid", () => {
    const layer = buildShadowLayer(
      [box(50), { ...box(50), solidId: "c", solidIndex: 1, mesh: transformMesh(translation4([300, 50, 0]), boxMesh([80, 80, 80])) }],
      [-0.3, -1.7, -1],
      ISO,
      ORTHO,
      { ...BASE_SHADOW, style: "blob" },
      2,
    );
    expect(layer.gradients).toHaveLength(1);
    expect(layer.gradients[0].id).toBe("cg-shadow-blob");
    expect(layer.paths).toHaveLength(2);
    expect(layer.paths[0].fill).toBe("url(#cg-shadow-blob)");
  });

  it("long: bóng quét dài hơn hẳn silhouette theo hướng sáng", () => {
    const sil = buildShadowLayer([box(50)], [-1, -1, 0], ISO, ORTHO, BASE_SHADOW, 2);
    const long = buildShadowLayer([box(50)], [-1, -1, 0], ISO, ORTHO, { ...BASE_SHADOW, style: "long", longLength: 400 }, 2);
    const width = (d: string) => {
      const xs = [...d.matchAll(/[ML] (-?[\d.]+)/g)].map((m) => Number(m[1]));
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(width(long.paths[0].d)).toBeGreaterThan(width(sil.paths[0].d) + 100);
  });

  it("WASHER đổ bóng CÓ LỖ (union per-face, không phải convex hull)", () => {
    const eps = relativeEps(100);
    const outer = prepareOperand(cylinderMesh(40, 16, 16), { solidId: "o", solidIndex: 0 }, eps).polygons;
    const inner = prepareOperand(cylinderMesh(20, 20, 16), { solidId: "i", solidIndex: 1 }, eps).polygons;
    const { polygons } = csgOperation("difference", outer, inner, eps, "washer");
    const washerMesh = repairedToMesh(repairPolygons(polygons, eps));
    // Nâng washer lên khỏi đất để bóng tách biệt
    const item = {
      solidId: "washer",
      solidIndex: 0,
      mesh: transformMesh(translation4([0, 60, 0]), washerMesh),
    };
    // Ánh sáng thẳng đứng → bóng là hình chiếu vành khuyên
    const layer = buildShadowLayer([item], [0, -1, 0], ISO, ORTHO, BASE_SHADOW, 2);
    expect(layer.paths).toHaveLength(1);
    // Path có ÍT NHẤT 2 subpath (ring ngoài + lỗ)
    const subpaths = layer.paths[0].d.match(/M /g)?.length ?? 0;
    expect(subpaths).toBeGreaterThanOrEqual(2);
  });

  it("deterministic: double-run identical", () => {
    const run = () => buildShadowLayer([box(50)], [-0.3, -1.7, -1], ISO, ORTHO, BASE_SHADOW, 2);
    expect(run()).toEqual(run());
  });
});

describe("compile với shadow", () => {
  const SPEC = {
    version: 1,
    solids: [{ id: "cube", type: "box", size: [200, 200, 200], at: [0, 100, 0], fill: "#e07b39" }],
    shadow: {},
    place: { at: [960, 560] },
  } as const;

  it("shadow bật qua spec — path bóng đứng TRƯỚC mặt 3D, pass sanitizer", () => {
    const result = compileConstruction(constructSpecSchema.parse(SPEC));
    expect(() => sanitizeSvg(result.svg, "frame")).not.toThrow();
    // Path đầu tiên (sau gradient) là bóng đen opacity
    const firstPath = result.svg.match(/<path [^>]+/)?.[0] ?? "";
    expect(firstPath).toContain('fill="#000000"');
    expect(firstPath).toContain('opacity="0.25"');
  });

  it("blur emit <filter> + feGaussianBlur pass sanitizer", () => {
    const result = compileConstruction(
      constructSpecSchema.parse({ ...SPEC, shadow: { blur: 8 } }),
    );
    expect(result.svg).toContain("<filter id=\"cg-blur-shadow\"");
    expect(result.svg).toContain("feGaussianBlur");
    expect(result.svg).toContain('filter="url(#cg-blur-shadow)"');
    expect(() => sanitizeSvg(result.svg, "frame")).not.toThrow();
  });

  it("per-solid opt-out shadow:false", () => {
    const result = compileConstruction(
      constructSpecSchema.parse({
        ...SPEC,
        solids: [{ ...SPEC.solids[0], shadow: false }],
      }),
    );
    const firstPath = result.svg.match(/<path [^>]+/)?.[0] ?? "";
    expect(firstPath).not.toContain('opacity="0.25"');
  });

  it("PIXEL PROOF: nền dưới khối tối hơn nền xa", async () => {
    // Ánh sáng nghiêng +x+z → bóng hắt về trước-phải, trên màn hình là
    // thẳng xuống dưới khối (screen +x và +z triệt tiêu ngang, cộng dọc)
    const { svg } = compileConstruction(
      constructSpecSchema.parse({
        ...SPEC,
        light: { direction: [1.2, -1.7, 0.8] },
      }),
    );
    const png = await renderArtwork(
      null,
      `<rect width="1920" height="1080" fill="#9ad08a"/>${svg}`,
      "16:9",
      "1K",
    );
    const raw = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    const lum = (lx: number, ly: number) => {
      const x = Math.round((lx * 1024) / 1920);
      const y = Math.round((ly * 576) / 1080);
      const i = (y * raw.info.width + x) * raw.info.channels;
      return raw.data[i] + raw.data[i + 1] + raw.data[i + 2];
    };
    // Bóng ngay dưới chân khối trên màn hình (giữa vùng bóng)
    const shadowArea = lum(960, 560 + 130);
    const farBackground = lum(300, 200);
    expect(shadowArea, `shadow=${shadowArea} far=${farBackground}`).toBeLessThan(farBackground - 60);
  });

  it("determinism: double-compile byte-identical với shadow", () => {
    const spec = constructSpecSchema.parse(SPEC);
    expect(compileConstruction(spec).svg).toBe(compileConstruction(spec).svg);
  });
});
