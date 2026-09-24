import { XFADE_NAME, type TransitionKind } from "@/lib/services/timeline";

/**
 * picture — dựng lệnh ffmpeg (mảng tham số, không shell) biến gói export
 * thành luồng rgb24 khung-đúng-24fps ở CONTAINER DCI: letterbox/pillarbox
 * giữ tỉ lệ, chuyển cảnh xfade/concat y hệt assemble.sh, trim từng shot
 * đúng thời lượng timeline. Pure.
 */

export type DciContainer = "flat" | "scope";

/** Kích thước container DCI (2K / 4K). */
export function containerSize(c: DciContainer, is4K: boolean): { w: number; h: number } {
  const base = c === "flat" ? { w: 1998, h: 1080 } : { w: 2048, h: 858 };
  return is4K ? { w: base.w * 2, h: base.h * 2 } : base;
}

export interface DcpShot {
  readonly index: number;
  readonly startSec: number;
  readonly durationSec: number;
  /** Ảnh tĩnh (FNN.png) hoặc chuỗi clip (clips/FNN/%04d.png @ fps). */
  readonly still?: string;
  readonly clip?: { readonly pattern: string; readonly fps: number };
  readonly transitionIn?: { readonly kind: string; readonly duration: number } | null;
}

export function buildPictureArgs(shots: readonly DcpShot[], size: { w: number; h: number }, fps = 24): { args: string[]; frames: number } {
  const args: string[] = ["-hide_banner", "-loglevel", "error"];
  shots.forEach((s) => {
    if (s.clip) args.push("-framerate", String(s.clip.fps), "-i", s.clip.pattern);
    else args.push("-loop", "1", "-framerate", String(fps), "-t", String(s.durationSec), "-i", s.still!);
  });
  const parts = shots.map(
    (s, i) =>
      `[${i}:v]fps=${fps},scale=${size.w}:${size.h}:force_original_aspect_ratio=decrease:flags=lanczos,` +
      `pad=${size.w}:${size.h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=gbrp,` +
      `tpad=stop_mode=clone:stop_duration=${s.durationSec},trim=duration=${s.durationSec},setpts=PTS-STARTPTS[v${i}]`,
  );
  let chain = "v0";
  shots.slice(1).forEach((s, j) => {
    const i = j + 1;
    const t = s.transitionIn;
    parts.push(
      t && t.kind in XFADE_NAME
        ? `[${chain}][v${i}]xfade=transition=${XFADE_NAME[t.kind as Exclude<TransitionKind, "cut">]}:duration=${t.duration}:offset=${s.startSec}[x${i}]`
        : // concat outputs AV_TIME_BASE — back to 1/fps so a following xfade matches
          `[${chain}][v${i}]concat=n=2:v=1:a=0,settb=1/${fps}[x${i}]`,
    );
    chain = `x${i}`;
  });
  const last = shots[shots.length - 1];
  const frames = Math.round((last.startSec + last.durationSec) * fps);
  parts.push(`[${chain}]format=rgb24[out]`);
  args.push("-filter_complex", parts.join(";"), "-map", "[out]", "-frames:v", String(frames), "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1");
  return { args, frames };
}
