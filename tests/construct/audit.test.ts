import { describe, it, expect } from "vitest";
import { compileConstruction } from "@/lib/services/construct/compile";
import { constructSpecSchema } from "@/lib/validation/constructSchema";
import { sanitizeSvg } from "@/lib/services/svgRenderer";

const compile = (raw: unknown) => compileConstruction(constructSpecSchema.parse(raw));

describe("audit probes — kiểm thử đối kháng từ phiên tester", () => {
it("P1: cutout theo label trên kết quả CSG (label sống sót trên fragment)", () => {
  const r = compile({
    version: 1,
    shapes: [{ id: "win", type: "circle", r: 20 }],
    solids: [
      { id: "a", type: "box", size: [200, 120, 100], fill: "#cc8855" },
      { id: "b", type: "cylinder", r: 30, h: 140, segments: 12, at: [70, 0, 0], fill: "#5588cc", shading: "faceted" },
      { id: "wall", type: "csg", op: "difference", of: ["a", "b"] },
    ],
    cutouts: [{ solid: "wall", face: "front", shape: "win", at: [-50, 0], mode: "overlay", fill: "#88ccee" }],
  });
  expect(r.svg).toContain("#88ccee");
});

it("P2: precision 0 — output nguyên, không vỡ", () => {
  const r = compile({
    version: 1,
    solids: [{ id: "b", type: "sphere", r: 77.777, segments: 12, fill: "#888888" }],
    precision: 0,
  });
  // Path d không còn số lẻ (attrs gradient objectBoundingBox 0..1 vẫn lẻ — đúng thiết kế)
  const ds = [...r.svg.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]).join(" ");
  expect(ds).not.toMatch(/\d\.\d/);
  sanitizeSvg(r.svg, "frame");
});

it("P3: scale méo [1,3,0.5] trên solid gắn group xoay — normal đúng (không NaN, có 3 tông)", () => {
  const r = compile({
    version: 1,
    groups: [{ id: "g", rotate: [0, 30, 0] }],
    solids: [{ id: "b", type: "box", size: [100, 100, 100], scale: [1, 3, 0.5], group: "g", fill: "#e07b39" }],
  });
  expect(r.svg).not.toContain("NaN");
  const fills = new Set([...r.svg.matchAll(/fill="(#[0-9a-f]{6})"/g)].map((m) => m[1]));
  expect(fills.size).toBeGreaterThanOrEqual(2);
});

it("P4: stress 100 solid + exact — dưới maxCompileMs", () => {
  const solids = Array.from({ length: 100 }, (_, i) => ({
    id: `b${i}`,
    type: "box",
    size: [30, 30 + (i % 5) * 10, 30],
    at: [(i % 10) * 60 - 270, ((i / 10) | 0) * 25, (i % 7) * 40 - 120],
    fill: "#8899aa",
  }));
  const t0 = performance.now();
  const r = compile({ version: 1, solids, shadow: {} });
  const ms = performance.now() - t0;
  console.log("P4 ok — 100 solid xuyên nhau lung tung:", Math.round(ms), "ms, splits:", r.stats.depthSplits, "faces:", r.stats.facesEmitted);
  expect(ms).toBeLessThan(2000);
});

it("P5: zoom lớn + place scale nhỏ — số học ổn", () => {
  const r = compile({
    version: 1,
    solids: [{ id: "b", type: "box", size: [10, 10, 10], fill: "#334455" }],
    camera: { preset: "isometric", zoom: 50 },
    place: { at: [960, 540], scale: 0.01 },
  });
  expect(r.svg).not.toContain("NaN");
  sanitizeSvg(r.svg, "frame");
});

it("P6: figure pose cực đoan (mọi khớp 720°) — không crash, không NaN", () => {
  const pose: Record<string, number> = {};
  for (const j of ["spine","neck","shoulderL","shoulderR","elbowL","elbowR","wristL","wristR","hipL","hipR","kneeL","kneeR","ankleL","ankleR"]) pose[j] = 720;
  const r = compile({ version: 1, parts: [{ id: "f", type: "figure", pose }] });
  expect(r.svg).not.toContain("NaN");
});
});
