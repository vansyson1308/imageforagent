import sharp from "sharp";
import { LOGICAL_CANVAS, renderArtwork, sanitizeSvg } from "@/lib/services/svgRenderer";
import { MOTION_LIMITS } from "@/lib/config/limits";
import {
  composeMotionFrame,
  createMotionCompiler,
  type MotionStats,
} from "@/lib/services/motion/compileMotion";
import type { MotionContext } from "@/lib/services/motion/evaluate";
import type { MotionSpec } from "@/lib/validation/motionSchema";
import type { RenderPass } from "@/lib/services/construct/compile";
import { poseSkeletonSvg, toOpenPoseJson } from "@/lib/services/construct/pose2d";

/**
 * motionRenderer — rìa I/O-free (chỉ sharp) của motion engine: compile từng
 * frame (pure core) → ghép nền/backdrop/overlay → SANITIZE body hoàn chỉnh
 * (backdrop/overlay là input agent) → rasterize bằng pipeline artwork sẵn có.
 * Đồng bộ theo hợp đồng dự án (không job queue) — nhưng nhường event loop
 * giữa các frame để server vẫn phản hồi request khác.
 */

export interface RenderedFrame {
  readonly index: number;
  readonly t: number;
  /** Scene body hoàn chỉnh (nền + backdrop + construct + overlay). */
  readonly body: string;
  /** SVG construct thuần của frame (không nền/backdrop). */
  readonly constructSvg: string;
  readonly png: Buffer;
}

export interface ClipRenderOptions {
  readonly motion: MotionSpec;
  readonly ctx?: MotionContext;
  readonly defs: string | null;
  readonly aspectRatio: string;
  readonly resolution: string;
  /** Gọi cho mỗi frame ngay khi render xong (ghi đĩa dần, không giữ hết RAM). */
  readonly onFrame?: (frame: RenderedFrame) => Promise<void> | void;
  /** Giữ PNG trong kết quả (preview) — tắt khi đã ghi đĩa qua onFrame. */
  readonly keepFrames?: boolean;
}

export interface ClipRenderResult {
  readonly stats: MotionStats & { readonly renderMs: number };
  readonly warnings: string[];
  readonly frames: RenderedFrame[];
  /** Body của frame poster (ảnh tĩnh storyboard). */
  readonly posterBody: string;
  readonly posterPng: Buffer;
}

const yieldLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

export async function renderMotionClip(opts: ClipRenderOptions): Promise<ClipRenderResult> {
  const t0 = performance.now();
  const canvas = LOGICAL_CANVAS[opts.aspectRatio] ?? LOGICAL_CANVAS["16:9"];
  // Sanitize layer tĩnh của agent MỘT lần — lỗi báo đúng field
  if (opts.motion.backdrop) sanitizeSvg(opts.motion.backdrop, "frame");
  if (opts.motion.overlay) sanitizeSvg(opts.motion.overlay, "frame");

  const compiler = createMotionCompiler(opts.motion, opts.ctx);
  const { posterIndex } = compiler.summary().stats;
  const frames: RenderedFrame[] = [];
  let posterBody = "";
  let posterPng: Buffer | null = null;
  let prevBody: string | null = null;
  let prevPng: Buffer | null = null;

  for (let i = 0; i < compiler.frameCount; i++) {
    const f = compiler.compileFrame(i);
    const body = composeMotionFrame(opts.motion, f.svg, canvas);
    // Frame giống hệt frame trước (hold/tĩnh) → tái dùng PNG, không raster lại
    let png: Buffer;
    if (body === prevBody && prevPng) {
      png = prevPng;
    } else {
      // Defense-in-depth: ghép chuỗi không được tạo pattern cấm xuyên ranh giới
      sanitizeSvg(body, "frame");
      png = await renderArtwork(opts.defs, body, opts.aspectRatio, opts.resolution);
    }
    prevBody = body;
    prevPng = png;
    const rendered: RenderedFrame = { index: i, t: f.t, body, constructSvg: f.svg, png };
    if (i === posterIndex) {
      posterBody = body;
      posterPng = png;
    }
    if (opts.onFrame) await opts.onFrame(rendered);
    if (opts.keepFrames !== false) frames.push(rendered);
    await yieldLoop();
  }

  const summary = compiler.summary();
  return {
    stats: { ...summary.stats, renderMs: Math.round(performance.now() - t0) },
    warnings: summary.warnings,
    frames,
    posterBody,
    posterPng: posterPng!,
  };
}

// ---------- Control passes ----------

export const CONTROL_PASSES = ["depth", "segmentation", "normal", "pose"] as const;
export type ControlPass = (typeof CONTROL_PASSES)[number];

export interface PassRenderResult {
  readonly pass: ControlPass;
  readonly pngs: Buffer[];
  readonly times: number[];
  /** Chỉ pose: JSON OpenPose từng frame. */
  readonly openpose?: Record<string, unknown>[];
}

/**
 * Render MỘT control pass cho cả clip: nền đen, không backdrop/overlay
 * (pass đo hình khối 3D). depth/segmentation/normal = compile với
 * options.pass; pose = skeleton OpenPose vẽ từ khớp FK.
 */
export async function renderPassClip(opts: {
  readonly motion: MotionSpec;
  readonly ctx?: MotionContext;
  readonly pass: ControlPass;
  readonly aspectRatio: string;
  readonly resolution: string;
  readonly onFrame?: (index: number, png: Buffer) => Promise<void> | void;
  readonly keepFrames?: boolean;
}): Promise<PassRenderResult> {
  const canvas = LOGICAL_CANVAS[opts.aspectRatio] ?? LOGICAL_CANVAS["16:9"];
  const compiler = createMotionCompiler(
    opts.motion,
    opts.ctx,
    opts.pass === "pose" ? {} : { pass: opts.pass as RenderPass },
  );
  const pngs: Buffer[] = [];
  const times: number[] = [];
  const openpose: Record<string, unknown>[] = [];
  let prevBody: string | null = null;
  let prevPng: Buffer | null = null;
  for (let i = 0; i < compiler.frameCount; i++) {
    let body: string;
    if (opts.pass === "pose") {
      const pf = compiler.poseFrame(i, canvas);
      openpose.push(toOpenPoseJson(pf));
      body = poseSkeletonSvg(pf);
    } else {
      const f = compiler.compileFrame(i);
      body = `<rect width="${canvas.w}" height="${canvas.h}" fill="#000000"/>\n${f.svg}`;
    }
    let png: Buffer;
    if (body === prevBody && prevPng) png = prevPng;
    else {
      sanitizeSvg(body, "frame");
      png = await renderArtwork(null, body, opts.aspectRatio, opts.resolution);
    }
    prevBody = body;
    prevPng = png;
    if (opts.onFrame) await opts.onFrame(i, png);
    if (opts.keepFrames !== false) pngs.push(png);
    times.push(i / opts.motion.fps);
    await yieldLoop();
  }
  return { pass: opts.pass, pngs, times, ...(opts.pass === "pose" && { openpose }) };
}

// ---------- Encoders ----------

/** Cạnh dài tối đa của animated WebP (preview/clip xem nhanh) — giữ RAM join bị chặn. */
export const CLIP_PREVIEW_LONG_EDGE = 640;

/**
 * Animated WebP: gộp frame liên tiếp giống hệt thành MỘT frame với delay
 * cộng dồn (hold/on-twos rẻ), downscale về CLIP_PREVIEW_LONG_EDGE.
 */
export async function encodeAnimatedWebp(
  pngs: readonly Buffer[],
  fps: number,
  longEdge = CLIP_PREVIEW_LONG_EDGE,
): Promise<Buffer> {
  const frameMs = 1000 / fps;
  const unique: Buffer[] = [];
  const delays: number[] = [];
  for (let i = 0; i < pngs.length; i++) {
    const endMs = Math.round((i + 1) * frameMs);
    const startMs = Math.round(i * frameMs);
    if (i > 0 && pngs[i].equals(pngs[i - 1])) {
      delays[delays.length - 1] += endMs - startMs;
    } else {
      unique.push(pngs[i]);
      delays.push(endMs - startMs);
    }
  }
  const resized = await Promise.all(
    unique.map((p) =>
      sharp(p).resize(longEdge, longEdge, { fit: "inside", withoutEnlargement: true }).png().toBuffer(),
    ),
  );
  if (resized.length === 1) {
    return sharp(resized[0]).webp({ quality: 80 }).toBuffer();
  }
  return sharp(resized, { join: { animated: true } })
    .webp({ delay: delays, loop: 0, quality: 75, effort: 2 })
    .toBuffer();
}

/**
 * Contact sheet — lưới N frame lấy mẫu đều (gồm frame đầu + cuối), mỗi ô
 * kèm thanh tiến độ thời gian ở đáy (không dùng text — font lệch theo OS).
 * Đây là cách agent NHÌN chuyển động: một ảnh PNG duy nhất.
 */
export async function encodeContactSheet(
  pngs: readonly Buffer[],
  count: number,
  frameTimes: readonly number[],
  duration: number,
): Promise<Buffer> {
  const n = Math.max(1, Math.min(count, pngs.length, MOTION_LIMITS.maxSheetFrames));
  const picks =
    n === 1 ? [0] : Array.from({ length: n }, (_, k) => Math.round((k * (pngs.length - 1)) / (n - 1)));
  const meta = await sharp(pngs[0]).metadata();
  const w0 = meta.width ?? 1024;
  const h0 = meta.height ?? 576;
  const tileLong = 384;
  const scale = tileLong / Math.max(w0, h0);
  const tw = Math.round(w0 * scale);
  const th = Math.round(h0 * scale);
  const bar = 6;
  const gap = 4;
  const cols = Math.min(4, n);
  const rows = Math.ceil(n / cols);
  const cellH = th + bar;
  const tiles = await Promise.all(
    picks.map(async (idx) => {
      const img = await sharp(pngs[idx]).resize(tw, th).png().toBuffer();
      const progress = duration > 0 ? Math.min(1, frameTimes[idx] / duration) : 0;
      const barSvg = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${tw}" height="${bar}"><rect width="${tw}" height="${bar}" fill="#2a2f45"/><rect width="${Math.max(1, Math.round(tw * progress))}" height="${bar}" fill="#f4b23c"/></svg>`,
      );
      return { img, barSvg };
    }),
  );
  const width = cols * tw + (cols - 1) * gap;
  const height = rows * cellH + (rows - 1) * gap;
  const composites = tiles.flatMap((tile, k) => {
    const left = (k % cols) * (tw + gap);
    const top = Math.floor(k / cols) * (cellH + gap);
    return [
      { input: tile.img, left, top },
      { input: tile.barSvg, left, top: top + th },
    ];
  });
  return sharp({ create: { width, height, channels: 3, background: "#0d0f18" } })
    .composite(composites)
    .png()
    .toBuffer();
}
