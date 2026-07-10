import { describe, expect, it } from "vitest";
import { compileConstruction } from "@/lib/services/construct/compile";
import { constructSpecSchema } from "@/lib/validation/constructSchema";
import { sanitizeSvg } from "@/lib/services/svgRenderer";
import { AppError } from "@/lib/services/apiError";
import { GEAR_SPEC, HOUSE_SPEC, ROCKET_SPEC } from "./exampleSpecs";

function compile(raw: unknown) {
  return compileConstruction(constructSpecSchema.parse(raw));
}

function expectError(raw: unknown, messagePart: string, hintPart?: string): AppError {
  try {
    compile(raw);
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    const e = err as AppError;
    expect(e.code).toBe("CONSTRUCTION_INVALID");
    expect(e.message).toContain(messagePart);
    if (hintPart) expect(e.hint).toContain(hintPart);
    return e;
  }
  throw new Error(`Expected CONSTRUCTION_INVALID with "${messagePart}"`);
}

describe("compile — 3 example specs chính thức", () => {
  it("GEAR (2D boolean): compile sạch, chỉ emit boolean gốc", () => {
    const result = compile(GEAR_SPEC);
    expect(result.svg).toContain("<path");
    // disc/teeth/hub/gearBody bị tiêu thụ — chỉ 1 path (gear)
    expect(result.svg.match(/<path /g)?.length).toBe(1);
    expect(result.svg).toContain('fill="#F4B23C"');
    expect(result.svg).toContain('stroke="#2B2B33"');
    expect(result.stats.compileMs).toBeLessThan(200);
    expect(() => sanitizeSvg(result.svg, "frame")).not.toThrow();
  });

  it("HOUSE (iso preset + extrude + cutout): decal cửa + cảnh báo overlap", () => {
    const result = compile(HOUSE_SPEC);
    expect(result.svg).toContain('fill="#5B3A24"'); // decal cửa
    expect(result.svg).toContain('fill="#7FB4D9"'); // decal cửa sổ
    expect(result.stats.solids).toBe(5);
    expect(result.stats.facesEmitted).toBeGreaterThan(4);
    // chimney cắm xuyên roof → có overlap warning
    expect(result.warnings.some((w) => w.includes("overlap"))).toBe(true);
    expect(result.stats.compileMs).toBeLessThan(200);
  });

  it("ROCKET (full-3D orbit + smooth): gradient cg- + decal porthole", () => {
    const result = compile(ROCKET_SPEC);
    expect(result.svg).toContain('id="cg-body"'); // linear gradient thân trụ
    expect(result.svg).toContain('id="cg-nose"');
    expect(result.svg).toContain("linearGradient"); // trụ/nón smooth = linear qua silhouette
    expect(result.svg).toContain('fill="url(#cg-body)"');
    expect(result.svg).toContain('fill="#7FB4D9"'); // porthole decal
    expect(result.stats.compileMs).toBeLessThan(200);
  });

  it("snapshot 3 specs (hợp đồng output đóng băng)", () => {
    expect(compile(GEAR_SPEC).svg).toMatchSnapshot("gear");
    expect(compile(HOUSE_SPEC).svg).toMatchSnapshot("house");
    expect(compile(ROCKET_SPEC).svg).toMatchSnapshot("rocket");
  });

  it("DETERMINISM: double-compile byte-identical cho cả 3", () => {
    for (const spec of [GEAR_SPEC, HOUSE_SPEC, ROCKET_SPEC]) {
      expect(compile(spec).svg).toBe(compile(spec).svg);
    }
  });
});

describe("compile — bảng error đầy đủ", () => {
  const base = { version: 1 } as const;

  it("unknown ref kèm Levenshtein 'Did you mean'", () => {
    const e = expectError(
      {
        ...base,
        shapes: [
          { id: "hole", type: "circle", r: 10 },
          { id: "plate", type: "boolean", op: "difference", of: ["body", "hole2"] },
          { id: "body", type: "rect", w: 100, h: 100 },
        ],
      },
      '"hole2" not found',
    );
    expect(e.hint).toContain('Did you mean "hole"?');
  });

  it("ref cycle", () => {
    expectError(
      {
        ...base,
        shapes: [
          { id: "a", type: "boolean", op: "union", of: ["b", "c"] },
          { id: "b", type: "boolean", op: "union", of: ["a", "c"] },
          { id: "c", type: "circle", r: 10 },
        ],
      },
      "reference cycle",
      "must form a tree",
    );
  });

  it("duplicate id xuyên shapes/solids", () => {
    expectError(
      {
        ...base,
        shapes: [{ id: "fin", type: "circle", r: 10 }],
        solids: [{ id: "fin", type: "box", size: [10, 10, 10] }],
      },
      'Duplicate id "fin"',
      "rename one",
    );
  });

  it("quá maxTotalFaces kèm knob hint", () => {
    expectError(
      {
        ...base,
        solids: [
          { id: "s1", type: "sphere", r: 10, segments: 64 },
          { id: "s2", type: "sphere", r: 10, segments: 64, at: [100, 0, 0], shading: "faceted" },
          { id: "s3", type: "sphere", r: 10, segments: 64, at: [200, 0, 0], shading: "faceted" },
        ],
      },
      "faces (max",
      "Reduce segments",
    );
  });

  it("extrude profile là line hở", () => {
    expectError(
      {
        ...base,
        shapes: [{ id: "arrow", type: "line", points: [[0, 0], [50, 50]] }],
        solids: [{ id: "solid", type: "extrude", profile: "arrow", depth: 10 }],
      },
      "open path",
      "closed profile",
    );
  });

  it("boolean rỗng ĐƯỢC emit → warning + skip, không crash", () => {
    const result = compile({
      ...base,
      shapes: [
        { id: "a", type: "circle", r: 10 },
        { id: "b", type: "circle", r: 10, at: [500, 0] },
        { id: "badge", type: "boolean", op: "intersection", of: ["a", "b"] },
        { id: "bg", type: "rect", w: 50, h: 50, at: [0, 200] },
      ],
    });
    expect(result.warnings.some((w) => w.includes('"badge"') && w.includes("empty"))).toBe(true);
    expect(result.svg.match(/<path /g)?.length).toBe(1); // chỉ bg
  });

  it("cutout subtract trên solid smooth", () => {
    expectError(
      {
        ...base,
        shapes: [{ id: "hole", type: "circle", r: 5 }],
        solids: [{ id: "tube", type: "cylinder", r: 20, h: 50, shading: "smooth" }],
        cutouts: [{ solid: "tube", face: "front", shape: "hole", mode: "subtract" }],
      },
      "smooth cylinder",
      'shading:"faceted"',
    );
  });

  it("cutout trên mặt không nhìn thấy → liệt kê mặt khả dụng", () => {
    expectError(
      {
        ...base,
        shapes: [{ id: "hole", type: "circle", r: 5 }],
        solids: [{ id: "block", type: "box", size: [50, 50, 50] }],
        cutouts: [{ solid: "block", face: "back", shape: "hole", mode: "subtract" }],
      },
      '"back" of "block" is not visible',
      "Visible faces",
    );
  });

  it("solid shaded với fill url()", () => {
    expectError(
      {
        ...base,
        solids: [{ id: "hull", type: "box", size: [10, 10, 10], fill: "url(#brass)" }],
      },
      'fill "url(#brass)" with shading enabled',
      '"#hex"',
    );
  });

  it("line trong boolean", () => {
    expectError(
      {
        ...base,
        shapes: [
          { id: "stroke1", type: "line", points: [[0, 0], [10, 10]] },
          { id: "u", type: "boolean", op: "union", of: ["stroke1", "stroke1"] },
        ],
      },
      "open strokes cannot participate",
    );
  });

  it("emit ref không tồn tại", () => {
    expectError(
      {
        ...base,
        shapes: [{ id: "a", type: "circle", r: 10 }],
        emit: ["nothere"],
      },
      '"nothere" not found',
    );
  });

  it("tất cả bị tiêu thụ + emit rỗng → hint dùng emit", () => {
    expectError(
      {
        ...base,
        shapes: [
          { id: "a", type: "circle", r: 10 },
          { id: "b", type: "rect", w: 5, h: 5 },
          { id: "u", type: "boolean", op: "union", of: ["a", "b"] },
        ],
        emit: [],
      },
      "Nothing to emit",
      '"emit"',
    );
  });
});

describe("compile — ngữ nghĩa quan trọng", () => {
  it("emit ép xuất shape đã bị tiêu thụ", () => {
    const result = compile({
      version: 1,
      shapes: [
        { id: "a", type: "circle", r: 50, fill: "#ff0000" },
        { id: "b", type: "rect", w: 60, h: 60, at: [40, 0], fill: "#00ff00" },
        { id: "u", type: "boolean", op: "union", of: ["a", "b"], fill: "#0000ff" },
      ],
      emit: ["a", "u"],
    });
    expect(result.svg.match(/<path /g)?.length).toBe(2);
    expect(result.svg).toContain('fill="#ff0000"');
    expect(result.svg).toContain('fill="#0000ff"');
  });

  it("extrude profile boolean có lỗ → mặt cap fill-rule evenodd", () => {
    const result = compile({
      version: 1,
      shapes: [
        { id: "plate", type: "rect", w: 100, h: 100 },
        { id: "hole", type: "circle", r: 25 },
        { id: "washer", type: "boolean", op: "difference", of: ["plate", "hole"] },
      ],
      solids: [{ id: "block", type: "extrude", profile: "washer", depth: 30, fill: "#cc8844" }],
      camera: { preset: "isometric" },
    });
    expect(result.svg).toContain('fill-rule="evenodd"');
  });

  it("perspective auto-distance hoạt động (không thiếu distance)", () => {
    const result = compile({
      version: 1,
      solids: [{ id: "b", type: "box", size: [100, 100, 100], fill: "#888888" }],
      camera: { orbit: { azimuth: 30, elevation: 25 }, projection: "perspective" },
    });
    expect(result.stats.facesEmitted).toBe(3);
  });

  it("global stroke (comic outline) áp lên mặt 3D", () => {
    const result = compile({
      version: 1,
      solids: [{ id: "b", type: "box", size: [50, 50, 50], fill: "#888888" }],
      stroke: { color: "#111111", width: 3 },
    });
    expect(result.svg.match(/stroke="#111111"/g)?.length).toBe(3);
  });

  it("shading none giữ nguyên fill kể cả url()", () => {
    const result = compile({
      version: 1,
      solids: [{ id: "b", type: "box", size: [50, 50, 50], fill: "url(#tex)", shading: "none" }],
    });
    expect(result.svg.match(/fill="url\(#tex\)"/g)?.length).toBe(3);
  });

  it("stats hợp lý + fragment luôn qua sanitizer", () => {
    const result = compile(HOUSE_SPEC);
    expect(result.stats.shapes).toBe(3);
    expect(result.stats.bytes).toBe(Buffer.byteLength(result.svg, "utf8"));
    expect(result.stats.facesGenerated).toBeGreaterThanOrEqual(result.stats.facesEmitted);
    expect(result.stats.pathCommands).toBeGreaterThan(10);
  });
});
