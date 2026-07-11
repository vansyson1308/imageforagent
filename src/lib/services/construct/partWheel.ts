import type { Mat4 } from "@/lib/services/construct/types";
import { IDENTITY_4, mul4, rotationZ4, translation4 } from "@/lib/services/construct/math3d";
import type { Part, Shape2D, Solid } from "@/lib/validation/constructSchema";

/**
 * partWheel — builder cho các part "đồ vật": wheel (3D), tree (3D),
 * cloud/arrow (macro 2D). Mỗi builder là hàm thuần: part → shapes/solids
 * sinh sẵn (id "partId:segment") + localM cho solid (world = partM · localM).
 */

export interface GeneratedSolid {
  readonly solid: Solid;
  /** Placement local trong hệ của part (world = partM · localM). */
  readonly localM: Mat4;
}

export interface PartBuild {
  readonly shapes: Shape2D[];
  readonly solids: GeneratedSolid[];
}

/** Solid với mọi field default đã điền (expansion chạy SAU zod parse). */
const SOLID_DEFAULTS = {
  at: [0, 0, 0] as [number, number, number],
  rotate: [0, 0, 0] as [number, number, number],
  scale: 1,
  shading: "auto" as const,
  shadow: true,
};

const SHAPE_DEFAULTS = {
  at: [0, 0] as [number, number],
  rotate: 0,
  scale: 1,
  skew: [0, 0] as [number, number],
};

type WheelPart = Extract<Part, { type: "wheel" }>;
type TreePart = Extract<Part, { type: "tree" }>;
type CloudPart = Extract<Part, { type: "cloud" }>;
type ArrowPart = Extract<Part, { type: "arrow" }>;

/**
 * Bánh xe trục z (đứng, lăn theo x): lốp = vành ring extrude, mâm = ring/đĩa
 * extrude (bore là lỗ THẬT qua boolean profile), nan hoa = N box toả tâm.
 */
export function buildWheel(part: WheelPart): PartBuild {
  const tireProfile = part.tireProfile ?? part.radius * 0.18;
  const hubRadius = part.hubRadius ?? part.radius * 0.28;
  const spokeWidth = part.spokeWidth ?? tireProfile * 0.8;
  const fills = {
    tire: part.fills?.tire ?? "#2b2b33",
    hub: part.fills?.hub ?? "#8a8a94",
    spokes: part.fills?.spokes ?? "#b0b0b8",
  };
  const p = (seg: string) => `${part.id}:${seg}`;

  const shapes: Shape2D[] = [
    { ...SHAPE_DEFAULTS, id: p("tireO"), type: "circle", r: part.radius },
    { ...SHAPE_DEFAULTS, id: p("tireI"), type: "circle", r: part.radius - tireProfile },
    {
      ...SHAPE_DEFAULTS,
      id: p("tire2d"),
      type: "boolean",
      op: "difference",
      of: [p("tireO"), p("tireI")],
    },
  ];
  const solids: GeneratedSolid[] = [
    {
      solid: {
        ...SOLID_DEFAULTS,
        id: p("tire"),
        type: "extrude",
        profile: p("tire2d"),
        depth: part.width,
        fill: fills.tire,
      },
      localM: IDENTITY_4,
    },
  ];

  // Mâm: đĩa hoặc ring (bore > 0)
  if (part.boreRadius > 0) {
    shapes.push(
      { ...SHAPE_DEFAULTS, id: p("hubO"), type: "circle", r: hubRadius },
      { ...SHAPE_DEFAULTS, id: p("hubB"), type: "circle", r: part.boreRadius },
      {
        ...SHAPE_DEFAULTS,
        id: p("hub2d"),
        type: "boolean",
        op: "difference",
        of: [p("hubO"), p("hubB")],
      },
    );
    solids.push({
      solid: {
        ...SOLID_DEFAULTS,
        id: p("hub"),
        type: "extrude",
        profile: p("hub2d"),
        depth: part.width * 1.05,
        fill: fills.hub,
      },
      localM: IDENTITY_4,
    });
  } else {
    solids.push({
      solid: {
        ...SOLID_DEFAULTS,
        id: p("hub"),
        type: "cylinder",
        r: hubRadius,
        h: part.width * 1.05,
        segments: 24,
        fill: fills.hub,
        shading: "faceted",
      },
      // Trục cylinder là y → xoay quanh x cho trùng trục z của bánh
      localM: mul4(IDENTITY_4, rotationX90()),
    });
  }

  // Nan hoa
  if (part.spokeStyle === "none") {
    solids.push({
      solid: {
        ...SOLID_DEFAULTS,
        id: p("disc"),
        type: "cylinder",
        r: part.radius - tireProfile * 0.9,
        h: part.width * 0.5,
        segments: 24,
        fill: fills.spokes,
        shading: "faceted",
      },
      localM: rotationX90(),
    });
  } else {
    const inner = hubRadius * 0.4;
    const outer = part.radius - tireProfile * 0.5;
    const len = outer - inner;
    for (let i = 0; i < part.spokes; i++) {
      const angle = (i * 360) / part.spokes;
      solids.push({
        solid: {
          ...SOLID_DEFAULTS,
          id: p(`spoke${i}`),
          type: "box",
          size: [len, spokeWidth, part.width * 0.55],
          fill: fills.spokes,
        },
        localM: mul4(rotationZ4(angle), translation4([inner + len / 2, 0, 0])),
      });
    }
  }
  return { shapes, solids };
}

function rotationX90(): Mat4 {
  // rotationX4(90) — trục y → z
  // prettier-ignore
  return [
    1, 0, 0, 0,
    0, 0, -1, 0,
    0, 1, 0, 0,
    0, 0, 0, 1,
  ];
}

/** Cây: thân trụ + tán theo style (gốc tại y=0 local). */
export function buildTree(part: TreePart): PartBuild {
  const fills = {
    trunk: part.fills?.trunk ?? "#7a5230",
    canopy: part.fills?.canopy ?? "#4f9d4f",
  };
  const p = (seg: string) => `${part.id}:${seg}`;
  const solids: GeneratedSolid[] = [
    {
      solid: {
        ...SOLID_DEFAULTS,
        id: p("trunk"),
        type: "cylinder",
        r: part.trunkR,
        h: part.trunkH,
        segments: 12,
        fill: fills.trunk,
      },
      localM: translation4([0, part.trunkH / 2, 0]),
    },
  ];
  switch (part.style) {
    case "blob":
      solids.push({
        solid: {
          ...SOLID_DEFAULTS,
          id: p("canopy"),
          type: "sphere",
          r: part.canopyR,
          segments: 16,
          fill: fills.canopy,
        },
        localM: translation4([0, part.trunkH + part.canopyR * 0.75, 0]),
      });
      break;
    case "cone":
      solids.push({
        solid: {
          ...SOLID_DEFAULTS,
          id: p("canopy"),
          type: "cone",
          r: part.canopyR,
          rTop: 0,
          h: part.canopyR * 2.2,
          segments: 16,
          fill: fills.canopy,
        },
        localM: translation4([0, part.trunkH + part.canopyR * 1.05, 0]),
      });
      break;
    case "layered": {
      const layers: Array<readonly [number, number]> = [
        [1, 0.5],
        [0.8, 1.15],
        [0.6, 1.7],
      ];
      layers.forEach(([rScale, yScale], i) => {
        solids.push({
          solid: {
            ...SOLID_DEFAULTS,
            id: p(`canopy${i}`),
            type: "cone",
            r: part.canopyR * rScale,
            rTop: 0,
            h: part.canopyR * 1.1,
            segments: 12,
            fill: fills.canopy,
          },
          localM: translation4([0, part.trunkH + part.canopyR * yScale, 0]),
        });
      });
      break;
    }
  }
  return { shapes: [], solids };
}

/**
 * Mây 2D: union các thuỳ tròn — bán kính theo pattern cố định (deterministic,
 * không random). Node boolean mang id = part.id (emit/cutout trỏ được).
 */
export function buildCloud(part: CloudPart): PartBuild {
  const rPattern = [0.5, 0.68, 0.56, 0.72, 0.52, 0.64, 0.58];
  const shapes: Shape2D[] = [];
  const lobeIds: string[] = [];
  // Thuỳ phải CHỒNG nhau: spread hẹp (55% width) + bán kính lớn
  const usableW = part.width * 0.55;
  for (let i = 0; i < part.lobes; i++) {
    const t = part.lobes === 1 ? 0.5 : i / (part.lobes - 1);
    const r = (part.height / 2) * rPattern[i % rPattern.length] * 1.7;
    const id = `${part.id}:lobe${i}`;
    lobeIds.push(id);
    shapes.push({
      ...SHAPE_DEFAULTS,
      id,
      type: "circle",
      r,
      at: [-usableW / 2 + t * usableW, (i % 2 === 0 ? 1 : -0.4) * part.height * 0.08],
    });
  }
  shapes.push({
    ...SHAPE_DEFAULTS,
    id: part.id,
    type: "boolean",
    op: "union",
    of: lobeIds,
    at: part.at,
    rotate: part.rotate,
    scale: part.scale,
    fill: part.fill ?? "#ffffff",
  });
  return { shapes, solids: [] };
}

/** Mũi tên 2D chỉ +x, tâm tại giữa thân. */
export function buildArrow(part: ArrowPart): PartBuild {
  const L = part.length;
  const sw = part.shaftWidth / 2;
  const hw = part.headWidth / 2;
  const hl = part.headLength;
  const shapes: Shape2D[] = [
    {
      ...SHAPE_DEFAULTS,
      id: part.id,
      type: "polygon",
      points: [
        [-L / 2, -sw],
        [L / 2 - hl, -sw],
        [L / 2 - hl, -hw],
        [L / 2, 0],
        [L / 2 - hl, hw],
        [L / 2 - hl, sw],
        [-L / 2, sw],
      ],
      at: part.at,
      rotate: part.rotate,
      scale: part.scale,
      fill: part.fill ?? "#f2b134",
    },
  ];
  return { shapes, solids: [] };
}
