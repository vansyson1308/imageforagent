import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { depthOrderNNS } from "@/lib/services/construct/depthOrder";
import { projectAndSort } from "@/lib/services/construct/painterSort";
import { boxMesh, transformMesh } from "@/lib/services/construct/geometry3d";
import { CAMERA_PRESETS, viewMatrix } from "@/lib/services/construct/camera";
import { composePlacement4, translation4 } from "@/lib/services/construct/math3d";
import { compileConstruction } from "@/lib/services/construct/compile";
import { constructSpecSchema } from "@/lib/validation/constructSchema";
import { renderArtwork } from "@/lib/services/svgRenderer";
import { parseHex } from "@/lib/services/construct/shading";

const ISO = viewMatrix(CAMERA_PRESETS.isometric);
const ORTHO = { kind: "orthographic", zoom: 1 } as const;
const noClock = () => {};

describe("depthOrderNNS — bất biến zero-split", () => {
  it("cảnh KHÔNG xuyên nhau: output === painter order (từng mặt, đúng thứ tự)", () => {
    const items = [
      { solidId: "a", solidIndex: 0, mesh: boxMesh([80, 80, 80]) },
      { solidId: "b", solidIndex: 1, mesh: transformMesh(translation4([200, 0, 0]), boxMesh([80, 80, 80])) },
      { solidId: "c", solidIndex: 2, mesh: transformMesh(translation4([0, 200, 0]), boxMesh([60, 60, 60])) },
    ];
    const nns = depthOrderNNS(items, ISO, ORTHO, noClock);
    const painter = projectAndSort(items, ISO, ORTHO);
    expect(nns.splits).toBe(0);
    expect(nns.fallback).toBe(false);
    expect(nns.faces.map((f) => [f.solidId, f.faceIndex])).toEqual(
      painter.map((f) => [f.solidId, f.faceIndex]),
    );
  });

  it("khối chồng dọc chạm nhau (stack) — vẫn zero-split", () => {
    const items = [
      { solidId: "low", solidIndex: 0, mesh: boxMesh([100, 100, 100]) },
      { solidId: "high", solidIndex: 1, mesh: transformMesh(translation4([0, 100, 0]), boxMesh([100, 100, 100])) },
    ];
    const nns = depthOrderNNS(items, ISO, ORTHO, noClock);
    expect(nns.splits).toBe(0);
    expect(nns.faces.map((f) => [f.solidId, f.faceIndex])).toEqual(
      projectAndSort(items, ISO, ORTHO).map((f) => [f.solidId, f.faceIndex]),
    );
  });

  it("2 khối XUYÊN nhau → có split, fragment kế thừa solidId/label/faceIndex", () => {
    // Hai tấm chéo nhau hình chữ X, camera front — hai mặt lớn xuyên nhau
    // thật sự (dưới iso một tấm gần edge-on nên không xung đột)
    const FRONT = viewMatrix(CAMERA_PRESETS.front);
    const a = transformMesh(composePlacement4([0, 0, 0], [0, 45, 0], 1), boxMesh([300, 120, 10]));
    const b = transformMesh(composePlacement4([0, 0, 0], [0, -45, 0], 1), boxMesh([300, 120, 10]));
    const items = [
      { solidId: "slabA", solidIndex: 0, mesh: a },
      { solidId: "slabB", solidIndex: 1, mesh: b },
    ];
    const nns = depthOrderNNS(items, FRONT, ORTHO, noClock);
    expect(nns.splits).toBeGreaterThan(0);
    expect(nns.fallback).toBe(false);
    const ids = new Set(nns.faces.map((f) => f.solidId));
    expect(ids).toEqual(new Set(["slabA", "slabB"]));
    // Fragment giữ faceIndex gốc (hợp đồng cutout)
    for (const f of nns.faces) {
      expect(f.faceIndex).toBeGreaterThanOrEqual(0);
      expect(f.faceIndex).toBeLessThan(6);
    }
  });

  it("deterministic: double-run cùng thứ tự + cùng splits", () => {
    const FRONT = viewMatrix(CAMERA_PRESETS.front);
    const a = transformMesh(composePlacement4([0, 0, 0], [0, 45, 0], 1), boxMesh([300, 120, 10]));
    const b = transformMesh(composePlacement4([0, 0, 0], [0, -45, 0], 1), boxMesh([300, 120, 10]));
    const items = [
      { solidId: "a", solidIndex: 0, mesh: a },
      { solidId: "b", solidIndex: 1, mesh: b },
    ];
    const r1 = depthOrderNNS(items, FRONT, ORTHO, noClock);
    const r2 = depthOrderNNS(items, FRONT, ORTHO, noClock);
    expect(r1.splits).toBe(r2.splits);
    expect(r1.faces).toEqual(r2.faces);
  });
});

describe("compile với depthSort", () => {
  const CROSS_SPEC = {
    version: 1,
    solids: [
      { id: "red", type: "box", size: [400, 100, 24], rotate: [0, 45, 0], fill: "#d64545" },
      { id: "blue", type: "box", size: [400, 100, 24], rotate: [0, -45, 0], fill: "#4573d6" },
    ],
    camera: { preset: "front" },
    place: { at: [960, 540] },
  } as const;

  it("exact là default; painter opt-in có overlap warning, exact không", () => {
    const exact = compileConstruction(constructSpecSchema.parse(CROSS_SPEC));
    expect(exact.stats.depthSplits).toBeGreaterThan(0);
    expect(exact.warnings.some((w) => w.includes("overlap"))).toBe(false);

    const painter = compileConstruction(
      constructSpecSchema.parse({ ...CROSS_SPEC, depthSort: "painter" }),
    );
    expect(painter.stats.depthSplits).toBe(0);
    expect(painter.warnings.some((w) => w.includes("overlap"))).toBe(true);
  });

  it("cảnh sạch: exact output === painter output BYTE-IDENTICAL", () => {
    const clean = {
      version: 1,
      solids: [
        { id: "a", type: "box", size: [100, 100, 100], fill: "#cc8844" },
        { id: "b", type: "box", size: [80, 80, 80], at: [200, 0, 0], fill: "#44cc88" },
      ],
    } as const;
    const exact = compileConstruction(constructSpecSchema.parse(clean));
    const painter = compileConstruction(constructSpecSchema.parse({ ...clean, depthSort: "painter" }));
    expect(exact.svg).toBe(painter.svg);
    expect(exact.stats.depthSplits).toBe(0);
  });

  it("PIXEL PROOF: chữ X xuyên nhau — mỗi bên đường giao đúng màu tấm gần hơn", async () => {
    const { svg, stats } = compileConstruction(constructSpecSchema.parse(CROSS_SPEC));
    expect(stats.depthSplits).toBeGreaterThan(0);
    const png = await renderArtwork(null, `<rect width="1920" height="1080" fill="#101018"/>${svg}`, "16:9", "1K");
    const raw = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    const px = (lx: number, ly: number) => {
      const x = Math.round((lx * 1024) / 1920);
      const y = Math.round((ly * 576) / 1080);
      const i = (y * raw.info.width + x) * raw.info.channels;
      return [raw.data[i], raw.data[i + 1], raw.data[i + 2]] as const;
    };
    // Camera front: tấm red xoay +45° quanh y → nửa TRÁI của red gần camera
    // (z>0), nửa phải xa; blue ngược lại. Trên trục giữa (y=540):
    // bên trái giao điểm phải thấy RED đè, bên phải thấy BLUE đè.
    const left = px(960 - 120, 540);
    const right = px(960 + 120, 540);
    // So kênh tương đối — tông shaded tối nhất (ambient 0.3) vẫn phân biệt được
    const isRed = (c: readonly [number, number, number]) => c[0] > c[2] + 15;
    const isBlue = (c: readonly [number, number, number]) => c[2] > c[0] + 15;
    expect(isRed(left), `left px = ${left.join(",")}`).toBe(true);
    expect(isBlue(right), `right px = ${right.join(",")}`).toBe(true);

    // Đối chứng: painter mode vẽ sai ÍT NHẤT một bên
    const painterOut = compileConstruction(
      constructSpecSchema.parse({ ...CROSS_SPEC, depthSort: "painter" }),
    );
    const png2 = await renderArtwork(null, `<rect width="1920" height="1080" fill="#101018"/>${painterOut.svg}`, "16:9", "1K");
    const raw2 = await sharp(png2).raw().toBuffer({ resolveWithObject: true });
    const px2 = (lx: number, ly: number) => {
      const x = Math.round((lx * 1024) / 1920);
      const y = Math.round((ly * 576) / 1080);
      const i = (y * raw2.info.width + x) * raw2.info.channels;
      return [raw2.data[i], raw2.data[i + 1], raw2.data[i + 2]] as const;
    };
    const pLeft = px2(960 - 120, 540);
    const pRight = px2(960 + 120, 540);
    expect(isRed(pLeft) && isBlue(pRight)).toBe(false);
  });

  it("parseHex sanity cho pixel proof colors", () => {
    expect(parseHex("#d64545")!.r).toBeGreaterThan(200);
  });
});

describe("regression: smooth silhouette thế chỗ mặt CUỐI trong NNS (bug cối xay gió)", () => {
  it("mặt top tháp bị cắt bởi vật xuyên KHÔNG lòi lên trên cap smooth", () => {
    // Tái hiện: frustum faceted + cone smooth đội lên + thanh xuyên ngang
    // ép NNS cắt mặt top tháp thành nhiều mảnh
    const { svg, stats } = compileConstruction(
      constructSpecSchema.parse({
        version: 1,
        solids: [
          { id: "tower", type: "cone", r: 150, rTop: 95, h: 380, at: [0, 190, 0], segments: 24, fill: "#efe6d2", shading: "faceted" },
          { id: "cap", type: "cone", r: 110, rTop: 0, h: 130, at: [0, 445, 0], segments: 20, fill: "#b3552e" },
          { id: "bar", type: "box", size: [500, 24, 12], at: [0, 430, 140], rotate: [0, 0, 25], fill: "#6b4a2e" },
        ],
        light: { direction: [0.6, -1.7, 0.9], ambient: 0.42 },
        camera: { orbit: { azimuth: -30, elevation: 14 } },
      }),
    );
    expect(stats.depthSplits).toBeGreaterThan(0); // mặt top thật sự bị cắt
    // KHÔNG path #efe6d2 nguyên độ sáng (mặt top luminance 1) SAU silhouette cap
    const fills = [...svg.matchAll(/<path [^>]*fill="([^"]+)"/g)].map((m) => m[1]);
    const capIdx = fills.findIndex((f) => f.includes("cg-cap"));
    expect(capIdx).toBeGreaterThanOrEqual(0);
    expect(fills.slice(capIdx + 1).filter((f) => f === "#efe6d2")).toHaveLength(0);
  });

  it("vật ĐỨNG TRƯỚC smooth solid vẫn vẽ sau silhouette (không bị nuốt)", () => {
    // Thanh chắn TRƯỚC cầu smooth — silhouette đặt ở mặt cuối không được đè thanh
    const { svg } = compileConstruction(
      constructSpecSchema.parse({
        version: 1,
        solids: [
          { id: "ball", type: "sphere", r: 100, segments: 16, fill: "#3a86c8" },
          { id: "bar", type: "box", size: [300, 30, 20], at: [0, 0, 130], fill: "#d64545" },
        ],
        camera: { preset: "front" },
      }),
    );
    const fills = [...svg.matchAll(/<path [^>]*fill="([^"]+)"/g)].map((m) => m[1]);
    const ballIdx = fills.findIndex((f) => f.includes("cg-ball"));
    expect(ballIdx).toBeGreaterThanOrEqual(0);
    // Mặt thanh (fill hex shaded, không phải gradient) phải có và đứng SAU silhouette
    const barFacesAfter = fills.slice(ballIdx + 1).filter((f) => f.startsWith("#"));
    expect(barFacesAfter.length).toBeGreaterThan(0);
  });
});
