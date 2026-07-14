import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { compileConstruction } from "@/lib/services/construct/compile";
import { constructSpecSchema, gradientSchema } from "@/lib/validation/constructSchema";
import {
  authorGradient,
  hslToRgb,
  mixRgb,
  multiplyRgb,
  parseHex,
  rgbToHsl,
  screenRgb,
  shiftHueToward,
  softShadowColor,
  toHex,
} from "@/lib/services/construct/shading";
import { renderArtwork } from "@/lib/services/svgRenderer";

describe("gradients[] — schema", () => {
  const stops = [
    { offset: 0, color: "#ffffff" },
    { offset: 1, color: "#223355" },
  ];

  it("id prefix cg- bị chặn", () => {
    const r = gradientSchema.safeParse({ id: "cg-sky", kind: "linear", stops });
    expect(r.success).toBe(false);
  });

  it("fill url(#cg-…) bị chặn ở mọi fillColor", () => {
    const r = constructSpecSchema.safeParse({
      version: 1,
      shapes: [{ id: "bg", type: "rect", w: 100, h: 100, fill: "url(#cg-anything)" }],
    });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain("engine-reserved");
  });

  it("stops phải non-decreasing, 2-16 stop", () => {
    expect(
      gradientSchema.safeParse({
        id: "g",
        kind: "linear",
        stops: [
          { offset: 0.8, color: "#fff" },
          { offset: 0.2, color: "#000" },
        ],
      }).success,
    ).toBe(false);
    expect(
      gradientSchema.safeParse({ id: "g", kind: "linear", stops: [stops[0]] }).success,
    ).toBe(false);
    expect(
      gradientSchema.safeParse({
        id: "g",
        kind: "linear",
        stops: Array.from({ length: 17 }, (_, i) => ({ offset: i / 16, color: "#fff" })),
      }).success,
    ).toBe(false);
  });

  it("duplicate id giữa gradient và shape → CONSTRUCTION_INVALID", () => {
    const spec = constructSpecSchema.parse({
      version: 1,
      shapes: [{ id: "sky", type: "rect", w: 100, h: 100 }],
      gradients: [{ id: "sky", kind: "linear", stops }],
    });
    expect(() => compileConstruction(spec)).toThrowError(/Duplicate id "sky"/);
  });
});

describe("authorGradient — angle/focus → attrs", () => {
  const stops = [
    { offset: 0, color: "#ffffff" },
    { offset: 1, color: "#000000" },
  ];

  it("linear angle 90 (default) = trên → dưới", () => {
    const g = authorGradient(
      gradientSchema.parse({ id: "sky", kind: "linear", stops }),
    );
    expect(g.kind).toBe("linearGradient");
    expect(g.attrs).toEqual({ x1: "0.500", y1: "0.000", x2: "0.500", y2: "1.000" });
  });

  it("linear angle 0 = trái → phải", () => {
    const g = authorGradient(
      gradientSchema.parse({ id: "sun", kind: "linear", angle: 0, stops }),
    );
    expect(g.attrs).toEqual({ x1: "0.000", y1: "0.500", x2: "1.000", y2: "0.500" });
  });

  it("radial focus + radius", () => {
    const g = authorGradient(
      gradientSchema.parse({ id: "glow", kind: "radial", focus: [-0.2, 0.1], radius: 0.8, stops }),
    );
    expect(g.kind).toBe("radialGradient");
    expect(g.attrs).toEqual({ cx: "0.5", cy: "0.5", r: "0.800", fx: "0.300", fy: "0.600" });
  });
});

describe("color math (Softness)", () => {
  it("rgb ↔ hsl roundtrip trong ±1/255", () => {
    for (const hex of ["#d64545", "#4573d6", "#efe6d2", "#123456", "#00ff88"]) {
      const rgb = parseHex(hex)!;
      const back = hslToRgb(rgbToHsl(rgb));
      expect(Math.abs(back.r - rgb.r)).toBeLessThan(1.5);
      expect(Math.abs(back.g - rgb.g)).toBeLessThan(1.5);
      expect(Math.abs(back.b - rgb.b)).toBeLessThan(1.5);
    }
  });

  it("shiftHueToward đi cung NGẮN nhất và bị cap", () => {
    // 10→230: lên = 220°, xuống qua wrap = 140° → đi xuống
    expect(shiftHueToward(10, 230, 25)).toBe(345);
    expect(shiftHueToward(350, 230, 25)).toBe(325); // đi xuống
    expect(shiftHueToward(150, 230, 25)).toBe(175); // đi lên
    expect(shiftHueToward(220, 230, 25)).toBe(230); // tới nơi, không vượt
  });

  it("multiply/screen đúng công thức", () => {
    const a = { r: 200, g: 100, b: 50 };
    const b = { r: 128, g: 255, b: 0 };
    expect(multiplyRgb(a, b)).toEqual({ r: (200 * 128) / 255, g: 100, b: 0 });
    expect(screenRgb(a, b).b).toBeCloseTo(50);
    expect(screenRgb(a, b).g).toBe(255);
  });

  it("mixRgb lerp", () => {
    expect(mixRgb({ r: 0, g: 0, b: 0 }, { r: 100, g: 200, b: 50 }, 0.5)).toEqual({ r: 50, g: 100, b: 25 });
  });

  it("softShadowColor: KHÔNG #000, tối hơn base, hue kéo về lạnh", () => {
    const base = "#d6a545"; // vàng ấm (h≈40)
    const shadow = softShadowColor(base);
    expect(shadow).not.toBe("#000000");
    const bHsl = rgbToHsl(parseHex(base)!);
    const sHsl = rgbToHsl(parseHex(shadow)!);
    expect(sHsl.l).toBeLessThan(bHsl.l);
    // hue xoay về 230 (cung ngắn từ 40 là đi... 40→230 delta -170 hoặc +190;
    // shortest arc = -170 → hue GIẢM về phía 230 qua đỏ? Không: từ 40 xuống
    // 230 theo cung ngắn là 40 → 15 (−25). Chỉ assert đã DỊCH về phía 230.
    const dist = (h: number) => Math.min(Math.abs(h - 230), 360 - Math.abs(h - 230));
    expect(dist(sHsl.h)).toBeLessThan(dist(bHsl.h));
    // Xám thuần không có hue → nhận hue lạnh luôn
    const grey = softShadowColor("#888888");
    const gHsl = rgbToHsl(parseHex(grey)!);
    expect(dist(gHsl.h)).toBeLessThan(5);
    expect(gHsl.s).toBeGreaterThan(0.1);
  });

  it("toHex clamp", () => {
    expect(toHex({ r: 300, g: -5, b: 128 })).toBe("#ff0080");
  });
});

describe("gradients[] — compile integration", () => {
  const SPEC = {
    version: 1,
    gradients: [
      {
        id: "glow",
        kind: "radial",
        stops: [
          { offset: 0, color: "#ffffff" },
          { offset: 1, color: "#101830" },
        ],
      },
    ],
    shapes: [{ id: "orb", type: "circle", r: 200, at: [960, 540], fill: "url(#glow)" }],
    place: { at: [0, 0] },
  } as const;

  it("gradient tác giả emit ĐẦU fragment, fill resolve nội bộ, không warning", () => {
    const { svg, warnings } = compileConstruction(constructSpecSchema.parse(SPEC));
    expect(svg).toContain('<radialGradient id="glow"');
    expect(svg).toContain('fill="url(#glow)"');
    expect(svg.indexOf("<radialGradient")).toBeLessThan(svg.indexOf("<path"));
    expect(warnings).toHaveLength(0);
  });

  it("url(#id) không khớp gradient nào → warning, không error", () => {
    const { warnings } = compileConstruction(
      constructSpecSchema.parse({
        version: 1,
        shapes: [{ id: "orb", type: "circle", r: 100, fill: "url(#fromDefs)" }],
      }),
    );
    expect(warnings.some((w) => w.includes('url(#fromDefs)'))).toBe(true);
  });

  it("deterministic: double compile byte-identical", () => {
    const a = compileConstruction(constructSpecSchema.parse(SPEC));
    const b = compileConstruction(constructSpecSchema.parse(SPEC));
    expect(a.svg).toBe(b.svg);
  });

  it("PIXEL PROOF: radial gradient khai trong spec render ra ramp thật", async () => {
    const { svg } = compileConstruction(constructSpecSchema.parse(SPEC));
    const png = await renderArtwork(
      null,
      `<rect width="1920" height="1080" fill="#050508"/>${svg}`,
      "16:9",
      "1K",
    );
    const raw = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    const px = (lx: number, ly: number) => {
      const x = Math.round((lx * 1024) / 1920);
      const y = Math.round((ly * 576) / 1080);
      const i = (y * raw.info.width + x) * raw.info.channels;
      return [raw.data[i], raw.data[i + 1], raw.data[i + 2]] as const;
    };
    const center = px(960, 540); // tâm ramp → trắng
    const edge = px(960 + 180, 540); // gần mép circle → tối
    expect(center[0]).toBeGreaterThan(200);
    // Ramp thật: tâm sáng hơn mép rõ rệt
    expect(center[0] - edge[0]).toBeGreaterThan(80);
    // Mép vẫn là màu gradient (xanh đêm), không phải nền
    expect(edge[2]).toBeGreaterThan(edge[0]);
  });
});
