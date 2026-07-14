import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { buildSilhouette } from "@/lib/services/construct/silhouette";
import { buildContactShadow, buildSolidEffects } from "@/lib/services/construct/effects";
import { boxMesh, extrudeMesh } from "@/lib/services/construct/geometry3d";
import { flattenToContours } from "@/lib/services/construct/geometry2d";
import { parsePathData } from "@/lib/services/construct/pathParse";
import { CAMERA_PRESETS, viewMatrix } from "@/lib/services/construct/camera";
import { compileConstruction } from "@/lib/services/construct/compile";
import { constructSpecSchema, effectsSchema } from "@/lib/validation/constructSchema";
import { renderArtwork } from "@/lib/services/svgRenderer";

/** Parse partial effects qua schema — defaults false cho key vắng. */
const FX = (partial: object) => effectsSchema.parse(partial);

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
      effects: FX({ formShadow: true }),
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
      effects: FX({ highlight: true }),
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
      effects: FX({ rim: { width: 0.1, opacity: 0.5 } }),
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
      effects: FX({ formShadow: true, highlight: true, rim: true }),
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
      effects: FX({ formShadow: true }),
      baseFill: "#cc8844",
      precision: 2,
      seq: 0,
    });
    expect(res.over).toHaveLength(0);
    expect(res.warnings.some((w) => w.includes("head-on"))).toBe(true);
  });
});

describe("effects S3 — specular / coreAccent / glow / contact", () => {
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
  const base = (over: object) => ({
    solidId: "s",
    silhouette: SIL,
    lightScreen: L,
    baseFill: "#cc8844",
    precision: 2,
    seq: 0,
    effects: {
      formShadow: false as const,
      highlight: false as const,
      rim: false as const,
      coreAccent: false as const,
      specular: false as const,
      glow: false as const,
      contact: false as const,
      ...over,
    },
  });

  it("specular dịch VỀ nguồn sáng, clip trong S, radial trắng→trong", () => {
    const res = buildSolidEffects(base({ specular: { size: 0.2, offset: 0.6, opacity: 0.5 } }));
    expect(res.over).toHaveLength(1);
    // tâm x = 50 − 0.6·50 = 20, r = 10 → đĩa nằm [10, 30]
    const xs = xCoords(res.over[0].d);
    expect(Math.min(...xs)).toBeGreaterThan(9);
    expect(Math.max(...xs)).toBeLessThan(31);
    expect(res.gradients[0].kind).toBe("radialGradient");
    expect(res.gradients[0].stops[0].opacity).toBe(0.5);
    expect(res.gradients[0].stops[1].opacity).toBe(0);
  });

  it("coreAccent = dải giữa hai bản shift, fill phẳng có opacity", () => {
    const res = buildSolidEffects(base({ coreAccent: { from: 0.1, to: 0.45, opacity: 0.2 } }));
    expect(res.over).toHaveLength(1);
    // band = [100−22.5, 100−5] = [77.5, 95]
    const xs = xCoords(res.over[0].d);
    expect(Math.min(...xs)).toBeGreaterThan(76.5);
    expect(Math.max(...xs)).toBeLessThan(95.5);
    expect(res.gradients).toHaveLength(0); // flat — không tốn gradient
    expect(res.over[0].opacity).toBe(0.2);
    expect(res.over[0].fill).not.toBe("#000000");
  });

  it("glow halo: đĩa 1.6R SAU LƯNG (behind), 3 stop, không filter", () => {
    const res = buildSolidEffects(base({ glow: true }));
    expect(res.behind).toHaveLength(1);
    expect(res.over).toHaveLength(0);
    expect(res.filters).toHaveLength(0);
    const xs = xCoords(res.behind[0].d);
    expect(Math.min(...xs)).toBeLessThan(-25); // 50 − 80
    expect(res.gradients[0].stops).toHaveLength(3);
    // Default color = chính fill (vật tự phát sáng)
    expect(res.gradients[0].stops[0].color).toBe("#cc8844");
  });

  it("glow blur: bản sao S + feGaussianBlur, tính vào filters", () => {
    const res = buildSolidEffects(base({ glow: { mode: "blur", size: 1.6, opacity: 0.7 } }));
    expect(res.filters).toHaveLength(1);
    expect(res.filters[0].stdDeviation).toBeCloseTo(0.08 * 1.6 * 50);
    expect(res.behind[0].filter).toBe(`url(#${res.filters[0].id})`);
    expect(res.behind[0].d).toBe(SIL.d);
    expect(res.behind[0].opacity).toBe(0.7);
  });

  it("contact: ellipse trên ground dưới AABB, radial 3 stop, không filter", () => {
    const item = { solidId: "b", solidIndex: 0, mesh: boxMesh([100, 100, 100]), convex: true };
    const c = buildContactShadow({
      solidId: "b",
      mesh: item.mesh,
      view: ISO,
      projection: ORTHO,
      ground: -50,
      params: { opacity: 0.45, scale: 1 },
      precision: 2,
      seq: 3,
    });
    expect(c.path).not.toBeNull();
    expect(c.gradient!.id).toBe("cg-e3");
    expect(c.gradient!.stops[0].opacity).toBe(0.45);
    expect(c.gradient!.stops[2].opacity).toBe(0);
    expect(c.path!.d.match(/[ML] /g)!.length).toBe(24);
    expect(c.path!.filter).toBeUndefined();
    expect(c.seqEnd).toBe(4);
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

  it("vượt maxFilters (blur đắt) → CONSTRUCTION_INVALID hint dùng halo", () => {
    const solids = Array.from({ length: 7 }, (_, i) => ({
      id: `g${i}`,
      type: "sphere" as const,
      r: 40,
      segments: 8,
      at: [i * 100 - 300, 0, 0] as const,
      fill: "#ffcc66",
      effects: { glow: { mode: "blur" as const } },
    }));
    expect(() =>
      compileConstruction(constructSpecSchema.parse({ version: 1, solids })),
    ).toThrowError(/max 6/);
  });

  it("PIXEL PROOF 3: glow halo SAU LƯNG — sáng quanh vật, bị vật gần hơn CHE", async () => {
    const { svg } = compileConstruction(
      constructSpecSchema.parse({
        version: 1,
        solids: [
          {
            id: "lamp",
            type: "sphere",
            r: 80,
            segments: 16,
            at: [0, 0, -200],
            fill: "#ffcc66",
            effects: { glow: { size: 2.5, opacity: 1 } },
          },
          {
            id: "wall",
            type: "box",
            size: [200, 400, 20],
            at: [150, 0, 150],
            fill: "#446688",
            shading: "none",
          },
        ],
        camera: { preset: "front" },
      }),
    );
    const png = await renderArtwork(null, `<rect width="1920" height="1080" fill="#101018"/>${svg}`, "16:9", "1K");
    const raw = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    const px = (lx: number, ly: number) => {
      const x = Math.round((lx * 1024) / 1920);
      const y = Math.round((ly * 576) / 1080);
      const i = (y * raw.info.width + x) * raw.info.channels;
      return [raw.data[i], raw.data[i + 1], raw.data[i + 2]] as const;
    };
    // Ngoài silhouette (r=80) nhưng trong quầng (200): khác nền = có glow
    const halo = px(960 - 150, 540);
    expect(halo[0]).toBeGreaterThan(16 + 15); // nền R=16, quầng ấm cộng vào
    // Trên tường (gần camera hơn): đúng màu tường — glow nằm SAU
    const wall = px(960 + 150, 540);
    expect(Math.abs(wall[0] - 68)).toBeLessThanOrEqual(2);
    expect(Math.abs(wall[1] - 102)).toBeLessThanOrEqual(2);
    expect(Math.abs(wall[2] - 136)).toBeLessThanOrEqual(2);
  });

  it("PIXEL PROOF 4: contact làm TỐI nền ngay dưới vật (diff on/off)", async () => {
    const render = async (contact: boolean) => {
      const { svg } = compileConstruction(
        constructSpecSchema.parse({
          version: 1,
          solids: [
            {
              id: "crate",
              type: "box",
              size: [200, 200, 200],
              at: [0, 100, 0],
              fill: "#cc8844",
              effects: contact ? { contact: { opacity: 0.8 } } : undefined,
            },
          ],
        }),
      );
      const png = await renderArtwork(null, `<rect width="1920" height="1080" fill="#e8ecf2"/>${svg}`, "16:9", "1K");
      return sharp(png).raw().toBuffer({ resolveWithObject: true });
    };
    const on = await render(true);
    const off = await render(false);
    let darker = 0;
    let brighter = 0;
    for (let i = 0; i < on.data.length; i += on.info.channels) {
      if (on.data[i] < off.data[i] - 8) darker++;
      if (on.data[i] > off.data[i] + 8) brighter++;
    }
    // Contact chỉ LÀM TỐI (vẽ dưới vật, trên nền) — không làm sáng đâu cả
    expect(darker).toBeGreaterThan(200);
    expect(brighter).toBe(0);
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
