import { spawn } from "node:child_process";
import { AppError } from "@/lib/services/apiError";
import { logger } from "@/lib/services/logger";

/**
 * Wrapper mỏng quanh system ffmpeg/ffprobe (đã verify cài trên máy).
 * Mọi logic filtergraph nằm ở filtergraph.ts (thuần) — file này chỉ spawn.
 */

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export interface RunFfmpegOptions {
  readonly cwd?: string;
  readonly timeoutMs?: number;
}

export function runFfmpeg(args: string[], opts: RunFfmpegOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, {
      cwd: opts.cwd,
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });

    // Giữ ~8KB stderr cuối cho thông báo lỗi
    let stderrTail = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-8192);
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new AppError("INTERNAL", "ffmpeg chạy quá thời gian cho phép."));
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new AppError("INTERNAL", `Không chạy được ffmpeg: ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        logger.warn({ code, stderrTail: stderrTail.slice(-2000) }, "ffmpeg failed");
        reject(
          new AppError(
            "INTERNAL",
            `ffmpeg lỗi (exit ${code}): ${stderrTail.slice(-400)}`,
          ),
        );
      }
    });
  });
}

export interface ProbeResult {
  readonly durationSec: number;
  readonly hasAudio: boolean;
  readonly width: number | null;
  readonly height: number | null;
}

export function ffprobe(filePath: string): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ffprobe",
      [
        "-v", "error",
        "-show_entries", "format=duration",
        "-show_entries", "stream=codec_type,width,height",
        "-of", "json",
        filePath,
      ],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );

    let stdout = "";
    child.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
    child.on("error", (err) =>
      reject(new AppError("INTERNAL", `Không chạy được ffprobe: ${err.message}`)),
    );
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new AppError("INTERNAL", `ffprobe lỗi (exit ${code}).`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as {
          format?: { duration?: string };
          streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
        };
        const video = parsed.streams?.find((s) => s.codec_type === "video");
        resolve({
          durationSec: Number(parsed.format?.duration ?? 0),
          hasAudio: parsed.streams?.some((s) => s.codec_type === "audio") ?? false,
          width: video?.width ?? null,
          height: video?.height ?? null,
        });
      } catch {
        reject(new AppError("INTERNAL", "Không parse được output ffprobe."));
      }
    });
  });
}
