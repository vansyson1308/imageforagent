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

/**
 * Ref có thể trỏ vào solid SINH TỪ PART: "wheelL:hub". User không thể tự
 * đặt id chứa ":" (constructId cấm) — namespace không thể đụng độ.
 */
export const refId = z
  .string()
  .regex(/^[A-Za-z][\w-]{0,63}(:[\w-]{1,64})?$/, 'Ref must be an id, optionally "partId:segment"');

/** Fill an toàn theo sanitizer: hex, url(#id) local, hoặc none. */
export const fillColor = z
  .string()
  .regex(
    /^(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|url\(#[A-Za-z][\w-]{0,63}\)|none)$/,
    'Fill must be #hex, url(#localId), or "none"',
  )
  .refine((s) => !s.startsWith("url(#cg-"), {
    message: 'Gradient ids with the "cg-" prefix are engine-reserved — declare yours in "gradients" and reference it by your own id',
  });

const scale2 = z.union([z.number().gt(0).max(1000), z.tuple([z.number().gt(0).max(1000), z.number().gt(0).max(1000)])]);
const scale3 = z.union([z.number().gt(0).max(1000), z.tuple([z.number().gt(0).max(1000), z.number().gt(0).max(1000), z.number().gt(0).max(1000)])]);

const hexColor = z.string().regex(/^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$/, "Color must be #hex");

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
  /** "foreground" = vẽ TRÊN mọi solid 3D (sương mù, haze, khung cảnh cận). */
  layer: z.enum(["background", "foreground"]).default("background"),
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

// ---------- Effects (Softness layer — lưỡi liềm overlay per-solid) ----------

const effectOpacity = z.number().min(0).max(1);

/**
 * One Boolean Rule: silhouette S + hướng sáng màn hình L + R = ½ cạnh
 * ngắn bbox — mọi lớp đều là S kết hợp bản shift của chính nó. true =
 * default; object = tinh chỉnh; thiếu field trong object → default field.
 */
export const effectsSchema = z
  .object({
    /** Lưỡi liềm TỐI phía khuất: S − shift(S, shift·R về phía sáng). */
    formShadow: z
      .union([
        z.boolean(),
        z
          .object({
            shift: z.number().min(0.05).max(1).default(0.45),
            opacity: effectOpacity.default(0.15),
            /** Default: softShadowColor(fill) — không bao giờ #000. */
            color: hexColor.optional(),
          })
          .strict(),
      ])
      .default(false),
    /** Nửa SÁNG phía nguồn: S ∩ shift(S, shift·R). */
    highlight: z
      .union([
        z.boolean(),
        z
          .object({
            shift: z.number().min(0.05).max(1).default(0.5),
            opacity: effectOpacity.default(0.12),
            /** Default: trắng ấm #fff1dd. */
            color: hexColor.optional(),
          })
          .strict(),
      ])
      .default(false),
    /** Viền sáng mỏng mép khuất (backlight): S − shift(S, width·R). */
    rim: z
      .union([
        z.boolean(),
        z
          .object({
            width: z.number().min(0.005).max(0.2).default(0.03),
            opacity: effectOpacity.default(0.6),
            /** Default: lạnh sáng #dcecff. */
            color: hexColor.optional(),
          })
          .strict(),
      ])
      .default(false),
    /** Dải TỐI NHẤT sát mép khuất (core shadow): (S − shift(to·R)) ∩ shift(from·R). */
    coreAccent: z
      .union([
        z.boolean(),
        z
          .object({
            from: z.number().min(0).max(0.95).default(0.1),
            to: z.number().min(0.05).max(1).default(0.45),
            opacity: effectOpacity.default(0.2),
            /** Default: màu bóng đậm hơn suy từ fill. */
            color: hexColor.optional(),
          })
          .strict()
          .refine((v) => v.from < v.to, { message: 'coreAccent needs "from" < "to"' }),
      ])
      .default(false),
    /** Đốm bóng gương: đĩa size·R tại tâm dịch offset·R VỀ nguồn, ∩ S. */
    specular: z
      .union([
        z.boolean(),
        z
          .object({
            size: z.number().min(0.02).max(0.5).default(0.12),
            offset: z.number().min(0).max(1).default(0.6),
            opacity: effectOpacity.default(0.5),
            /** Default: trắng #ffffff. */
            color: hexColor.optional(),
          })
          .strict(),
      ])
      .default(false),
    /**
     * Quầng sáng SAU LƯNG solid. "halo" = radial gradient (RẺ — default);
     * "blur" = bản sao silhouette + feGaussianBlur (ĐẮT, tính vào maxFilters).
     */
    glow: z
      .union([
        z.boolean(),
        z
          .object({
            mode: z.enum(["halo", "blur"]).default("halo"),
            size: z.number().min(1.05).max(4).default(1.6),
            opacity: effectOpacity.default(0.5),
            /** Default: chính fill của solid (vật tự phát sáng). */
            color: hexColor.optional(),
          })
          .strict(),
      ])
      .default(false),
    /** Bóng tiếp xúc (AO) — ellipse gradient trên ground, KHÔNG filter. */
    contact: z
      .union([
        z.boolean(),
        z
          .object({
            opacity: effectOpacity.default(0.45),
            /** Hệ số nở footprint (1 = ôm sát AABB). */
            scale: z.number().min(0.3).max(2).default(1),
            /** Default: tối lạnh #2c3548. */
            color: hexColor.optional(),
          })
          .strict(),
      ])
      .default(false),
  })
  .strict();

export type SolidEffects = z.infer<typeof effectsSchema>;

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
  /** Gắn vào group (khung FK) — placement solid tính TRONG hệ của group. */
  group: constructId.optional(),
  /** Lớp làm mềm per-solid (Softness) — vắng = không effect; {} = opt-out preset. */
  effects: effectsSchema.optional(),
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
    /** Operand là SOLID id (kể cả csg khác hoặc "partId:segment"); bị tiêu thụ. */
    of: z.array(refId).min(2).max(8),
  }),
]);

export type Solid = z.infer<typeof solidSchema>;

// ---------- Cutouts ----------

export const cutoutSchema = z.object({
  solid: refId,
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

// ---------- Groups (khung FK cha-con) + Parts (macro tham số hoá) ----------

/** Khung toạ độ cha-con: world = M(parent) · SRT(group). Cha khai TRƯỚC con. */
export const groupSchema = z.object({
  id: constructId,
  parent: constructId.optional(),
  at: vec3.default([0, 0, 0]),
  rotate: vec3.default([0, 0, 0]),
  scale: scale3.default(1),
});

export type Group = z.infer<typeof groupSchema>;

const partBase3d = {
  id: constructId,
  at: vec3.default([0, 0, 0]),
  rotate: vec3.default([0, 0, 0]),
  scale: z.number().gt(0).max(1000).default(1),
  group: constructId.optional(),
  /** Passthrough: áp cho MỌI solid sinh từ part (vd rim cho cả figure). */
  effects: effectsSchema.optional(),
};

/**
 * Parts — macro expand thành shapes/solids TRƯỚC compile, id sinh dạng
 * "partId:segment" (user không thể đặt id chứa ':' → không đụng độ).
 */
export const partSchema = z.discriminatedUnion("type", [
  z.object({
    ...partBase3d,
    type: z.literal("figure"),
    /** Chiều cao tổng (đỉnh đầu → đất). */
    height: pos.default(170),
    /** Số "đầu" — 8 = tả thực, 3 = chibi (default storyboard-friendly). */
    headCount: z.number().min(2).max(8).default(3),
    /**
     * Pose theo TÊN KHỚP, độ, TƯƠNG ĐỐI so với A-pose: scalar = gập trục z
     * (profile) hoặc [x,y,z]. Khớp: neck, spine, shoulderL/R, elbowL/R,
     * wristL/R, hipL/R, kneeL/R, ankleL/R.
     */
    pose: z.record(z.string(), z.union([deg, vec3])).default({}),
    fills: z
      .object({ skin: fillColor, shirt: fillColor, pants: fillColor, shoes: fillColor })
      .partial()
      .optional(),
  }),
  z.object({
    ...partBase3d,
    type: z.literal("wheel"),
    /** Trục bánh dọc z (bánh đứng, lăn theo x). */
    radius: pos,
    width: pos,
    /** Bề dày lốp — default radius·0.18. */
    tireProfile: pos.optional(),
    /** Bán kính mâm — default radius·0.28. */
    hubRadius: pos.optional(),
    /** Lỗ trục — 0 = đặc. */
    boreRadius: z.number().min(0).default(0),
    spokes: z.number().int().min(0).max(12).default(6),
    spokeStyle: z.enum(["straight", "none"]).default("straight"),
    spokeWidth: pos.optional(),
    fills: z
      .object({ tire: fillColor, hub: fillColor, spokes: fillColor })
      .partial()
      .optional(),
  }),
  z.object({
    ...partBase3d,
    type: z.literal("tree"),
    trunkH: pos,
    trunkR: pos,
    canopyR: pos,
    style: z.enum(["blob", "cone", "layered"]).default("blob"),
    fills: z.object({ trunk: fillColor, canopy: fillColor }).partial().optional(),
  }),
  z.object({
    /** Macro 2D: union các thuỳ tròn → 1 shape id = part id. */
    id: constructId,
    type: z.literal("cloud"),
    at: vec2.default([0, 0]),
    rotate: deg.default(0),
    scale: z.number().gt(0).max(1000).default(1),
    width: pos,
    height: pos,
    lobes: z.number().int().min(3).max(7).default(4),
    fill: fillColor.optional(),
  }),
  z.object({
    /** Macro 2D: polygon mũi tên chỉ +x, tâm giữa thân. */
    id: constructId,
    type: z.literal("arrow"),
    at: vec2.default([0, 0]),
    rotate: deg.default(0),
    scale: z.number().gt(0).max(1000).default(1),
    length: pos,
    shaftWidth: pos,
    headWidth: pos,
    headLength: pos,
    fill: fillColor.optional(),
  }),
]);

export type Part = z.infer<typeof partSchema>;

// ---------- Gradients (tác giả khai, fill tham chiếu url(#id)) ----------

const gradientStopSchema = z.object({
  offset: z.number().min(0).max(1),
  color: hexColor,
  opacity: z.number().min(0).max(1).optional(),
});

const gradientStops = z
  .array(gradientStopSchema)
  .min(2)
  .max(16)
  .refine((stops) => stops.every((s, i) => i === 0 || s.offset >= stops[i - 1].offset), {
    message: "Stop offsets must be non-decreasing",
  });

/**
 * Gradient tác giả — id vào namespace chung (không được prefix "cg-"),
 * mọi fill/stroke trong spec tham chiếu bằng url(#id) và resolve NỘI BỘ
 * (previewPng render đúng, không cần defs ngoài).
 */
export const gradientSchema = z.discriminatedUnion("kind", [
  z.object({
    id: constructId,
    kind: z.literal("linear"),
    /** Hướng chảy của gradient, độ, screen-space: 0 = sang phải, 90 = xuống dưới. */
    angle: deg.default(90),
    stops: gradientStops,
  }),
  z.object({
    id: constructId,
    kind: z.literal("radial"),
    /** Lệch tâm điểm sáng trong bbox shape: [-0.4..0.4]² (0,0 = giữa). */
    focus: z.tuple([z.number().min(-0.4).max(0.4), z.number().min(-0.4).max(0.4)]).default([0, 0]),
    /** Bán kính theo tỉ lệ bbox (0.5 = chạm mép). */
    radius: z.number().gt(0).max(1).default(0.5),
    stops: gradientStops,
  }),
]);

export type SpecGradient = z.infer<typeof gradientSchema>;

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
    /** gradient = ramp mượt userSpaceOnUse dọc trục sáng trên từng mặt. */
    mode: z.enum(["quantized", "smooth", "gradient"]).default("quantized"),
  })
  .default({ direction: [-0.3, -1.7, -1], tones: 3, ambient: 0.3, mode: "quantized" });

export const placeSchema = z
  .object({
    at: vec2.default([960, 540]),
    scale: z.number().gt(0).max(1000).default(1),
    rotate: deg.default(0),
  })
  .default({ at: [960, 540], scale: 1, rotate: 0 });

// ---------- Atmosphere (scene-wide softness) ----------

export const atmosphereSchema = z
  .object({
    /** Vật càng XA càng ngả về color + bớt bão hoà (aerial perspective). */
    depthFade: z
      .object({
        color: hexColor.default("#9db4cc"),
        strength: z.number().min(0).max(1).default(0.5),
        desaturate: z.number().min(0).max(1).default(0.5),
      })
      .strict()
      .optional(),
    /** Tối 4 góc khung hình — vẽ CUỐI CÙNG, phủ toàn canvas. */
    vignette: z
      .object({
        color: hexColor.default("#101528"),
        strength: z.number().min(0).max(1).default(0.3),
        /** Offset gradient bắt đầu tối (0.55 = hơn nửa khung trong suốt). */
        start: z.number().min(0).max(0.95).default(0.55),
        /** Kích thước canvas logic — đổi khi vẽ 9:16/1:1/4:5. */
        size: z.tuple([pos, pos]).default([1920, 1080]),
      })
      .strict()
      .optional(),
  })
  .strict();

export type Atmosphere = z.infer<typeof atmosphereSchema>;

// ---------- Spec + request ----------

export const constructSpecSchema = z
  .object({
    version: z.literal(1),
    shapes: z.array(shape2dSchema).max(128).default([]),
    solids: z.array(solidSchema).max(128).default([]),
    cutouts: z.array(cutoutSchema).max(32).default([]),
    groups: z.array(groupSchema).max(CONSTRUCT_LIMITS.maxGroups).default([]),
    parts: z.array(partSchema).max(CONSTRUCT_LIMITS.maxParts).default([]),
    /** Gradient tác giả — fill/stroke tham chiếu url(#id), resolve nội bộ. */
    gradients: z.array(gradientSchema).max(CONSTRUCT_LIMITS.maxUserGradients).default([]),
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
    /** Lớp không khí scene-wide: depth fade + vignette. */
    atmosphere: atmosphereSchema.optional(),
    /**
     * Preset làm mềm một-chạm: CHỈ điền effects cho solid CHƯA khai
     * effects (kể cả part-solids); "effects": {} = opt-out per solid.
     * flat = tắt; soft = formShadow+highlight+contact; premium = soft +
     * rim + specular (solid trơn) + vignette nhẹ nếu atmosphere vắng.
     */
    finish: z.enum(["flat", "soft", "premium"]).default("flat"),
    /** 2D shape nào được emit (default: shape không bị tiêu thụ bởi boolean/extrude/cutout). */
    emit: z.array(constructId).max(128).optional(),
    /** Viền outline cho mọi path (phong cách comic). */
    stroke: z.object({ color: fillColor, width: z.number().gt(0).max(100) }).optional(),
    precision: z.number().int().min(0).max(4).default(2),
  })
  .strict()
  .refine((s) => s.shapes.length + s.solids.length + s.parts.length > 0, {
    message: "Spec needs at least one shape, solid, or part",
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
