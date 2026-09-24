import { CONSTRUCT_LIMITS } from "@/lib/config/limits";
import { describe, expect, it } from "vitest";
import { compileConstruction } from "@/lib/services/construct/compile";
import { constructSpecSchema } from "@/lib/validation/constructSchema";
import { CART_SPEC } from "./exampleSpecs";

describe("finish presets — rewrite thuần, chỉ điền field vắng", () => {
  const TWO = {
    version: 1,
    solids: [
      { id: "crate", type: "box", size: [200, 200, 200], at: [0, 100, 0], fill: "#cc8844" },
      { id: "ball", type: "sphere", r: 90, at: [260, 90, 0], segments: 16, fill: "#3a86c8" },
    ],
    shadow: { ground: 0 },
    light: { direction: [1, -1.5, -0.8] },
  } as const;

  it('soft ≡ spec khai tay {formShadow, highlight, contact} BYTE-IDENTICAL', () => {
    const preset = compileConstruction(
      constructSpecSchema.parse({ ...TWO, finish: "soft" }),
    );
    const manual = compileConstruction(
      constructSpecSchema.parse({
        ...TWO,
        solids: TWO.solids.map((s) => ({
          ...s,
          effects: { formShadow: true, highlight: true, contact: true },
        })),
      }),
    );
    expect(preset.svg).toBe(manual.svg);
    expect(preset.stats.effectPaths).toBeGreaterThan(0);
  });

  it('flat (default) ≡ không finish — không sinh effect nào', () => {
    const plain = compileConstruction(constructSpecSchema.parse(TWO));
    const flat = compileConstruction(constructSpecSchema.parse({ ...TWO, finish: "flat" }));
    expect(flat.svg).toBe(plain.svg);
    expect(flat.stats.effectPaths).toBe(0);
    expect(plain.svg).not.toContain("cg-e");
  });

  it('effects: {} = opt-out per solid — preset không đụng', () => {
    const { svg } = compileConstruction(
      constructSpecSchema.parse({
        ...TWO,
        finish: "soft",
        solids: [
          { ...TWO.solids[0], effects: {} },
          TWO.solids[1],
        ],
      }),
    );
    // Ball vẫn có effects; crate không có gradient effect NÀO của riêng nó
    // — đếm: ball soft = formShadow + highlight (2 gradient) + contact (1)
    const effectGradients = svg.match(/id="cg-e\d+"/g) ?? [];
    expect(effectGradients.length).toBe(3);
  });

  it("premium: solid trơn thêm specular, box thì không; vignette tự thêm khi atmosphere vắng", () => {
    const premium = compileConstruction(
      constructSpecSchema.parse({ ...TWO, finish: "premium" }),
    );
    expect(premium.svg).toContain('id="cg-vignette"');
    // Đối chiếu tay: box (formShadow+highlight+rim+contact = 3 gradient + 1 contact),
    // sphere thêm specular → premium ≡ manual từng solid
    const manual = compileConstruction(
      constructSpecSchema.parse({
        ...TWO,
        atmosphere: {
          vignette: { color: "#101528", strength: 0.25, start: 0.55, size: [1920, 1080] },
        },
        solids: [
          { ...TWO.solids[0], effects: { formShadow: true, highlight: true, rim: true, contact: true } },
          { ...TWO.solids[1], effects: { formShadow: true, highlight: true, rim: true, specular: true, contact: true } },
        ],
      }),
    );
    expect(premium.svg).toBe(manual.svg);
  });

  it("premium KHÔNG đè atmosphere author đã khai", () => {
    const { svg } = compileConstruction(
      constructSpecSchema.parse({
        ...TWO,
        finish: "premium",
        atmosphere: { depthFade: {} },
      }),
    );
    expect(svg).not.toContain("cg-vignette");
  });

  it("preset không đụng light/shadow: đổi finish không đổi shadow layer", () => {
    const flat = compileConstruction(constructSpecSchema.parse(TWO));
    const soft = compileConstruction(constructSpecSchema.parse({ ...TWO, finish: "soft" }));
    // Path bóng (fill #000000 opacity) giống hệt nhau ở hai bản
    const shadowOf = (svg: string) =>
      [...svg.matchAll(/<path [^>]*fill="#000000"[^>]*\/>/g)].map((m) => m[0]);
    expect(shadowOf(soft.svg)).toEqual(shadowOf(flat.svg));
    expect(shadowOf(flat.svg).length).toBeGreaterThan(0);
  });

  it("vượt budget bằng PRESET → degrade mềm + warning (không error)", () => {
    const solids = Array.from({ length: 40 }, (_, i) => ({
      id: `b${i}`,
      type: "box" as const,
      size: [50, 50, 50] as const,
      at: [(i % 8) * 100 - 350, Math.floor(i / 8) * 100, 0] as const,
      fill: "#cc8844",
    }));
    const result = compileConstruction(
      constructSpecSchema.parse({ version: 1, solids, finish: "soft" }),
    );
    expect(result.stats.effectPaths).toBeLessThanOrEqual(96);
    expect(result.warnings.some((w) => w.includes("effect budget"))).toBe(true);
  });

  it("PERF: finish premium trên cart hero ≤ 2× flat (đo xen kẽ), không error", () => {
    // Ngưỡng TƯƠNG ĐỐI: đo premium xen kẽ với flat trên CÙNG scene — tải
    // CPU (suite chạy song song) làm chậm cả hai như nhau, nên chỉ hồi quy
    // thật của effects layer mới làm tỉ lệ vượt ngưỡng (đo cô lập ≈ 1.25×)
    const spec = (finish: "flat" | "premium") => constructSpecSchema.parse({ ...CART_SPEC, finish });
    compileConstruction(spec("flat"));
    compileConstruction(spec("premium"));
    const flat: number[] = [];
    const premium: number[] = [];
    let last = compileConstruction(spec("premium"));
    for (let i = 0; i < 3; i++) {
      flat.push(compileConstruction(spec("flat")).stats.compileMs);
      last = compileConstruction(spec("premium"));
      premium.push(last.stats.compileMs);
    }
    expect(Math.min(...premium)).toBeLessThan(Math.min(...flat) * 2);
    // Trần tuyệt đối = guard compile của engine (không bao giờ được chạm)
    expect(Math.min(...premium)).toBeLessThan(CONSTRUCT_LIMITS.maxCompileMs);
    expect(last.stats.effectPaths).toBeGreaterThan(0);
    expect(last.stats.effectPaths).toBeLessThanOrEqual(96);
  }, 60_000);

  it("stats.filters đếm shadow.blur + glow blur", () => {
    const { stats } = compileConstruction(
      constructSpecSchema.parse({
        version: 1,
        solids: [
          {
            id: "lamp",
            type: "sphere",
            r: 60,
            segments: 12,
            fill: "#ffcc66",
            effects: { glow: { mode: "blur" } },
          },
        ],
        shadow: { ground: -100, blur: 4 },
      }),
    );
    expect(stats.filters).toBe(2);
    expect(stats.effectPaths).toBe(1);
  });
});
