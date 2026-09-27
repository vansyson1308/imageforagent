import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/services/apiError";
import { fileExists, readBuffer, removeDirQuiet, resolveStoragePath, saveBuffer, toPosix } from "@/lib/services/storage";
import { buildTimeline, timelineDuration, timelineInputOf, XFADE_NAME, type TimelineEntry } from "@/lib/services/timeline";
import { decodeWav, encodeWav, type AudioBuffer } from "@/lib/services/audio/wav";
import { mixTimeline, type MixClip } from "@/lib/services/audio/mix";
import { formatFrameBadge } from "@/lib/services/frameService";
import { MAX_MIX_SECONDS } from "@/lib/config/limits";

/**
 * filmAssembler: the server-side twin of the export's `assemble.sh`. It runs
 * the same ffmpeg steps (per-shot segment → concat, or an xfade graph when the
 * timeline has transitions → mux the −16 LUFS mix) straight from storage.
 * ffmpeg is spawned with an argv array: no shell, no string interpolation.
 * `timeline.ts` stays the only timing source. The result is cached by a hash
 * of the timeline + every source's render time.
 */

export const FILM_OUTPUT_FPS = 12;

export interface AssembleShotInput {
  readonly badge: string;
  readonly entry: TimelineEntry;
  /** Absolute paths. */
  readonly still: string;
  readonly clipPattern: string | null;
}

export interface FfmpegStep {
  readonly label: string;
  readonly args: string[];
}

const VF = (fps: number) => `fps=${fps},scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p`;

/** Pure: the ffmpeg argv list for a film (unit-tested against assemble.sh semantics). */
export function assembleSteps(shots: readonly AssembleShotInput[], workDir: string, out: string, fps: number, mixWav: string | null): FfmpegStep[] {
  const steps: FfmpegStep[] = [];
  const seg = (b: string) => `${workDir}/${b}.mp4`;
  for (const s of shots) {
    if (s.entry.kind === "clip" && s.clipPattern) {
      steps.push({
        label: `shot ${s.badge}`,
        args: ["-loglevel", "error", "-y", "-framerate", String(s.entry.fps ?? fps), "-i", s.clipPattern, "-vf", VF(fps), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", seg(s.badge)],
      });
    } else {
      steps.push({
        label: `still ${s.badge}`,
        args: ["-loglevel", "error", "-y", "-loop", "1", "-framerate", String(fps), "-t", String(s.entry.durationSec), "-i", s.still, "-vf", VF(fps), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-tune", "stillimage", "-pix_fmt", "yuv420p", seg(s.badge)],
      });
    }
  }
  const picture = mixWav ? `${workDir}/picture.mp4` : out;
  if (shots.some((s) => s.entry.transitionIn)) {
    const inputs = shots.flatMap((s) => ["-i", seg(s.badge)]);
    const parts: string[] = shots.map((_, i) => `[${i}:v]settb=AVTB,fps=${fps},format=yuv420p[v${i}]`);
    let chain = "v0";
    shots.slice(1).forEach((s, j) => {
      const i = j + 1;
      const t = s.entry.transitionIn;
      parts.push(
        t
          ? `[${chain}][v${i}]xfade=transition=${XFADE_NAME[t.kind]}:duration=${t.duration}:offset=${s.entry.startSec}[x${i}]`
          : `[${chain}][v${i}]concat=n=2:v=1:a=0,settb=1/${fps}[x${i}]`,
      );
      chain = `x${i}`;
    });
    steps.push({
      label: "transitions",
      args: ["-loglevel", "error", "-y", ...inputs, "-filter_complex", parts.join(";"), "-map", `[${chain}]`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", ...(mixWav ? [] : ["-movflags", "+faststart"]), picture],
    });
  } else {
    steps.push({ label: "concat", args: ["-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", `${workDir}/list.txt`, "-c", "copy", ...(mixWav ? [] : ["-movflags", "+faststart"]), picture] });
  }
  if (mixWav) {
    steps.push({
      label: "mux audio",
      args: ["-loglevel", "error", "-y", "-i", picture, "-i", mixWav, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", out],
    });
  }
  return steps;
}

let ffmpegOk: boolean | null = null;
export function ffmpegAvailable(): boolean {
  if (ffmpegOk === null) {
    try {
      ffmpegOk = spawnSync("ffmpeg", ["-version"], { stdio: "ignore", timeout: 10_000 }).status === 0;
    } catch {
      ffmpegOk = false;
    }
  }
  return ffmpegOk;
}

function runFfmpeg(args: string[], timeoutMs = 300_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stderr.on("data", (c: Buffer) => {
      if (err.length < 4000) err += c.toString();
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${err.slice(0, 600)}`));
    });
  });
}

const inFlight = new Map<string, Promise<AssembleResult>>();

export interface AssembleResult {
  /** Storage-relative path of the MP4. */
  readonly path: string;
  readonly durationSec: number;
  readonly shots: number;
  readonly cached: boolean;
  readonly hasAudio: boolean;
}

/** Assemble (or reuse) the project's film.mp4. One assembly per project at a time. */
export function assembleFilm(projectId: string, fps = FILM_OUTPUT_FPS): Promise<AssembleResult> {
  const key = `${projectId}@${fps}`;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const p = doAssemble(projectId, fps).finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

async function doAssemble(projectId: string, fps: number): Promise<AssembleResult> {
  if (!ffmpegAvailable()) throw new AppError("INTERNAL", "ffmpeg is not installed on this server.", "Install ffmpeg, or download the package ZIP and run `sh assemble.sh` locally.", 503);
  const project = await prisma.project.findUnique({ where: { id: projectId }, include: { frames: { orderBy: { index: "asc" } } } });
  if (!project) throw new AppError("NOT_FOUND", "Không tìm thấy project.");
  const frames = project.frames.filter((f) => f.status === "done" && f.imagePath);
  if (frames.length === 0) throw new AppError("VALIDATION", "No rendered frames yet.", "Render (or direct) the film first.");

  const clipOk = new Set<number>();
  for (const f of frames) {
    if (!f.clipDir || !f.clipFrameCount) continue;
    const files = await fs.readdir(resolveStoragePath(f.clipDir)).catch(() => [] as string[]);
    if (files.filter((x) => x.endsWith(".png")).length === f.clipFrameCount) clipOk.add(f.index);
  }
  const voices = new Map<number, AudioBuffer>();
  for (const f of frames) {
    if (!f.voicePath) continue;
    try {
      voices.set(f.index, decodeWav(await readBuffer(f.voicePath)));
    } catch {
      // voice missing → subtitle-only shot
    }
  }
  const timeline = buildTimeline(frames.map((f) => timelineInputOf(f, { clip: clipOk.has(f.index), voice: voices.has(f.index) })), project.playbackSpeed);
  const duration = timelineDuration(timeline);

  const hash = createHash("sha1")
    .update(JSON.stringify({ timeline, fps, v: frames.map((f) => [f.index, f.generatedAt?.getTime() ?? 0, f.voicePath, f.voiceDuration]), music: project.musicPath }))
    .digest("hex")
    .slice(0, 12);
  const outRel = toPosix(`${projectId}/film/film-${hash}.mp4`);
  if (await fileExists(outRel)) return { path: outRel, durationSec: duration, shots: timeline.length, cached: true, hasAudio: voices.size > 0 || !!project.musicPath };

  const workRel = toPosix(`${projectId}/film/_work`);
  await removeDirQuiet(toPosix(`${projectId}/film`));
  const workAbs = resolveStoragePath(workRel);
  await fs.mkdir(workAbs, { recursive: true });

  let mixAbs: string | null = null;
  let music: AudioBuffer | null = null;
  if (project.musicPath) music = await readBuffer(project.musicPath).then(decodeWav).catch(() => null);
  if ((voices.size > 0 || music) && duration <= MAX_MIX_SECONDS) {
    const clips: MixClip[] = [];
    for (const e of timeline) {
      const v = voices.get(e.index);
      if (v && e.voiceStart !== undefined) clips.push({ audio: v, start: e.voiceStart, role: "dialogue", end: e.startSec + e.durationSec });
    }
    if (music) clips.push({ audio: music, start: 0, role: "music", end: duration, fadeOut: 2 });
    const mix = mixTimeline(clips, { duration, targetLufs: -16, peakDb: -1 });
    await saveBuffer(`${workRel}/mix.wav`, encodeWav(mix.audio, 16));
    mixAbs = `${workAbs}/mix.wav`;
  }

  const byIndex = new Map(frames.map((f) => [f.index, f]));
  const shots: AssembleShotInput[] = timeline.map((entry) => {
    const f = byIndex.get(entry.index)!;
    return {
      badge: formatFrameBadge(entry.index),
      entry,
      still: resolveStoragePath(f.imagePath!),
      clipPattern: entry.kind === "clip" && f.clipDir ? `${resolveStoragePath(f.clipDir)}/%04d.png` : null,
    };
  });
  await fs.writeFile(`${workAbs}/list.txt`, shots.map((s) => `file '${s.badge}.mp4'`).join("\n") + "\n");
  const outAbs = resolveStoragePath(outRel);
  try {
    for (const step of assembleSteps(shots, workAbs, outAbs, fps, mixAbs)) await runFfmpeg(step.args);
  } catch (e) {
    await removeDirQuiet(toPosix(`${projectId}/film`));
    throw new AppError("INTERNAL", `Film assembly failed: ${e instanceof Error ? e.message : String(e)}`, "Download the package ZIP and run `sh assemble.sh` to see the full ffmpeg output.");
  }
  await removeDirQuiet(workRel);
  return { path: outRel, durationSec: duration, shots: timeline.length, cached: false, hasAudio: mixAbs !== null };
}
