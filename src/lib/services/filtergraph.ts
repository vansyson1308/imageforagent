import type { KenBurnsEffect } from "@/lib/config/motion";

/**
 * Builder thuần cho args ffmpeg — KHÔNG I/O, không side effect.
 * Đây là bề mặt unit-test của pipeline video (snapshot theo combo).
 * Args truyền vào spawn (không shell) nên không cần shell-escape;
 * dấu nháy đơn trong biểu thức là quoting của chính ffmpeg filtergraph.
 */

const FPS = 24;

// ---------- 1. ANIMATIC (Ken Burns từ frame tĩnh) ----------

export interface AnimaticOptions {
  readonly imagePath: string;
  readonly outputPath: string;
  readonly durationSec: number;
  readonly width: number;
  readonly height: number;
  readonly kenBurns: KenBurnsEffect;
}

function zoompanExpr(effect: KenBurnsEffect, frames: number): string {
  const center = "x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'";
  switch (effect) {
    case "zoom-in":
      return `z='min(1+0.12*on/${frames},1.12)':${center}`;
    case "zoom-out":
      return `z='max(1.12-0.12*on/${frames},1.001)':${center}`;
    case "pan-left":
      return `z='1.08':x='(iw-iw/zoom)*(1-on/${frames})':y='ih/2-(ih/zoom/2)'`;
    case "pan-right":
      return `z='1.08':x='(iw-iw/zoom)*on/${frames}':y='ih/2-(ih/zoom/2)'`;
    case "static":
      return `z='min(1+0.02*on/${frames},1.02)':${center}`;
  }
}

export function buildAnimaticArgs(opts: AnimaticOptions): string[] {
  const { width: w, height: h, durationSec } = opts;
  const frames = Math.round(durationSec * FPS);
  // Scale 2x trước zoompan để giảm giật, cover + crop đúng khung
  const vchain =
    `[0:v]scale=${w * 2}:${h * 2}:force_original_aspect_ratio=increase,` +
    `crop=${w * 2}:${h * 2},` +
    `zoompan=${zoompanExpr(opts.kenBurns, frames)}:d=${frames}:s=${w}x${h}:fps=${FPS},` +
    `setsar=1,format=yuv420p[v]`;

  return [
    "-y",
    "-loop", "1",
    "-t", String(durationSec),
    "-i", opts.imagePath,
    "-f", "lavfi",
    "-t", String(durationSec),
    "-i", "anullsrc=r=48000:cl=stereo",
    "-filter_complex", vchain,
    "-map", "[v]",
    "-map", "1:a",
    "-r", String(FPS),
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-c:a", "aac",
    "-ar", "48000",
    "-shortest",
    opts.outputPath,
  ];
}

// ---------- 2. NORMALIZE (đồng nhất clip + pre-mix VO/native) ----------

export interface NormalizeOptions {
  readonly inputPath: string;
  readonly voPath: string | null; // wav voiceover của frame (nếu có)
  readonly outputPath: string;
  readonly width: number;
  readonly height: number;
  readonly durationSec: number; // duration đã probe (authoritative)
  readonly clipHasAudio: boolean; // input có audio stream
  readonly nativeAudioEnabled: boolean; // toggle project
  readonly voiceoverEnabled: boolean; // toggle project
}

/** Mức nén native audio dưới voiceover (spec audio-mix D7). */
const NATIVE_UNDER_VO_DB = -13;

export function buildNormalizeArgs(opts: NormalizeOptions): string[] {
  const { width: w, height: h, durationSec: dur } = opts;
  const useNative = opts.clipHasAudio && opts.nativeAudioEnabled;
  const useVo = opts.voPath !== null && opts.voiceoverEnabled;

  const inputs: string[] = ["-i", opts.inputPath];
  let voIdx = -1;
  let silenceIdx = -1;
  let nextIdx = 1;
  if (useVo) {
    inputs.push("-i", opts.voPath!);
    voIdx = nextIdx++;
  }
  if (!useNative && !useVo) {
    inputs.push("-f", "lavfi", "-t", String(dur), "-i", "anullsrc=r=48000:cl=stereo");
    silenceIdx = nextIdx++;
  }

  const vchain =
    `[0:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,` +
    `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,fps=${FPS},setsar=1,format=yuv420p[v]`;

  let achain: string;
  if (useNative && useVo) {
    // VO 0dB đè trên native −13dB; amix duration=first (native = độ dài clip)
    achain =
      `[0:a]volume=${NATIVE_UNDER_VO_DB}dB[na];` +
      `[${voIdx}:a]aresample=48000,apad[vo];` +
      `[na][vo]amix=inputs=2:duration=first:normalize=0,` +
      `aresample=48000,aformat=channel_layouts=stereo[a]`;
  } else if (useNative) {
    achain = `[0:a]aresample=48000,aformat=channel_layouts=stereo[a]`;
  } else if (useVo) {
    achain =
      `[${voIdx}:a]aresample=48000,aformat=channel_layouts=stereo,` +
      `apad,atrim=0:${dur}[a]`;
  } else {
    achain = `[${silenceIdx}:a]atrim=0:${dur},aformat=channel_layouts=stereo[a]`;
  }

  return [
    "-y",
    ...inputs,
    "-filter_complex", `${vchain};${achain}`,
    "-map", "[v]",
    "-map", "[a]",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "18",
    "-c:a", "aac",
    "-b:a", "192k",
    "-ar", "48000",
    opts.outputPath,
  ];
}

// ---------- 3. ASSEMBLY (ghép + BGM ducking + hậu kỳ + loudnorm) ----------

export interface AssemblyClipInput {
  readonly path: string;
  readonly durationSec: number;
}

export interface AssemblyWatermark {
  readonly path: string;
  readonly position: string; // top-left|top-right|bottom-left|bottom-right|center
  readonly scalePercent: number;
  readonly opacity: number;
}

export interface AssemblyOptions {
  readonly clips: readonly AssemblyClipInput[];
  readonly outputPath: string;
  readonly width: number;
  readonly transitionType: "cut" | "crossfade";
  readonly transitionSec: number;
  readonly bgm: { readonly path: string; readonly volumeDb: number } | null;
  /** Tên file .srt TƯƠNG ĐỐI với cwd khi spawn (né quoting đường dẫn Windows). */
  readonly captionsFileName: string | null;
  readonly colorPolish: boolean;
  readonly watermark: AssemblyWatermark | null;
}

const WM_PADDING = 24;

function overlayPosition(position: string): string {
  switch (position) {
    case "top-left":
      return `${WM_PADDING}:${WM_PADDING}`;
    case "top-right":
      return `main_w-overlay_w-${WM_PADDING}:${WM_PADDING}`;
    case "bottom-left":
      return `${WM_PADDING}:main_h-overlay_h-${WM_PADDING}`;
    case "center":
      return `(main_w-overlay_w)/2:(main_h-overlay_h)/2`;
    case "bottom-right":
    default:
      return `main_w-overlay_w-${WM_PADDING}:main_h-overlay_h-${WM_PADDING}`;
  }
}

export interface AssemblyBuild {
  readonly args: string[];
  readonly totalDurationSec: number;
}

export function buildAssemblyArgs(opts: AssemblyOptions): AssemblyBuild {
  const n = opts.clips.length;
  if (n === 0) throw new Error("buildAssemblyArgs: cần ít nhất 1 clip");

  const t = opts.transitionSec;
  const useXfade = opts.transitionType === "crossfade" && n > 1;

  const durations = opts.clips.map((c) => c.durationSec);
  const sum = durations.reduce((a, b) => a + b, 0);
  const totalDurationSec = useXfade ? sum - (n - 1) * t : sum;

  // ---- inputs ----
  const inputs: string[] = [];
  for (const clip of opts.clips) inputs.push("-i", clip.path);
  let bgmIdx = -1;
  let wmIdx = -1;
  let next = n;
  if (opts.bgm) {
    inputs.push("-stream_loop", "-1", "-i", opts.bgm.path);
    bgmIdx = next++;
  }
  if (opts.watermark) {
    inputs.push("-i", opts.watermark.path);
    wmIdx = next++;
  }

  const parts: string[] = [];

  // ---- concat / crossfade → [vcat] + [sp] (speech bus) ----
  if (n === 1) {
    parts.push(`[0:v]null[vcat]`, `[0:a]anull[sp]`);
  } else if (!useXfade) {
    const pairs = opts.clips.map((_, i) => `[${i}:v][${i}:a]`).join("");
    parts.push(`${pairs}concat=n=${n}:v=1:a=1[vcat][sp]`);
  } else {
    // Chuỗi xfade: offset_i = tổng duration 0..i − (i+1)·t
    let vPrev = `[0:v]`;
    let aPrev = `[0:a]`;
    let cumulative = 0;
    for (let i = 1; i < n; i++) {
      cumulative += durations[i - 1];
      const offset = (cumulative - i * t).toFixed(3);
      const vOut = i === n - 1 ? "[vcat]" : `[vx${i}]`;
      const aOut = i === n - 1 ? "[sp]" : `[ax${i}]`;
      parts.push(
        `${vPrev}[${i}:v]xfade=transition=fade:duration=${t}:offset=${offset}${vOut}`,
      );
      parts.push(`${aPrev}[${i}:a]acrossfade=d=${t}${aOut}`);
      vPrev = vOut;
      aPrev = aOut;
    }
  }

  // ---- audio: BGM ducking dưới speech bus, rồi loudnorm toàn timeline ----
  let audioEnd = "[sp]";
  if (opts.bgm) {
    const T = totalDurationSec;
    const fadeOutStart = Math.max(0, T - 2).toFixed(3);
    parts.push(`${audioEnd}asplit=2[spKey][spMix]`);
    parts.push(
      `[${bgmIdx}:a]atrim=0:${T.toFixed(3)},aformat=channel_layouts=stereo,` +
        `aresample=48000,volume=${opts.bgm.volumeDb}dB,` +
        `afade=t=in:d=1,afade=t=out:st=${fadeOutStart}:d=2[bgmv]`,
    );
    // sidechaincompress: main=BGM, key=speech → BGM tự cúi xuống khi có thoại/SFX
    parts.push(
      `[bgmv][spKey]sidechaincompress=threshold=0.03:ratio=8:attack=5:release=400[duck]`,
    );
    parts.push(`[spMix][duck]amix=inputs=2:duration=first:normalize=0[premix]`);
    audioEnd = "[premix]";
  }
  parts.push(
    `${audioEnd}loudnorm=I=-16:TP=-1.5:LRA=11:linear=true,aresample=48000[aout]`,
  );

  // ---- video tail: polish → captions → watermark ----
  let videoEnd = "[vcat]";
  const tail: string[] = [];
  if (opts.colorPolish) tail.push("eq=saturation=1.06:contrast=1.02");
  if (opts.captionsFileName) tail.push(`subtitles=${opts.captionsFileName}`);

  if (tail.length > 0) {
    const label = opts.watermark ? "[vt]" : "[vout]";
    parts.push(`${videoEnd}${tail.join(",")}${label}`);
    videoEnd = label;
  }
  if (opts.watermark) {
    const wmWidth = Math.max(16, Math.round((opts.width * opts.watermark.scalePercent) / 100));
    parts.push(
      `[${wmIdx}:v]scale=${wmWidth}:-1,format=rgba,` +
        `colorchannelmixer=aa=${opts.watermark.opacity}[wmv]`,
    );
    parts.push(`${videoEnd}[wmv]overlay=${overlayPosition(opts.watermark.position)}[vout]`);
    videoEnd = "[vout]";
  }
  if (videoEnd === "[vcat]") {
    parts.push(`[vcat]null[vout]`);
  }

  const args = [
    "-y",
    ...inputs,
    "-filter_complex", parts.join(";"),
    "-map", "[vout]",
    "-map", "[aout]",
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "18",
    "-c:a", "aac",
    "-b:a", "192k",
    "-ar", "48000",
    "-movflags", "+faststart",
    opts.outputPath,
  ];

  return { args, totalDurationSec };
}
