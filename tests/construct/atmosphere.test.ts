import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { buildVignette, fadeHex } from "@/lib/services/construct/atmosphere";
import { applyAffine, invertAffine, placementToAffine } from "@/lib/services/construct/geometry2d";
import { parseHex, rgbToHsl } from "@/lib/services/construct/shading";
import { compileConstruction } from "@/lib/services/construct/compile";
import { constructSpecSchema } from "@/lib/validation/constructSchema";
import { renderArtwork } from "@/lib/services/svgRenderer";

const FADE = { color: "#9db4cc", strength: 1, desaturate: 0 };

describe("atmosphere — fadeHex + invertAffine", () => {
  it("t=0 giữ nguyên; t=1 strength=1 desaturate=0 = đúng màu fade", () => {
    expect(fadeHex("#cc4422", 0, FADE)).toBe("#cc4422");
    expect(fadeHex("#cc4422", 1, FADE)).toBe("#9db4cc");
  });

  it("desaturate kéo bão hoà xuống theo strength·t", () => {
    const faded = fadeHex("#cc2222", 1, { color: "#cc2222", strength: 1, desaturate: 1 });
    // mix về chính nó rồi desaturate 100% → xám
    expect(rgbToHsl(parseHex(faded)!).s).toBeLessThan(0.02);
  });

  it("invertAffine: roundtrip qua place {at, rotate 30, scale 0.5}", () => {
    const m = placementToAffine({ at: [960, 540], rotate: 30, scale: 0.5 });
    const inv = invertAffine(m);
    for (const p of [[0, 0], [1920, 0], [1920, 1080], [123.4, -56.7]] as const) {
      const back = applyAffine(m, applyAffine(inv, p));
      expect(back[0]).toBeCloseTo(p[0], 6);
      expect(back[1]).toBeCloseTo(p[1], 6);
    }
  });
});

describe("vignette — phủ đúng canvas dưới place transform", () => {
  it("4 góc path forward-map về đúng 4 góc canvas (rotate 30, scale 0.5)", () => {
    const place = { at: [700, 300] as const, rotate: 30, scale: 0.5 };
    const v = buildVignette(
      { color: "#101528", strength: 0.3, start: 0.55, size: [1920, 1080] },
      place,
      2,
    );
    const m = placementToAffine(place);
    const corners = [...v.path.d.matchAll(/[ML] (-?[\d.]+) (-?[\d.]+)/g)].map(
      (c) => applyAffine(m, [Number(c[1]), Number(c[2])]),
    );
    const expected = [
      [0, 0],
      [1920, 0],
      [1920, 1080],
      [0, 1080],
    ];
    corners.forEach((c, i) => {
      expect(c[0]).toBeCloseTo(expected[i][0], 0);
      expect(c[1]).toBeCloseTo(expected[i][1], 0);
    });
    // r = ½ đường chéo / scale
    expect(Number(v.gradient.attrs.r)).toBeCloseTo(Math.hypot(1920, 1080) / 2 / 0.5, 1);
    expect(v.gradient.stops[1].offset).toBe(0.55);
    expect(v.gradient.stops[2].opacity).toBe(0.3);
  });

  it("compile: vignette là path CUỐI CÙNG, id cg-vignette", () => {
    const { svg } = compileConstruction(
      constructSpecSchema.parse({
        version: 1,
        solids: [{ id: "b", type: "box", size: [200, 200, 200], fill: "#cc8844" }],
        shapes: [{ id: "haze", type: "rect", w: 1920, h: 300, at: [960, 900], fill: "#aabbcc", layer: "foreground" }],
        atmosphere: { vignette: {} },
      }),
    );
    const fills = [...svg.matchAll(/<path [^>]*fill="([^"]+)"/g)].map((m) => m[1]);
    expect(fills[fills.length - 1]).toBe("url(#cg-vignette)");
    // foreground 2D ngay TRƯỚC vignette, SAU mọi mặt solid
    expect(fills[fills.length - 2]).toBe("#aabbcc");
  });
});

describe("depthFade — compile", () => {
  const TWO_BOXES = {
    version: 1,
    solids: [
      { id: "far", type: "box", size: [200, 200, 200], at: [-300, 0, -400], fill: "#cc8844", shading: "none" },
      { id: "near", type: "box", size: [200, 200, 200], at: [300, 0, 300], fill: "#cc8844", shading: "none" },
    ],
    camera: { preset: "front" },
    atmosphere: { depthFade: { color: "#9db4cc", strength: 0.9, desaturate: 0.5 } },
  } as const;

  it("mặt XA ngả về màu fade hơn mặt gần (khoảng cách RGB)", () => {
    const { svg } = compileConstruction(constructSpecSchema.parse(TWO_BOXES));
    const fills = [...svg.matchAll(/<path [^>]*fill="(#[0-9a-f]{6})"/g)].map((m) => m[1]);
    expect(fills.length).toBe(2);
    // Painter order: xa vẽ trước
    const [farFill, nearFill] = fills;
    const dist = (hex: string) => {
      const a = parseHex(hex)!;
      const b = parseHex("#9db4cc")!;
      return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
    };
    expect(dist(farFill)).toBeLessThan(dist(nearFill) - 30);
    // Gần nhất (t=0) giữ NGUYÊN màu gốc
    expect(nearFill).toBe("#cc8844");
  });

  it("cảnh 1 lớp depth → no-op (fill giữ nguyên)", () => {
    const { svg } = compileConstruction(
      constructSpecSchema.parse({
        version: 1,
        solids: [{ id: "slab", type: "box", size: [400, 400, 10], fill: "#cc8844", shading: "none" }],
        camera: { preset: "front" },
        atmosphere: { depthFade: {} },
      }),
    );
    expect(svg).toContain('fill="#cc8844"');
  });

  it("gradient smooth cũng fade stops; gradient TÁC GIẢ giữ nguyên", () => {
    const { svg } = compileConstruction(
      constructSpecSchema.parse({
        version: 1,
        gradients: [
          {
            id: "sky",
            kind: "linear",
            stops: [
              { offset: 0, color: "#204080" },
              { offset: 1, color: "#80a0d0" },
            ],
          },
        ],
        shapes: [{ id: "bg", type: "rect", w: 1920, h: 1080, at: [960, 540], fill: "url(#sky)" }],
        solids: [
          { id: "ballFar", type: "sphere", r: 100, at: [-250, 0, -400], segments: 12, fill: "#cc4444" },
          { id: "boxNear", type: "box", size: [150, 150, 150], at: [250, 0, 300], fill: "#cc8844", shading: "none" },
        ],
        camera: { preset: "front" },
        atmosphere: { depthFade: { strength: 1, desaturate: 0 } },
      }),
    );
    // Gradient tác giả nguyên văn
    expect(svg).toContain('stop-color="#204080"');
    expect(svg).toContain('stop-color="#80a0d0"');
    // Gradient smooth của sphere xa KHÔNG còn stop màu gốc thuần
    const sphereGrad = svg.match(/<radialGradient id="cg-ballFar"[^>]*>(.*?)<\/radialGradient>/)![1];
    expect(sphereGrad).not.toContain('stop-color="#cc4444"');
  });

  it("deterministic: double compile byte-identical", () => {
    const a = compileConstruction(constructSpecSchema.parse(TWO_BOXES));
    const b = compileConstruction(constructSpecSchema.parse(TWO_BOXES));
    expect(a.svg).toBe(b.svg);
  });

  it("PIXEL PROOF 5: box xa nhạt về màu trời hơn box gần", async () => {
    const { svg } = compileConstruction(constructSpecSchema.parse(TWO_BOXES));
    const png = await renderArtwork(null, `<rect width="1920" height="1080" fill="#101018"/>${svg}`, "16:9", "1K");
    const raw = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    const px = (lx: number, ly: number) => {
      const x = Math.round((lx * 1024) / 1920);
      const y = Math.round((ly * 576) / 1080);
      const i = (y * raw.info.width + x) * raw.info.channels;
      return [raw.data[i], raw.data[i + 1], raw.data[i + 2]] as const;
    };
    const dist = (c: readonly [number, number, number]) =>
      Math.hypot(c[0] - 157, c[1] - 180, c[2] - 204); // #9db4cc
    const far = px(960 - 300, 540);
    const near = px(960 + 300, 540);
    expect(dist(far)).toBeLessThan(dist(near) - 30);
  });

  it("PIXEL PROOF 6: vignette góc tối hơn tâm; foreground DƯỚI vignette TRÊN solid", async () => {
    const { svg } = compileConstruction(
      constructSpecSchema.parse({
        version: 1,
        solids: [{ id: "b", type: "box", size: [300, 300, 300], fill: "#cc8844" }],
        // Shape vẽ trong hệ LOCAL của construction — place dời cả khối về tâm canvas
        shapes: [
          { id: "fog", type: "rect", w: 800, h: 400, fill: "#ee3344", layer: "foreground" },
        ],
        atmosphere: { vignette: { strength: 0.6 } },
      }),
    );
    const png = await renderArtwork(null, `<rect width="1920" height="1080" fill="#ffffff"/>${svg}`, "16:9", "1K");
    const raw = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    const px = (lx: number, ly: number) => {
      const x = Math.round((lx * 1024) / 1920);
      const y = Math.round((ly * 576) / 1080);
      const i = (y * raw.info.width + x) * raw.info.channels;
      return [raw.data[i], raw.data[i + 1], raw.data[i + 2]] as const;
    };
    // Góc: nền trắng + vignette 0.6 → tối rõ so với vùng trắng gần tâm
    const corner = px(15, 15);
    const centerEdge = px(960, 60); // trong vùng start (trong suốt)
    expect(centerEdge[0] - corner[0]).toBeGreaterThan(60);
    // Tâm khung: foreground đỏ PHỦ solid (không thấy #cc8844), còn vignette
    // trong suốt ở tâm → đúng màu đỏ
    const center = px(960, 540);
    expect(center[0]).toBeGreaterThan(200);
    expect(center[1]).toBeLessThan(120);
  });
});
