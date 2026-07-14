import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { buildSilhouette } from "@/lib/services/construct/silhouette";
import { buildSolidEffects } from "@/lib/services/construct/effects";
import { boxMesh, extrudeMesh } from "@/lib/services/construct/geometry3d";
import { flattenToContours } from "@/lib/services/construct/geometry2d";
import { parsePathData } from "@/lib/services/construct/pathParse";
import { CAMERA_PRESETS, viewMatrix } from "@/lib/services/construct/camera";
import { compileConstruction } from "@/lib/services/construct/compile";
import { constructSpecSchema } from "@/lib/validation/constructSchema";
import { renderArtwork } from "@/lib/services/svgRenderer";

const ISO = viewMatrix(CAMERA_PRESETS.isometric);
const FRONT = viewMatrix(CAMERA_PRESETS.front);
const ORTHO = { kind: "orthographic", zoom: 1 } as const;

describe("silhouette — outline màn hình per solid", () => {
  it("box lồi dưới iso = hull lục giác 6 đỉnh", () => {
    const item = { solidId: "b", solidIndex: 0, mesh: boxMesh([100, 100, 100]), convex: true };
    const sil = buildSilhouette(item, ISO, ORTHO, 2)!;
    expect(sil).not.toBeNull();
    const points = sil.d.match(/[ML] /g)!;
    expect(points).toHaveLength(6);
    expect(sil.r).toBeGreaterThan(40);
    expect(Math.abs(sil.centroid[0])).toBeLessThan(1);
  });

  it("washer extrude (lõm, có lỗ) giữ 2 subpath — lỗ xuyên thấu", () => {
    const d = "M -50 -50 L 50 -50 L 50 50 L -50 50 Z M -20 -20 L -20 20 L 20 20 L 20 -20 Z";
    const contours = flattenToContours(parsePathData(d, "washer"), 8);
    const mesh = extrudeMesh(contours, 20);
    const item = { solidId: "w", solidIndex: 0, mesh, convex: false };
    const sil = buildSilhouette(item, FRONT, ORTHO, 2)!;
    expect(sil).not.toBeNull();
    expect(sil.d.match(/M /g)!.length).toBe(2);
  });

  it("deterministic: double build byte-identical", () => {
    const item = { solidId: "b", solidIndex: 0, mesh: boxMesh([80, 120, 60]), convex: true };
    expect(buildSilhouette(item, ISO, ORTHO, 2)!.d).toBe(buildSilhouette(item, ISO, ORTHO, 2)!.d);
  });
});

describe("effects — One Boolean Rule trên silhouette vuông", () => {
  // Silhouette tổng hợp: vuông [0,100]², R=50, sáng đi +x (nguồn TRÁI)
  const SIL = {
    d: "M 0 0 L 100 0 L 100 100 L 0 100 Z",
    minX: 0,
    minY: 0,
    maxX: 100,
    maxY: 100,
    r: 50,
    centroid: [50, 50] as const,
  };
  const L: readonly [number, number] = [1, 0];

  const xCoords = (d: string): number[] =>
    [...d.matchAll(/[ML] (-?[\d.]+) /g)].map((m) => Number(m[1]));

  it("formShadow nằm PHÍA KHUẤT (x lớn), gradient neo mép khuất", () => {
    const res = buildSolidEffects({
      solidId: "s",
      silhouette: SIL,
      lightScreen: L,
      effects: { formShadow: true, highlight: false, rim: false },
      baseFill: "#cc8844",
      precision: 2,
      seq: 0,
    });
    expect(res.over).toHaveLength(1);
    expect(res.warnings).toHaveLength(0);
    // shift 0.45·50 = 22.5 về nguồn (−x) → crescent = [77.5, 100]
    const xs = xCoords(res.over[0].d);
    expect(Math.min(...xs)).toBeGreaterThan(76);
    const g = res.gradients[0];
    expect(g.id).toBe("cg-e0");
    expect(g.attrs.gradientUnits).toBe("userSpaceOnUse");
    expect(Number(g.attrs.x1)).toBe(100); // mép khuất
    expect(g.stops[0].opacity).toBe(0.15);
    expect(g.stops[1].opacity).toBe(0);
    // Màu bóng default KHÔNG đen
    expect(g.stops[0].color).not.toBe("#000000");
  });

  it("highlight nằm PHÍA NGUỒN (x nhỏ), trục gradient đảo chiều", () => {
    const res = buildSolidEffects({
      solidId: "s",
      silhouette: SIL,
      lightScreen: L,
      effects: { formShadow: false, highlight: true, rim: false },
      baseFill: "#cc8844",
      precision: 2,
      seq: 5,
    });
    const xs = xCoords(res.over[0].d);
    expect(Math.max(...xs)).toBeLessThan(76);
    expect(res.gradients[0].id).toBe("cg-e5");
    expect(Number(res.gradients[0].attrs.x1)).toBe(0); // mép nguồn sáng
  });

  it("rim mỏng đúng bề rộng width·R ở mép khuất", () => {
    const res = buildSolidEffects({
      solidId: "s",
      silhouette: SIL,
      lightScreen: L,
      effects: { formShadow: false, highlight: false, rim: { width: 0.1, opacity: 0.5 } },
      baseFill: "#cc8844",
      precision: 2,
      seq: 0,
    });
    // width 0.1·50 = 5 → band [95, 100]
    const xs = xCoords(res.over[0].d);
    expect(Math.min(...xs)).toBeGreaterThan(94);
  });

  it("id cg-e<seq> cấp tuần tự qua nhiều effect", () => {
    const res = buildSolidEffects({
      solidId: "s",
      silhouette: SIL,
      lightScreen: L,
      effects: { formShadow: true, highlight: true, rim: true },
      baseFill: "#cc8844",
      precision: 2,
      seq: 0,
    });
    expect(res.gradients.map((g) => g.id)).toEqual(["cg-e0", "cg-e1", "cg-e2"]);
    expect(res.seqEnd).toBe(3);
    expect(res.over).toHaveLength(3);
  });

  it("ánh sáng chính diện (không có hướng màn hình) → skip + warning", () => {
    const res = buildSolidEffects({
      solidId: "s",
      silhouette: SIL,
      lightScreen: [0, 0],
      effects: { formShadow: true, highlight: false, rim: false },
      baseFill: "#cc8844",
      precision: 2,
      seq: 0,
    });
    expect(res.over).toHaveLength(0);
    expect(res.warnings.some((w) => w.includes("head-on"))).toBe(true);
  });
});

describe("effects — compile integration", () => {
  const BOX_SPEC = {
    version: 1,
    solids: [
      {
        id: "slab",
        type: "box",
        size: [400, 400, 20],
        fill: "#cc8844",
        shading: "none",
        effects: { formShadow: true },
      },
    ],
    camera: { preset: "front" },
    light: { direction: [1, -0.3, -1] },
  } as const;

  it("effect vẽ SAU mọi mặt của solid (decal entry cuối)", () => {
    const { svg, warnings } = compileConstruction(constructSpecSchema.parse(BOX_SPEC));
    expect(svg).toContain('fill="url(#cg-e0)"');
    const fills = [...svg.matchAll(/<path [^>]*fill="([^"]+)"/g)].map((m) => m[1]);
    expect(fills[fills.length - 1]).toBe("url(#cg-e0)");
    expect(warnings.some((w) => w.includes("overlay"))).toBe(false);
  });

  it("solid xuyên nhau + effects → warning overlay", () => {
    const { warnings, stats } = compileConstruction(
      constructSpecSchema.parse({
        version: 1,
        solids: [
          { id: "red", type: "box", size: [400, 100, 24], rotate: [0, 45, 0], fill: "#d64545", effects: { highlight: true } },
          { id: "blue", type: "box", size: [400, 100, 24], rotate: [0, -45, 0], fill: "#4573d6" },
        ],
        camera: { preset: "front" },
      }),
    );
    expect(stats.depthSplits).toBeGreaterThan(0);
    expect(warnings.some((w) => w.includes("per-solid overlays"))).toBe(true);
  });

  it("csg operand bị tiêu thụ khai effects → warning skip, không crash", () => {
    const { warnings } = compileConstruction(
      constructSpecSchema.parse({
        version: 1,
        solids: [
          { id: "a", type: "box", size: [100, 100, 100], effects: { rim: true } },
          { id: "b", type: "sphere", r: 70, segments: 8 },
          { id: "cut", type: "csg", op: "difference", of: ["a", "b"], fill: "#88aacc" },
        ],
      }),
    );
    expect(warnings.some((w) => w.includes('"a"') && w.includes("skipped"))).toBe(true);
  });

  it("vượt maxEffectPaths → CONSTRUCTION_INVALID kèm hint", () => {
    const solids = Array.from({ length: 33 }, (_, i) => ({
      id: `b${i}`,
      type: "box" as const,
      size: [50, 50, 50] as const,
      at: [i * 60 - 960, 0, 0] as const,
      effects: { formShadow: true, highlight: true, rim: true },
    }));
    expect(() =>
      compileConstruction(constructSpecSchema.parse({ version: 1, solids })),
    ).toThrowError(/max 96/);
  });

  it("deterministic: double compile full-effects byte-identical", () => {
    const spec = {
      version: 1,
      solids: [
        { id: "ball", type: "sphere", r: 120, segments: 16, fill: "#3a86c8", effects: { formShadow: true, highlight: true, rim: true } },
      ],
    } as const;
    const a = compileConstruction(constructSpecSchema.parse(spec));
    const b = compileConstruction(constructSpecSchema.parse(spec));
    expect(a.svg).toBe(b.svg);
  });

  it("PIXEL PROOF 1: formShadow — phía khuất tối hơn phía sáng; control tắt = đều nhau", async () => {
    const sample = async (spec: object) => {
      const { svg } = compileConstruction(constructSpecSchema.parse(spec));
      const png = await renderArtwork(null, `<rect width="1920" height="1080" fill="#101018"/>${svg}`, "16:9", "1K");
      const raw = await sharp(png).raw().toBuffer({ resolveWithObject: true });
      const px = (lx: number, ly: number) => {
        const x = Math.round((lx * 1024) / 1920);
        const y = Math.round((ly * 576) / 1080);
        return raw.data[(y * raw.info.width + x) * raw.info.channels];
      };
      return { left: px(960 - 170, 540), right: px(960 + 170, 540) };
    };

    const on = await sample({
      ...BOX_SPEC,
      solids: [{ ...BOX_SPEC.solids[0], effects: { formShadow: { opacity: 0.35 } } }],
    });
    // Nguồn sáng bên TRÁI (light đi +x) → phía phải KHUẤT → tối hơn
    expect(on.left - on.right).toBeGreaterThan(20);

    const off = await sample({
      ...BOX_SPEC,
      solids: [{ ...BOX_SPEC.solids[0], effects: undefined }],
    });
    expect(Math.abs(off.left - off.right)).toBeLessThan(3);
  });

  it("PIXEL PROOF 2: rim — MÉP khuất sáng hơn GIỮA vùng khuất", async () => {
    const { svg } = compileConstruction(
      constructSpecSchema.parse({
        ...BOX_SPEC,
        solids: [
          {
            ...BOX_SPEC.solids[0],
            effects: { rim: { width: 0.08, opacity: 0.9, color: "#ffffff" } },
          },
        ],
      }),
    );
    const png = await renderArtwork(null, `<rect width="1920" height="1080" fill="#101018"/>${svg}`, "16:9", "1K");
    const raw = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    const px = (lx: number, ly: number) => {
      const x = Math.round((lx * 1024) / 1920);
      const y = Math.round((ly * 576) / 1080);
      return raw.data[(y * raw.info.width + x) * raw.info.channels + 1]; // kênh G
    };
    // Face phải: mép x ≈ 960+200; rim band rộng 0.08·200=16 → sample 960+192
    const edge = px(960 + 192, 540);
    const mid = px(960 + 120, 540);
    expect(edge - mid).toBeGreaterThan(25);
  });
});
