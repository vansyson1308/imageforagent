import { describe, expect, it } from "vitest";
import { applyEase, cubicBezier } from "@/lib/services/motion/easing";
import { mixColor, sampleKeys } from "@/lib/services/motion/interpolate";
import { readTarget, writeTarget } from "@/lib/services/motion/targetPath";
import { evaluateMotionAt, prepareMotion } from "@/lib/services/motion/evaluate";
import { composeMotionFrame, createMotionCompiler } from "@/lib/services/motion/compileMotion";
import { fbm1D } from "@/lib/services/motion/noise";
import { constructSpecSchema } from "@/lib/validation/constructSchema";
import { motionSpecSchema, type Key } from "@/lib/validation/motionSchema";
import { sanitizeSvg } from "@/lib/services/svgRenderer";
import { AppError } from "@/lib/services/apiError";

const scene = (extra: Record<string, unknown> = {}) => ({
  version: 1,
  solids: [
    { id: "ball", type: "sphere", r: 40, at: [0, 40, 0], fill: "#e74c3c" },
    { id: "floor", type: "box", size: [600, 10, 600], at: [0, -5, 0], fill: "#88aa66" },
  ],
  ...extra,
});

const motion = (m: Record<string, unknown>) =>
  motionSpecSchema.parse({ version: 1, duration: 1, scene: scene(), ...m });

function expectConstructError(fn: () => unknown, re: RegExp) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).code).toBe("CONSTRUCTION_INVALID");
    expect(`${(e as AppError).message} ${(e as AppError).hint}`).toMatch(re);
    return;
  }
  throw new Error("expected CONSTRUCTION_INVALID");
}

describe("easing", () => {
  it("mọi easing đi từ 0 tới 1", () => {
    for (const e of ["linear", "in", "out", "inOut", "inBack", "outBack", "outElastic", "outBounce", "smooth"] as const) {
      expect(applyEase(e, 0)).toBeCloseTo(0, 6);
      expect(applyEase(e, 1)).toBeCloseTo(1, 6);
    }
  });
  it("inOut đối xứng quanh 0.5; outBack vượt 1 (overshoot)", () => {
    expect(applyEase("inOut", 0.5)).toBeCloseTo(0.5, 9);
    expect(applyEase("inOut", 0.25) + applyEase("inOut", 0.75)).toBeCloseTo(1, 9);
    expect(Math.max(...[0.6, 0.7, 0.8].map((u) => applyEase("outBack", u)))).toBeGreaterThan(1);
  });
  it("step giữ giá trị trước cho tới đúng key", () => {
    expect(applyEase("step", 0.99)).toBe(0);
    expect(applyEase("step", 1)).toBe(1);
  });
  it("cubic-bezier: (0,0,1,1) = linear; ease CSS (.25,.1,.25,1) tăng đơn điệu", () => {
    for (const u of [0.1, 0.33, 0.5, 0.9]) expect(cubicBezier(0, 0, 1, 1, u)).toBeCloseTo(u, 5);
    let prev = -1;
    for (let u = 0; u <= 1; u += 0.05) {
      const y = cubicBezier(0.25, 0.1, 0.25, 1, u);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = y;
    }
  });
});

describe("interpolate", () => {
  const keys: Key[] = [
    { t: 0, v: 0 },
    { t: 1, v: 10, ease: "linear" },
    { t: 2, v: 30, ease: "linear" },
  ];
  it("hold trước key đầu và sau key cuối", () => {
    expect(sampleKeys(keys, -1)).toBe(0);
    expect(sampleKeys(keys, 5)).toBe(30);
  });
  it("linear giữa key; ease của key ĐÍCH điều khiển đoạn", () => {
    expect(sampleKeys(keys, 0.5)).toBeCloseTo(5, 9);
    expect(sampleKeys(keys, 1.5)).toBeCloseTo(20, 9);
    const eased = sampleKeys([{ t: 0, v: 0 }, { t: 1, v: 10, ease: "in" }], 0.5) as number;
    expect(eased).toBeCloseTo(1.25, 9); // 0.5³·10
  });
  it("vector nội suy từng thành phần", () => {
    expect(sampleKeys([{ t: 0, v: [0, 0, 0] }, { t: 1, v: [10, 20, -30], ease: "linear" }], 0.5)).toEqual([5, 10, -15]);
  });
  it("smooth (Catmull-Rom) đi QUA key và không khựng tại key giữa", () => {
    const k: Key[] = [
      { t: 0, v: 0 },
      { t: 1, v: 10, ease: "smooth" },
      { t: 2, v: 20, ease: "smooth" },
    ];
    expect(sampleKeys(k, 1)).toBeCloseTo(10, 9);
    const h = 1e-4;
    const vLeft = ((sampleKeys(k, 1) as number) - (sampleKeys(k, 1 - h) as number)) / h;
    const vRight = ((sampleKeys(k, 1 + h) as number) - (sampleKeys(k, 1) as number)) / h;
    expect(vLeft).toBeCloseTo(vRight, 1);
    expect(vLeft).toBeGreaterThan(5); // inOut sẽ ~0 tại key giữa — smooth thì không
  });
  it("màu nội suy linear-light, endpoints chính xác", () => {
    expect(mixColor("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mixColor("#000000", "#ffffff", 1)).toBe("#ffffff");
    // Trung điểm linear-light sáng hơn trung bình sRGB (#808080 → ~#bcbcbc)
    expect(mixColor("#000000", "#ffffff", 0.5)).toBe("#bcbcbc");
    expect(mixColor("#f00", "#00f", 2)).toBe("#0000ff"); // overshoot clamp
  });
});

describe("targetPath", () => {
  const spec = () =>
    constructSpecSchema.parse(
      scene({ parts: [{ id: "hero", type: "figure", pose: { elbowL: -30 } }] }),
    );
  it("đọc/ghi field, component theo index", () => {
    const s = spec();
    expect(readTarget(s, "solids.ball.at")).toEqual([0, 40, 0]);
    expect(readTarget(s, "solids.ball.at.1")).toBe(40);
    writeTarget(s, "solids.ball.at.1", 99);
    expect(s.solids[0].at).toEqual([0, 99, 0]);
    expect(readTarget(s, "camera.zoom")).toBe(1);
  });
  it("pose joint vắng = 0; scalar broadcast sang [0,0,z]; scale broadcast", () => {
    const s = spec();
    expect(readTarget(s, "parts.hero.pose.kneeL")).toBe(0);
    expect(readTarget(s, "parts.hero.pose.elbowL", "vec3")).toEqual([0, 0, -30]);
    expect(readTarget(s, "solids.ball.scale", "vec3")).toEqual([1, 1, 1]);
  });
  it("lỗi hành động được: id sai gợi ý, root sai, field vắng, url fill, prototype", () => {
    expectConstructError(() => readTarget(spec(), "solids.bal.at"), /Did you mean "ball"/);
    expectConstructError(() => readTarget(spec(), "camra.zoom"), /Did you mean "camera"/);
    expectConstructError(() => readTarget(spec(), "atmosphere.vignette.strength"), /not set/);
    expectConstructError(() => readTarget(spec(), "solids.ball.__proto__.x"), /forbidden/);
    expectConstructError(() => readTarget(spec(), "solids.ball.at", "vec2"), /vec3/);
    const g = constructSpecSchema.parse(scene({ solids: [{ id: "b", type: "box", size: [1, 1, 1], fill: "url(#x)", shading: "none" }] }));
    expectConstructError(() => readTarget(g, "solids.b.fill"), /non-animatable/);
  });
});

describe("evaluate — tracks, blend, holdFrames, shot", () => {
  it("track set di chuyển solid; add cộng vào giá trị gốc", () => {
    const m = motion({
      tracks: [
        { target: "solids.ball.at.0", keys: [{ t: 0, v: 0 }, { t: 1, v: 100, ease: "linear" }] },
        { target: "solids.ball.at.1", blend: "add", keys: [{ t: 0, v: 0 }, { t: 1, v: 50, ease: "linear" }] },
      ],
    });
    const p = prepareMotion(m);
    const mid = evaluateMotionAt(p, 0.5);
    expect(mid.solids[0].at).toEqual([50, 65, 0]);
  });

  it("holdFrames 2: vật thể giữ pose 2 frame, camera vẫn on ones", () => {
    const m = motion({
      fps: 12,
      holdFrames: 2,
      tracks: [
        { target: "solids.ball.at.0", keys: [{ t: 0, v: 0 }, { t: 1, v: 120, ease: "linear" }] },
        { target: "camera.zoom", keys: [{ t: 0, v: 1 }, { t: 1, v: 2, ease: "linear" }] },
      ],
    });
    const p = prepareMotion(m);
    const f = (i: number) => evaluateMotionAt(p, i / 12);
    expect(f(0).solids[0].at[0]).toBe(f(1).solids[0].at[0]);
    expect(f(2).solids[0].at[0]).not.toBe(f(1).solids[0].at[0]);
    expect(f(1).camera.zoom).not.toBe(f(0).camera.zoom);
  });

  it("orbit track trên scene dùng preset → hiện thực hoá orbit từ preset", () => {
    const m = motion({ tracks: [{ target: "camera.orbit.azimuth", keys: [{ t: 0, v: 45 }, { t: 1, v: 90 }] }] });
    const s = evaluateMotionAt(prepareMotion(m), 1);
    expect(s.camera.orbit?.azimuth).toBe(90);
    expect(s.camera.orbit?.elevation).toBeCloseTo(35.264, 2);
  });

  it("shot dollyIn tăng zoom theo easing; auto suy từ shotType", () => {
    const m = motion({ rigs: [{ type: "shot", move: "dollyIn", amount: 0.5 }] });
    const p = prepareMotion(m);
    expect(evaluateMotionAt(p, 0).camera.zoom).toBe(1);
    expect(evaluateMotionAt(p, 1).camera.zoom).toBeCloseTo(1.5, 9);
    const auto = prepareMotion(motion({ rigs: [{ type: "shot", move: "auto" }] }), { shotType: "Slow zoom-in" });
    expect(auto.shotMoves.get(0)).toBe("dollyIn");
    const vi = prepareMotion(motion({ rigs: [{ type: "shot", move: "auto" }] }), { shotType: "Lia máy sang phải" });
    expect(vi.shotMoves.get(0)).toBe("pan");
    const unknown = prepareMotion(motion({ rigs: [{ type: "shot", move: "auto" }] }), { shotType: "???" });
    expect(unknown.warnings.join()).toMatch(/could not infer/);
  });

  it("giá trị ra ngoài miền hợp lệ → lỗi kèm thời điểm", () => {
    const m = motion({ tracks: [{ target: "solids.ball.r", keys: [{ t: 0, v: 40 }, { t: 1, v: -5, ease: "linear" }] }] });
    const p = prepareMotion(m);
    expectConstructError(() => evaluateMotionAt(p, 1), /t=1s.*solids\.0\.r/);
  });

  it("track path sai báo lỗi NGAY ở prepare (không đợi frame giữa)", () => {
    expectConstructError(() => prepareMotion(motion({ tracks: [{ target: "solids.nope.at", keys: [{ t: 0.5, v: [0, 0, 0] }] }] })), /nope/);
    expectConstructError(
      () => prepareMotion(motion({ rigs: [{ type: "wiggle", target: "solids.nah.at", amplitude: 3, start: 0.5 }] })),
      /nah/,
    );
  });

  it("wiggle tất định theo seed, khác seed → khác", () => {
    const mk = (seed: number) =>
      prepareMotion(motion({ rigs: [{ type: "wiggle", target: "solids.ball.at", amplitude: [10, 10, 0], seed }] }));
    const a = evaluateMotionAt(mk(1), 0.5).solids[0].at;
    const b = evaluateMotionAt(mk(1), 0.5).solids[0].at;
    const c = evaluateMotionAt(mk(2), 0.5).solids[0].at;
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(a[2]).toBe(0);
    expect(fbm1D(1.5, 3, 0, 2)).toBe(fbm1D(1.5, 3, 0, 2));
  });

  it("follow: target lặp chuyển động source trễ lag", () => {
    const m = motion({
      tracks: [{ target: "solids.ball.at.0", keys: [{ t: 0, v: 0 }, { t: 1, v: 100, ease: "linear" }] }],
      rigs: [{ type: "follow", source: "solids.ball.at.0", target: "solids.floor.at.0", lag: 0.25, gain: 0.5 }],
    });
    const s = evaluateMotionAt(prepareMotion(m), 0.75);
    expect(s.solids[1].at[0]).toBeCloseTo(0.5 * 50, 6);
  });

  it("roll: lăn không trượt — góc z = −Δx/r", () => {
    const m = motion({
      tracks: [{ target: "solids.ball.at.0", keys: [{ t: 0, v: 0 }, { t: 1, v: 40 * Math.PI, ease: "linear" }] }],
      rigs: [{ type: "roll", target: "solids.ball", radius: 40 }],
    });
    const s = evaluateMotionAt(prepareMotion(m), 1);
    expect(s.solids[0].rotate[2]).toBeCloseTo(-180, 6);
  });
});

describe("compileMotion", () => {
  it("frameCount = round(duration·fps); scene tĩnh chỉ compile 1 lần (memo)", () => {
    const c = createMotionCompiler(motion({ fps: 12, duration: 1 }));
    expect(c.frameCount).toBe(12);
    const frames = Array.from({ length: 12 }, (_, i) => c.compileFrame(i));
    expect(frames.filter((f) => f.reused)).toHaveLength(11);
    expect(c.summary().stats.uniqueFrames).toBe(1);
  });

  it("double-compile byte-identical từng frame", () => {
    const m = motion({
      tracks: [{ target: "camera.orbit.azimuth", keys: [{ t: 0, v: 20 }, { t: 1, v: 70 }] }],
      rigs: [{ type: "wiggle", target: "solids.ball.at", amplitude: 8 }],
    });
    const a = createMotionCompiler(m);
    const b = createMotionCompiler(m);
    for (let i = 0; i < a.frameCount; i++) expect(a.compileFrame(i).svg).toBe(b.compileFrame(i).svg);
  });

  it("frame compose qua sanitizer; backdrop/overlay giữ nguyên", () => {
    const m = motion({ backdrop: '<use href="#sky"/>', overlay: '<rect width="10" height="10"/>' });
    const c = createMotionCompiler(m);
    const body = composeMotionFrame(m, c.compileFrame(0).svg, { w: 1920, h: 1080 });
    expect(body.startsWith('<rect width="1920" height="1080" fill="#1a1a2e"/>')).toBe(true);
    expect(body).toContain('<use href="#sky"/>');
    expect(() => sanitizeSvg(body, "frame")).not.toThrow();
  });

  it("lỗi giữa clip mang thời điểm; frame trước vẫn compile được", () => {
    const m = motion({
      fps: 4,
      tracks: [{ target: "solids.ball.segments", keys: [{ t: 0, v: 24 }, { t: 0.5, v: 200, ease: "step" }] }],
    });
    const c = createMotionCompiler(m);
    expect(() => c.compileFrame(1)).not.toThrow();
    // segments 200 > 64 → re-validate chặn tại frame 2 (t=0.5)
    expectConstructError(() => c.compileFrame(2), /t=0\.5s/);
  });

  it("schema: duration·fps vượt trần → lỗi gợi ý fps 12", () => {
    const r = motionSpecSchema.safeParse({ version: 1, duration: 20, fps: 30, scene: scene() });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toMatch(/12 is standard/);
  });
});
