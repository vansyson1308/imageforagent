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

/** DCI 1.4 cap: 250 Mbit/s for the picture track (1,302,083 bytes/frame at 24 fps). */
export const DCI_MAX_MBPS = 250;

/**
 * opj_compress arguments for one X′Y′Z′ 12-bit frame. Without `mbps` this is
 * OpenJPEG's own `-cinema2K/-cinema4K` (which always spends the full 250 Mbit/s
 * cap). With `mbps` (2K only) it spells out the same 2K cinema coding
 * parameters — 5 decomposition levels, 32×32 code-blocks, precincts 256² with
 * 128² at the lowest band, CPRL, irreversible 9/7, one tile-part per
 * component, TLM — but with a lower rate target; the codestream then needs
 * `setDciProfile` because OpenJPEG only writes Rsiz=CINEMA2K for `-cinema2K`.
 */
export function j2kEncodeArgs(input: string, output: string, o: { is4K: boolean; mbps?: number; w: number; h: number; fps?: number }): string[] {
  if (o.mbps === undefined) return ["-i", input, "-o", output, o.is4K ? "-cinema4K" : "-cinema2K", "24"];
  if (o.is4K) throw new Error("--mbps is only supported for 2K masters (4K needs the POC layout of -cinema4K).");
  if (!(o.mbps >= 20 && o.mbps <= DCI_MAX_MBPS)) throw new Error(`--mbps must be in [20, ${DCI_MAX_MBPS}]`);
  const raw = (o.w * o.h * 3 * 12) / 8;
  const target = (o.mbps * 1e6) / (o.fps ?? 24) / 8;
  const ratio = Math.round((raw / target) * 1000) / 1000;
  return [
    "-i", input, "-o", output,
    "-n", "6", "-b", "32,32",
    "-c", "[256,256],[256,256],[256,256],[256,256],[256,256],[128,128]",
    "-p", "CPRL", "-I", "-TP", "C", "-TLM",
    "-r", String(ratio),
  ];
}

/**
 * Stamp the DCI profile into SIZ.Rsiz (ISO 15444-1 Amd 1: 3 = 2K, 4 = 4K).
 * SIZ always directly follows SOC, so Rsiz sits at bytes 6–7. Mutates `cs`.
 */
export function setDciProfile(cs: Buffer, is4K: boolean): Buffer {
  if (cs.length < 8 || cs.readUInt16BE(0) !== 0xff4f || cs.readUInt16BE(2) !== 0xff51) {
    throw new Error("Not a JPEG 2000 codestream (SOC + SIZ expected).");
  }
  cs.writeUInt16BE(is4K ? 4 : 3, 6);
  return cs;
}
