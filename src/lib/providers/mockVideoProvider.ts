import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { VideoRequest } from "@/lib/services/videoPromptComposer";
import type { GeneratedClip, VideoProvider } from "@/lib/providers/types";
import { videoDimensions } from "@/lib/config/video";
import { runFfmpeg } from "@/lib/services/ffmpegRunner";

/**
 * MockVideoProvider — lavfi testsrc2 + sine qua ffmpeg local, miễn phí.
 * Có audio (sine) để đường mix VO/native/BGM được test đầy đủ không tốn tiền.
 */
export class MockVideoProvider implements VideoProvider {
  readonly name = "mock";

  async generateClip(request: VideoRequest): Promise<GeneratedClip> {
    const { w, h } = videoDimensions(request.resolution, request.aspectRatio);
    const dur = request.durationSeconds;
    const outPath = path.join(os.tmpdir(), `mock-clip-${randomUUID()}.mp4`);

    // Tần số sine đổi theo frame index (nghe phân biệt được các clip)
    const frameNo = Number(request.prompt.match(/Frame (\d+)\//)?.[1] ?? 1);
    const freq = 300 + (frameNo % 8) * 60;

    try {
      await runFfmpeg([
        "-y",
        "-f", "lavfi",
        "-t", String(dur),
        "-i", `testsrc2=size=${w}x${h}:rate=24`,
        "-f", "lavfi",
        "-t", String(dur),
        "-i", `sine=frequency=${freq}:sample_rate=48000`,
        "-vf", "format=yuv420p",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "23",
        "-c:a", "aac",
        "-shortest",
        outPath,
      ]);
      const data = await fs.readFile(outPath);
      return { data, mimeType: "video/mp4" };
    } finally {
      await fs.unlink(outPath).catch(() => {});
    }
  }
}
