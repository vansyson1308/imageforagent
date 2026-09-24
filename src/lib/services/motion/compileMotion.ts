import { AppError } from "@/lib/services/apiError";
import { MOTION_LIMITS } from "@/lib/config/limits";
import { compileConstruction } from "@/lib/services/construct/compile";
import type { CompileResult } from "@/lib/services/construct/types";
import type { MotionSpec } from "@/lib/validation/motionSchema";
import {
  evaluateMotionAt,
  frameTime,
  prepareMotion,
  type MotionContext,
  type PreparedMotion,
} from "@/lib/services/motion/evaluate";

/**
 * compileMotion — lấy mẫu motion spec thành chuỗi SVG fragment, mỗi frame
 * là MỘT lần compile construct đầy đủ (mọi đảm bảo của construct giữ nguyên:
 * deterministic, qua sanitizer). Pure: không I/O.
 *
 * Memo theo nội dung scene: frame có scene giống hệt (đoạn hold, "on twos",
 * shot tĩnh) tái dùng kết quả compile — chi phí thật tỉ lệ số POSE KHÁC NHAU,
 * không phải số frame.
 */

function err(message: string, hint: string): never {
  throw new AppError("CONSTRUCTION_INVALID", message, hint);
}

export interface MotionFrame {
  readonly index: number;
  /** Thời điểm (giây). */
  readonly t: number;
  readonly svg: string;
  /** true = tái dùng compile của frame trước có scene giống hệt. */
  readonly reused: boolean;
}

export interface MotionStats {
  readonly frameCount: number;
  readonly fps: number;
  readonly duration: number;
  readonly holdFrames: number;
  /** Số scene khác nhau thực sự compile (≤ frameCount). */
  readonly uniqueFrames: number;
  readonly compileMs: number;
  readonly maxFrameMs: number;
  readonly totalBytes: number;
  readonly posterIndex: number;
}

export interface MotionCompiler {
  readonly prepared: PreparedMotion;
  readonly frameCount: number;
  /** Compile frame i (memo). Ném CONSTRUCTION_INVALID kèm thời điểm khi lỗi. */
  compileFrame(i: number): MotionFrame;
  /** Stats + warnings gộp (dedupe, kèm thời điểm xuất hiện đầu). */
  summary(): { stats: MotionStats; warnings: string[] };
}

export function posterIndexOf(motion: MotionSpec, frameCount: number): number {
  return Math.min(frameCount - 1, Math.round(motion.poster * motion.fps));
}

export function createMotionCompiler(motion: MotionSpec, ctx: MotionContext = {}): MotionCompiler {
  const prepared = prepareMotion(motion, ctx);
  const frameCount = prepared.frameCount;
  const memo = new Map<string, CompileResult>();
  const warningFirst = new Map<string, { t: number; count: number }>();
  let compileMs = 0;
  let maxFrameMs = 0;
  let totalBytes = 0;

  const note = (w: string, t: number) => {
    const e = warningFirst.get(w);
    if (e) e.count++;
    else warningFirst.set(w, { t, count: 1 });
  };

  return {
    prepared,
    frameCount,
    compileFrame(i: number): MotionFrame {
      if (!Number.isInteger(i) || i < 0 || i >= frameCount) {
        throw new RangeError(`frame ${i} out of range [0, ${frameCount})`);
      }
      const t = frameTime(motion, i);
      const scene = evaluateMotionAt(prepared, t);
      const key = JSON.stringify(scene);
      let result = memo.get(key);
      const reused = result !== undefined;
      if (!result) {
        if (compileMs > MOTION_LIMITS.maxTotalCompileMs) {
          err(
            `Motion compile exceeded ${MOTION_LIMITS.maxTotalCompileMs / 1000}s after ${i} of ${frameCount} frames.`,
            'Lower "fps" (12 is standard for animation), use "holdFrames": 2 (on twos), shorten the shot, or simplify the scene.',
          );
        }
        try {
          result = compileConstruction(scene);
        } catch (e) {
          if (e instanceof AppError) {
            throw new AppError(e.code, `Frame ${i} (t=${Math.round(t * 1000) / 1000}s): ${e.message}`, e.hint);
          }
          throw e;
        }
        memo.set(key, result);
        compileMs += result.stats.compileMs;
        maxFrameMs = Math.max(maxFrameMs, result.stats.compileMs);
        for (const w of result.warnings) note(w, t);
      }
      totalBytes += result.stats.bytes;
      return { index: i, t, svg: result.svg, reused };
    },
    summary() {
      const warnings = [
        ...prepared.warnings,
        ...[...warningFirst.entries()].map(([w, e]) =>
          e.count > 1 || e.t > 0 ? `${w} (first at t=${Math.round(e.t * 1000) / 1000}s)` : w,
        ),
      ];
      return {
        stats: {
          frameCount,
          fps: motion.fps,
          duration: motion.duration,
          holdFrames: motion.holdFrames,
          uniqueFrames: memo.size,
          compileMs: Math.round(compileMs * 10) / 10,
          maxFrameMs,
          totalBytes,
          posterIndex: posterIndexOf(motion, frameCount),
        },
        warnings,
      };
    },
  };
}

/**
 * Ghép scene body hoàn chỉnh của một frame: nền full-bleed → backdrop →
 * construct → overlay. Kết quả là fragment frame chuẩn (qua sanitizer như
 * mọi artwork) — nên backdrop/overlay có thể <use href="#…"> vào defs project.
 */
export function composeMotionFrame(
  motion: MotionSpec,
  constructSvg: string,
  canvas: { readonly w: number; readonly h: number },
): string {
  return [
    `<rect width="${canvas.w}" height="${canvas.h}" fill="${motion.background}"/>`,
    motion.backdrop ?? "",
    constructSvg,
    motion.overlay ?? "",
  ]
    .filter((s) => s.length > 0)
    .join("\n");
}
