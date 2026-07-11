import { z } from "zod";
import { CONSTRUCT_LIMITS } from "@/lib/config/limits";
import { ASPECT_RATIOS, RESOLUTIONS } from "@/lib/validation/schemas";

/**
 * constructSchema — hợp đồng spec kỷ hà cho POST /api/construct.
 * Thiết kế LLM-ergonomic: list phẳng ref theo id, độ (degrees), default
 * mọi nơi, giới hạn số học chặn ngay tầng validate.
 */

const MAX = CONSTRUCT_LIMITS.maxCoord;
const num = z.number().min(-MAX).max(MAX);
const pos = z.number().gt(0).max(MAX);
const deg = z.number().min(-3600).max(3600);
const vec2 = z.tuple([num, num]);
const vec3 = z.tuple([num, num, num]);
const segments = z.number().int().min(3).max(CONSTRUCT_LIMITS.maxSegments);

/** Id shape/solid: chữ cái đầu, sau đó chữ/số/_/- (KHÔNG cho phép prefix cg- reserved). */
export const constructId = z
  .string()
  .regex(/^[A-Za-z][\w-]{0,63}$/, "Id must start with a letter (letters, digits, _, - allowed)")
  .refine((s) => !s.startsWith("cg-"), { message: 'The "cg-" prefix is reserved for engine gradients' });

/** Fill an toàn theo sanitizer: hex, url(#id) local, hoặc none. */
export const fillColor = z
  .string()
  .regex(
    /^(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|url\(#[A-Za-z][\w-]{0,63}\)|none)$/,
    'Fill must be #hex, url(#localId), or "none"',
  );

const scale2 = z.union([z.number().gt(0).max(1000), z.tuple([z.number().gt(0).max(1000), z.number().gt(0).max(1000)])]);
const scale3 = z.union([z.number().gt(0).max(1000), z.tuple([z.number().gt(0).max(1000), z.number().gt(0).max(1000), z.number().gt(0).max(1000)])]);

// ---------- 2D shapes ----------

const shapeBase = {
  id: constructId,
  at: vec2.default([0, 0]),
  rotate: deg.default(0),
  scale: scale2.default(1),
  skew: vec2.default([0, 0]),
  mirror: z.enum(["x", "y"]).optional(),
  fill: fillColor.optional(),
  stroke: fillColor.optional(),
  strokeWidth: z.number().gt(0).max(500).optional(),
};

export const shape2dSchema = z.discriminatedUnion("type", [
  z.object({ ...shapeBase, type: z.literal("rect"), w: pos, h: pos, rx: z.number().min(0).max(MAX).default(0) }),
  z.object({ ...shapeBase, type: z.literal("circle"), r: pos }),
  z.object({ ...shapeBase, type: z.literal("ellipse"), rx: pos, ry: pos }),
  z.object({ ...shapeBase, type: z.literal("polygon"), points: z.array(vec2).min(3).max(256) }),
  z.object({ ...shapeBase, type: z.literal("regularPolygon"), sides: z.number().int().min(3).max(64), r: pos }),
  z.object({ ...shapeBase, type: z.literal("star"), points: z.number().int().min(3).max(32), rOuter: pos, rInner: pos }),
  z.object({ ...shapeBase, type: z.literal("line"), points: z.array(vec2).min(2).max(256), strokeWidth: z.number().gt(0).max(500).default(4) }),
  z.object({ ...shapeBase, type: z.literal("path"), d: z.string().min(1).max(20_000) }),
  z.object({
    ...shapeBase,
    type: z.literal("boolean"),
    op: z.enum(["union", "difference", "intersection", "exclusion"]),
    of: z.array(constructId).min(2).max(CONSTRUCT_LIMITS.maxBooleanOperands),
  }),
]);

export type Shape2D = z.infer<typeof shape2dSchema>;

// ---------- 3D solids ----------

const solidBase = {
  id: constructId,
  at: vec3.default([0, 0, 0]),
  rotate: vec3.default([0, 0, 0]),
  scale: scale3.default(1),
  fill: fillColor.optional(),
  /** auto = smooth cho sphere/cylinder/cone, faceted cho khối phẳng. */
  shading: z.enum(["auto", "faceted", "smooth", "none"]).default("auto"),
  /** false = solid này không đổ bóng (khi spec.shadow bật). */
  shadow: z.boolean().default(true),
};

export const solidSchema = z.discriminatedUnion("type", [
  z.object({ ...solidBase, type: z.literal("box"), size: z.tuple([pos, pos, pos]) }),
  z.object({ ...solidBase, type: z.literal("cylinder"), r: pos, h: pos, segments: segments.default(CONSTRUCT_LIMITS.defaultSegments) }),
  z.object({ ...solidBase, type: z.literal("cone"), r: pos, h: pos, rTop: z.number().min(0).max(MAX).default(0), segments: segments.default(CONSTRUCT_LIMITS.defaultSegments) }),
  z.object({ ...solidBase, type: z.literal("sphere"), r: pos, segments: segments.default(CONSTRUCT_LIMITS.defaultSegments) }),
  z.object({ ...solidBase, type: z.literal("prism"), sides: z.number().int().min(3).max(64), r: pos, h: pos }),
  z.object({ ...solidBase, type: z.literal("pyramid"), sides: z.number().int().min(3).max(64), r: pos, h: pos }),
  z.object({ ...solidBase, type: z.literal("extrude"), profile: constructId, depth: pos }),
  z.object({
    ...solidBase,
    type: z.literal("csg"),
    op: z.enum(["union", "difference", "intersection"]),
    /** Operand là SOLID id (kể cả csg khác — lồng được); bị tiêu thụ, không vẽ riêng. */
    of: z.array(constructId).min(2).max(8),
  }),
]);

export type Solid = z.infer<typeof solidSchema>;

// ---------- Cutouts ----------

export const cutoutSchema = z.object({
  solid: constructId,
  /** Nhãn mặt (box/extrude/nắp trụ) hoặc faceIndex số. */
  face: z.union([z.enum(["top", "bottom", "front", "back", "left", "right"]), z.number().int().min(0)]),
  shape: constructId,
  at: vec2.default([0, 0]),
  rotate: deg.default(0),
  scale: z.number().gt(0).max(1000).default(1),
  mode: z.enum(["subtract", "overlay"]).default("subtract"),
  /** Màu decal khi overlay (subtract bỏ qua). */
  fill: fillColor.optional(),
});

export type Cutout = z.infer<typeof cutoutSchema>;

// ---------- Camera / light / place ----------

export const cameraSchema = z
  .object({
    preset: z.enum(["isometric", "isometric-2:1", "dimetric", "top", "front", "side"]).optional(),
    /** Orbit tự do — ghi đè preset. */
    orbit: z.object({ azimuth: deg, elevation: deg, roll: deg.default(0) }).optional(),
    projection: z.enum(["orthographic", "perspective"]).default("orthographic"),
    /** Perspective only: fov chỉ mang tính tài liệu — engine dùng distance. */
    distance: z.number().gt(0).max(1e6).optional(),
    zoom: z.number().gt(0).max(100).default(1),
  })
  .default({ preset: "isometric", projection: "orthographic", zoom: 1 });

export const lightSchema = z
  .object({
    /** Hướng ánh sáng ĐI TỚI, world-space. Default tách 3 tông chuẩn iso. */
    direction: vec3.default([-0.3, -1.7, -1]),
    tones: z.number().int().min(2).max(8).default(3),
    ambient: z.number().min(0).max(1).default(0.3),
    mode: z.enum(["quantized", "smooth"]).default("quantized"),
  })
  .default({ direction: [-0.3, -1.7, -1], tones: 3, ambient: 0.3, mode: "quantized" });

export const placeSchema = z
  .object({
    at: vec2.default([960, 540]),
    scale: z.number().gt(0).max(1000).default(1),
    rotate: deg.default(0),
  })
  .default({ at: [960, 540], scale: 1, rotate: 0 });

// ---------- Spec + request ----------

export const constructSpecSchema = z
  .object({
    version: z.literal(1),
    shapes: z.array(shape2dSchema).max(128).default([]),
    solids: z.array(solidSchema).max(128).default([]),
    cutouts: z.array(cutoutSchema).max(32).default([]),
    /**
     * "exact" (default): Newell–Newell–Sancha — đúng cả khi khối xuyên
     * nhau (cắt lazy khi xung đột). "painter": sort centroid thuần, nhanh
     * hơn, có thể sai vùng giao.
     */
    depthSort: z.enum(["exact", "painter"]).default("exact"),
    /** Bóng đổ xuống mặt đất y=ground — có mặt là bật. */
    shadow: z
      .object({
        style: z.enum(["silhouette", "blob", "long", "none"]).default("silhouette"),
        color: z.string().regex(/^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$/).default("#000000"),
        opacity: z.number().min(0).max(1).default(0.25),
        /** 0 = mép sắc thuần vector; >0 = feGaussianBlur stdDeviation. */
        blur: z.number().min(0).max(50).default(0),
        /** Cao độ world y của mặt đất. */
        ground: num.default(0),
        /** Chiều dài long shadow (style "long") — default 2.5× scene. */
        longLength: pos.optional(),
      })
      .optional(),
    camera: cameraSchema,
    light: lightSchema,
    place: placeSchema,
    /** 2D shape nào được emit (default: shape không bị tiêu thụ bởi boolean/extrude/cutout). */
    emit: z.array(constructId).max(128).optional(),
    /** Viền outline cho mọi path (phong cách comic). */
    stroke: z.object({ color: fillColor, width: z.number().gt(0).max(100) }).optional(),
    precision: z.number().int().min(0).max(4).default(2),
  })
  .strict()
  .refine((s) => s.shapes.length + s.solids.length > 0, {
    message: "Spec needs at least one shape or solid",
  })
  .refine((s) => s.shapes.length + s.solids.length + s.cutouts.length <= CONSTRUCT_LIMITS.maxNodes, {
    message: `Total shapes + solids + cutouts must be <= ${CONSTRUCT_LIMITS.maxNodes}`,
  });

export type ConstructSpec = z.infer<typeof constructSpecSchema>;

export const constructRequestSchema = z.object({
  spec: constructSpecSchema,
  /** Có mặt ⇒ response kèm previewPng (data URI). */
  preview: z
    .object({
      aspectRatio: z.enum(ASPECT_RATIOS).default("16:9"),
      resolution: z.enum(RESOLUTIONS).default("1K"),
      background: z.string().regex(/^#[0-9a-fA-F]{3,8}$/).default("#1a1a2e"),
    })
    .optional(),
});
