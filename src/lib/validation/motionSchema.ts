import { z } from "zod";
import { CONSTRUCT_LIMITS, MOTION_LIMITS } from "@/lib/config/limits";
import { ASPECT_RATIOS, RESOLUTIONS } from "@/lib/validation/schemas";
import { constructId, constructSpecSchema, refId } from "@/lib/validation/constructSchema";

/**
 * motionSchema — hợp đồng TRỤC THỜI GIAN cho construct engine (v4).
 * Một motion spec = MỘT shot: scene construct gốc + tracks keyframe + rigs
 * thủ tục, lấy mẫu ở fps → mỗi frame là một lần compile construct đầy đủ.
 * Thiết kế LLM-ergonomic: target là đường dẫn chấm theo id
 * ("parts.hero.pose.kneeL", "camera.orbit.azimuth", "solids.ball.at.1"),
 * thời gian bằng GIÂY, góc bằng ĐỘ, easing theo tên.
 */

const MAX = CONSTRUCT_LIMITS.maxCoord;
const num = z.number().min(-MAX).max(MAX);
const seconds = z.number().min(0).max(MOTION_LIMITS.maxDuration);
const hexColor = z.string().regex(/^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$/, "Color must be #hex");

/** Tên easing — "inOut" (slow-in/slow-out) là default: nguyên lý hoạt hình #6. */
export const EASE_NAMES = [
  "linear",
  "step",
  "in",
  "out",
  "inOut",
  "inBack",
  "outBack",
  "outElastic",
  "outBounce",
  "smooth",
] as const;

export type EaseName = (typeof EASE_NAMES)[number];

/** Easing: tên, hoặc cubic-bezier CSS [x1, y1, x2, y2] (x ∈ [0,1]). */
export const easeSchema = z.union([
  z.enum(EASE_NAMES),
  z.tuple([z.number().min(0).max(1), z.number().min(-5).max(5), z.number().min(0).max(1), z.number().min(-5).max(5)]),
]);

export type Ease = z.infer<typeof easeSchema>;

/** Giá trị key: số, vector 2-4 số, hoặc màu #hex. */
export const keyValueSchema = z.union([num, z.array(num).min(2).max(4), hexColor]);

export type KeyValue = z.infer<typeof keyValueSchema>;

export const keySchema = z
  .object({
    /** Thời điểm (giây, tính từ đầu shot). */
    t: seconds,
    v: keyValueSchema,
    /** Easing của đoạn ĐI TỚI key này (từ key trước). Default "inOut". */
    ease: easeSchema.optional(),
  })
  .strict();

export type Key = z.infer<typeof keySchema>;

/**
 * Đường dẫn target: root.(id.)field(.field|.index)*
 * root ∈ camera | light | place | shadow | atmosphere (object) hoặc
 * shapes | solids | parts | groups | gradients (theo id).
 */
export const targetPathSchema = z
  .string()
  .max(200)
  .regex(
    /^[A-Za-z][\w-]{0,63}(\.[\w-]{1,64}){1,6}$/,
    'Target must be a dotted path like "camera.orbit.azimuth" or "parts.hero.pose.kneeL"',
  );

function valueKind(v: KeyValue): string {
  if (typeof v === "number") return "number";
  if (typeof v === "string") return "color";
  return `vec${v.length}`;
}

export const trackSchema = z
  .object({
    target: targetPathSchema,
    keys: z.array(keySchema).min(1).max(MOTION_LIMITS.maxKeysPerTrack),
    /** "set" = ghi đè giá trị gốc; "add" = cộng vào giá trị gốc (chỉ số/vector). */
    blend: z.enum(["set", "add"]).default("set"),
  })
  .strict()
  .refine((tr) => tr.keys.every((k, i) => i === 0 || k.t > tr.keys[i - 1].t), {
    message: "Track keys must have strictly increasing t",
  })
  .refine((tr) => tr.keys.every((k) => valueKind(k.v) === valueKind(tr.keys[0].v)), {
    message: "All keys of a track must share one value type (number, same-length vector, or #hex color)",
  })
  .refine((tr) => tr.blend === "set" || typeof tr.keys[0].v !== "string", {
    message: 'blend "add" works on numbers/vectors only — colors must use blend "set"',
  });

export type Track = z.infer<typeof trackSchema>;

// ---------- Rigs thủ tục ----------

const timeWindow = {
  /** Bắt đầu (giây). */
  start: seconds.default(0),
  /** Kết thúc (giây) — vắng = hết shot. */
  end: seconds.optional(),
};

export const SHOT_MOVES = [
  "static",
  "dollyIn",
  "dollyOut",
  "orbit",
  "crane",
  "pan",
  "tilt",
  "shake",
  "auto",
] as const;

export type ShotMove = (typeof SHOT_MOVES)[number];

export const rigSchema = z.discriminatedUnion("type", [
  z
    .object({
      /**
       * Walk cycle cho part figure — chu kỳ bước TÍNH TỪ chiều dài chân nên
       * bàn chân KHÔNG trượt; đi dọc polyline trên mặt đất [x, z].
       */
      type: z.literal("walk"),
      part: constructId,
      path: z.array(z.tuple([num, num])).min(2).max(MOTION_LIMITS.maxPathPoints),
      ...timeWindow,
      /** Biên độ vung hông (độ) — vắng = tự suy từ tốc độ (nhịp ~2 bước/giây). */
      swing: z.number().min(4).max(45).optional(),
      /** Biên độ vung tay (độ); 0 = tay giữ nguyên pose gốc. */
      armSwing: z.number().min(0).max(60).default(22),
      /** Hệ số nhún thân (0 = không nhún). */
      bounce: z.number().min(0).max(2).default(1),
      /** Nghiêng thân về trước (độ). */
      lean: z.number().min(-30).max(30).default(4),
      /** Nhịp bước khi tự suy swing (bước/giây). */
      cadence: z.number().min(0.5).max(5).default(2),
    })
    .strict(),
  z
    .object({
      /**
       * Lăn không trượt: góc xoay = quãng đường / bán kính, đọc từ vị trí
       * `follow` (default: chính target) SAU khi tracks áp dụng.
       */
      type: z.literal("roll"),
      target: targetPathSchema,
      follow: targetPathSchema.optional(),
      radius: z.number().gt(0).max(MAX),
      /** Trục di chuyển trên mặt đất. */
      along: z.enum(["x", "z"]).default("x"),
    })
    .strict(),
  z
    .object({
      /**
       * Nhiễu mượt TẤT ĐỊNH (value noise theo seed) cộng vào target —
       * camera cầm tay, thở, lá rung, nhân vật idle.
       */
      type: z.literal("wiggle"),
      target: targetPathSchema,
      amplitude: z.union([z.number().min(0).max(MAX), z.array(z.number().min(0).max(MAX)).min(2).max(4)]),
      /** Tần số (Hz). */
      frequency: z.number().gt(0).max(30).default(1),
      seed: z.number().int().min(0).max(1_000_000).default(1),
      octaves: z.number().int().min(1).max(3).default(2),
      ...timeWindow,
    })
    .strict(),
  z
    .object({
      /**
       * IK 2 xương GIẢI TÍCH: đặt cổ tay (arm) / đế chân (leg) tới target —
       * điểm cố định, hoặc BÁM một solid đang chuyển động ("cart" hay
       * "wl:hub") + offset. Góc vai/khuỷu (hông/gối) được giải, cổ chân tự
       * giữ bàn chân phẳng. weight + fade để hoà với chuyển động nền.
       */
      type: z.literal("ik"),
      part: constructId,
      limb: z.enum(["armL", "armR", "legL", "legR"]),
      target: z.union([
        z.tuple([num, num, num]),
        z.object({ solid: refId, offset: z.tuple([num, num, num]).default([0, 0, 0]) }).strict(),
      ]),
      /** Hướng gập khớp giữa (không gian part): default khuỷu ra sau, gối ra trước. */
      pole: z.tuple([num, num, num]).optional(),
      weight: z.number().min(0).max(1).default(1),
      /** Giây hoà vào/ra ở hai đầu cửa sổ. */
      fade: z.number().min(0).max(2).default(0.15),
      ...timeWindow,
    })
    .strict(),
  z
    .object({
      /**
       * Follow-through / overlap (nguyên lý #5): target lặp lại chuyển động
       * của source TRỄ `lag` giây × gain — đầu trễ nhịp thân, đuôi, ăng-ten.
       * add (default): target += gain·(source(t−lag) − source gốc).
       */
      type: z.literal("follow"),
      source: targetPathSchema,
      target: targetPathSchema,
      lag: z.number().min(0).max(2).default(0.1),
      gain: z.number().min(-10).max(10).default(1),
      blend: z.enum(["set", "add"]).default("add"),
    })
    .strict(),
  z
    .object({
      /**
       * Chuyển động máy quay theo ngôn ngữ storyboard. "auto" = suy từ
       * shotType của frame ("Slow zoom-in" → dollyIn, "Pan" → pan…).
       */
      type: z.literal("shot"),
      move: z.enum(SHOT_MOVES),
      /** Độ lớn — đơn vị theo move (xem README); vắng = default của move. */
      amount: z.number().min(-MAX).max(MAX).optional(),
      ease: easeSchema.default("inOut"),
      ...timeWindow,
    })
    .strict(),
]);

export type Rig = z.infer<typeof rigSchema>;

// ---------- Motion spec ----------

const svgLayer = z
  .string()
  .max(MOTION_LIMITS.maxLayerBytes)
  .optional();

export const motionSpecSchema = z
  .object({
    version: z.literal(1),
    /** 12 = "animate on twos" (mặc định hoạt hình), 24 = điện ảnh. */
    fps: z.number().int().min(1).max(MOTION_LIMITS.maxFps).default(12),
    /**
     * Giữ mỗi pose N frame — 2 = "animate on twos" (12 pose/giây ở 24fps).
     * Chỉ áp cho nhân vật/vật thể; camera + place luôn "on ones" (pan không giật).
     */
    holdFrames: z.number().int().min(1).max(4).default(1),
    /** Độ dài shot (giây). */
    duration: z.number().gt(0).max(MOTION_LIMITS.maxDuration),
    /** Scene construct gốc (như POST /api/construct). */
    scene: constructSpecSchema,
    tracks: z.array(trackSchema).max(MOTION_LIMITS.maxTracks).default([]),
    rigs: z.array(rigSchema).max(MOTION_LIMITS.maxRigs).default([]),
    /** Màu nền full-bleed vẽ đầu mỗi frame. */
    background: z.string().regex(/^#[0-9a-fA-F]{3,8}$/).default("#1a1a2e"),
    /** SVG tĩnh vẽ DƯỚI scene mỗi frame (có thể <use href="#…"> vào defs project). */
    backdrop: svgLayer,
    /** SVG tĩnh vẽ TRÊN scene mỗi frame (khung, chữ, grain…). */
    overlay: svgLayer,
    /** Thời điểm (giây) lấy làm ảnh tĩnh storyboard của frame. */
    poster: seconds.default(0),
  })
  .strict()
  .refine((m) => Math.max(1, Math.round(m.duration * m.fps)) <= MOTION_LIMITS.maxFrames, {
    message: `duration × fps must be <= ${MOTION_LIMITS.maxFrames} frames — lower fps (12 is standard for animation) or split the shot`,
  })
  .refine((m) => m.poster <= m.duration, { message: '"poster" must be within the shot duration' });

export type MotionSpec = z.infer<typeof motionSpecSchema>;

export const motionPreviewSchema = z
  .object({
    aspectRatio: z.enum(ASPECT_RATIOS).default("16:9"),
    resolution: z.enum(RESOLUTIONS).default("1K"),
    /** Contact sheet: lưới N frame lấy mẫu đều — agent NHÌN chuyển động trong 1 ảnh PNG. */
    sheet: z.boolean().default(true),
    sheetFrames: z.number().int().min(2).max(MOTION_LIMITS.maxSheetFrames).default(12),
    /** Animated WebP của cả clip (data URI). */
    webp: z.boolean().default(false),
    /** Trả SVG từng frame (nặng — chỉ khi cần tự lắp ráp). */
    includeSvg: z.boolean().default(false),
  })
  .strict();

export const motionRequestSchema = z.object({
  motion: motionSpecSchema,
  /** shotType của storyboard — cho rig shot move:"auto". */
  shotType: z.string().max(200).optional(),
  preview: motionPreviewSchema.optional(),
});
