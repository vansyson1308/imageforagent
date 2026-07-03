/**
 * Sinh file captions.srt từ danh sách frame + tốc độ phát (giây/frame).
 * Pure function — timing tuần tự: frame i chiếm [i*spf, (i+1)*spf).
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
  const spfMs = Math.max(0.1, secondsPerFrame) * 1000;
  const ordered = frames.slice().sort((a, b) => a.index - b.index);

  const blocks = ordered.map((frame, i) => {
    const start = formatTimestamp(i * spfMs);
    const end = formatTimestamp((i + 1) * spfMs);
    return `${i + 1}\n${start} --> ${end}\n${frame.description}`;
  });

  return blocks.join("\n\n") + "\n";
}

export interface SrtTimedFrame {
  readonly index: number;
  readonly description: string;
  readonly durationSec: number;
}

/**
 * SRT theo duration THẬT của từng clip (Phase 9) — trừ overlap crossfade:
 * clip i bắt đầu tại Σ(dur_0..i-1) − i·overlap.
 */
export function buildSrtFromDurations(
  frames: readonly SrtTimedFrame[],
  overlapSec: number,
): string {
  const ordered = frames.slice().sort((a, b) => a.index - b.index);
  const blocks: string[] = [];
  let cursorMs = 0;

  ordered.forEach((frame, i) => {
    const durMs = Math.max(100, frame.durationSec * 1000);
    const start = formatTimestamp(cursorMs);
    const end = formatTimestamp(cursorMs + durMs);
    blocks.push(`${i + 1}\n${start} --> ${end}\n${frame.description}`);
    cursorMs += durMs - (i < ordered.length - 1 ? overlapSec * 1000 : 0);
  });

  return blocks.join("\n\n") + "\n";
}
