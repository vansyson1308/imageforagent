/**
 * Sinh file captions.srt từ danh sách frame + tốc độ phát (giây/frame).
 * Pure function — timing tuần tự: frame i chiếm [i*spf, (i+1)*spf);
 * buildTimedSrt nhận timeline thật (shot motion có thời lượng riêng).
 */

export interface SrtFrame {
  readonly index: number;
  readonly description: string;
}

function formatTimestamp(totalMs: number): string {
  const ms = Math.round(totalMs) % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

export function buildSrt(
  frames: readonly SrtFrame[],
  secondsPerFrame: number,
): string {
  const spf = Math.max(0.1, secondsPerFrame);
  const ordered = frames.slice().sort((a, b) => a.index - b.index);
  return buildTimedSrt(
    ordered.map((frame, i) => ({ description: frame.description, startSec: i * spf, durationSec: spf })),
  );
}

export interface TimedSrtCue {
  readonly description: string;
  readonly startSec: number;
  readonly durationSec: number;
}

/** SRT theo timeline thật (shot motion dài bằng clip) — cue theo thứ tự truyền vào. */
export function buildTimedSrt(cues: readonly TimedSrtCue[]): string {
  const blocks = cues.map((cue, i) => {
    const start = formatTimestamp(cue.startSec * 1000);
    const end = formatTimestamp((cue.startSec + cue.durationSec) * 1000);
    return `${i + 1}\n${start} --> ${end}\n${cue.description}`;
  });
  return blocks.join("\n\n") + "\n";
}
