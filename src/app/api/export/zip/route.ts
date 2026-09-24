import fs from "node:fs/promises";
import { PassThrough, Readable } from "node:stream";
import { ZipArchive } from "archiver";
import { logger } from "@/lib/services/logger";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/services/apiError";
import { handleRoute } from "@/lib/services/routeHelpers";
import { enforceRateLimit } from "@/lib/services/rateLimit";
import { readBuffer, resolveStoragePath } from "@/lib/services/storage";
import { decodeWav, encodeWav, type AudioBuffer } from "@/lib/services/audio/wav";
import { mixTimeline, type MixClip } from "@/lib/services/audio/mix";
import { buildTimedSrt } from "@/lib/services/srtBuilder";
import { buildAssembleScript, buildTimeline, timelineDuration, timelineInputOf } from "@/lib/services/timeline";
import { buildEdl, buildOtio } from "@/lib/services/editorial";
import { parseStoredMotion, passesDirOf } from "@/lib/services/clipService";
import { exportMotionGltf } from "@/lib/services/motion/gltfMotion";
import { LOGICAL_CANVAS } from "@/lib/services/svgRenderer";
import { formatFrameBadge } from "@/lib/services/frameService";

function slugify(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/đ/gi, "d")
      .replace(/[^a-zA-Z0-9-_]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "storyboard"
  );
}

/**
 * Export ZIP: F01.png…FNN.png (ảnh final có watermark) + clips/FNN/0001.png…
 * (chuỗi frame của shot motion) + clips/FNN.webp + storyboard.json
 * (metadata + timeline + source SVG/motion) + captions.srt (timing theo
 * timeline thật) + assemble.sh (ffmpeg → film.mp4) + gltf/FNN.gltf (shot
 * motion dạng 3D có animation cho Blender/Unreal). Stream bằng archiver.
 */
export async function GET(req: Request): Promise<Response> {
  return handleRoute(async () => {
    enforceRateLimit("export:zip", 5);

    const projectId = new URL(req.url).searchParams.get("projectId");
    if (!projectId) throw new AppError("VALIDATION", "Thiếu projectId.");

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { frames: { orderBy: { index: "asc" } } },
    });
    if (!project) throw new AppError("NOT_FOUND", "Không tìm thấy project.");

    const doneFrames = project.frames.filter(
      (f) => f.status === "done" && f.imagePath !== null,
    );
    if (doneFrames.length === 0) {
      throw new AppError(
        "VALIDATION",
        "Chưa có frame nào hoàn thành để xuất.",
        "Generate ảnh trước rồi xuất ZIP.",
      );
    }

    const archive = new ZipArchive({ zlib: { level: 6 } });
    archive.on("warning", (warning: unknown) => {
      logger.warn({ warning }, "zip archive warning");
    });
    archive.on("error", (err: unknown) => {
      logger.error({ err }, "zip archive error");
    });
    const passthrough = new PassThrough();
    archive.pipe(passthrough);

    // Chỉ đóng gói file thực sự tồn tại — file mất trên disk phải được
    // phản ánh trong storyboard.json thay vì âm thầm thiếu trong ZIP
    const includedIndexes = new Set<number>();
    for (const frame of doneFrames) {
      const absolute = resolveStoragePath(frame.imagePath!);
      try {
        await fs.access(absolute);
        archive.file(absolute, { name: `${formatFrameBadge(frame.index)}.png` });
        includedIndexes.add(frame.index);
      } catch {
        logger.warn({ frameIndex: frame.index }, "zip: frame image missing on disk — skipped");
      }
    }
    if (includedIndexes.size === 0) {
      throw new AppError(
        "VALIDATION",
        "Ảnh của các frame không còn trên disk.",
        "Generate lại rồi xuất ZIP.",
      );
    }

    // Shot motion: chuỗi PNG + WebP (chỉ khi còn trên disk — thiếu thì
    // frame rơi về ảnh tĩnh poster trên timeline, không vỡ export)
    const clipIndexes = new Set<number>();
    for (const frame of doneFrames) {
      if (!includedIndexes.has(frame.index) || !frame.clipDir || !frame.clipFrameCount) continue;
      const badge = formatFrameBadge(frame.index);
      const dirAbs = resolveStoragePath(frame.clipDir);
      try {
        const files = (await fs.readdir(dirAbs)).filter((f) => f.endsWith(".png"));
        if (files.length !== frame.clipFrameCount) throw new Error("clip incomplete");
        archive.directory(dirAbs, `clips/${badge}`);
        if (frame.clipPath) {
          const webpAbs = resolveStoragePath(frame.clipPath);
          await fs.access(webpAbs);
          archive.file(webpAbs, { name: `clips/${badge}.webp` });
        }
        clipIndexes.add(frame.index);
      } catch {
        logger.warn({ frameIndex: frame.index }, "zip: clip frames missing on disk — exporting poster still");
      }
    }

    // Control passes đã render (POST /api/frames/:id/passes) → passes/FNN/
    const passesOf = new Map<number, string[]>();
    for (const frame of doneFrames) {
      if (!clipIndexes.has(frame.index)) continue;
      const dirAbs = resolveStoragePath(passesDirOf(project.id, frame.id));
      const entries = await fs.readdir(dirAbs).catch(() => [] as string[]);
      if (entries.length === 0) continue;
      archive.directory(dirAbs, `passes/${formatFrameBadge(frame.index)}`);
      passesOf.set(frame.index, entries.filter((e) => !e.endsWith(".json")).sort());
    }

    // Shot motion → glTF có animation (cầu nối Blender/Unreal) — lỗi chỉ bỏ file này
    const gltfIndexes = new Set<number>();
    for (const frame of doneFrames) {
      if (!clipIndexes.has(frame.index) || !frame.motionSpec) continue;
      try {
        const motion = parseStoredMotion(frame.motionSpec);
        const { gltf } = exportMotionGltf(
          motion,
          { shotType: frame.shotType },
          { canvas: LOGICAL_CANVAS[project.aspectRatio] ?? LOGICAL_CANVAS["16:9"] },
        );
        archive.append(JSON.stringify(gltf), { name: `gltf/${formatFrameBadge(frame.index)}.gltf` });
        gltfIndexes.add(frame.index);
      } catch (err: unknown) {
        logger.warn({ frameIndex: frame.index, err }, "zip: glTF export skipped");
      }
    }

    const exported = doneFrames.filter((f) => includedIndexes.has(f.index));

    // Giọng thoại còn trên disk → audio/FNN.wav (+ vào mix)
    const voices = new Map<number, AudioBuffer>();
    for (const f of exported) {
      if (!f.voicePath) continue;
      try {
        const buf = await readBuffer(f.voicePath);
        voices.set(f.index, decodeWav(buf));
        archive.append(buf, { name: `audio/${formatFrameBadge(f.index)}.wav` });
      } catch {
        logger.warn({ frameIndex: f.index }, "zip: voice file missing/invalid — skipped");
      }
    }
    const timeline = buildTimeline(
      exported.map((f) => timelineInputOf(f, { clip: clipIndexes.has(f.index), voice: voices.has(f.index) })),
      project.playbackSpeed,
    );
    const timelineByIndex = new Map(timeline.map((e) => [e.index, e]));

    // Mix 48 kHz / 24-bit stereo khớp timeline: thoại + nhạc duck (≤ 15 phút)
    let music: AudioBuffer | null = null;
    if (project.musicPath) {
      try {
        music = decodeWav(await readBuffer(project.musicPath));
        archive.append(await readBuffer(project.musicPath), { name: "audio/music.wav" });
      } catch {
        logger.warn({ projectId }, "zip: soundtrack missing/invalid — skipped");
      }
    }
    const filmSeconds = timelineDuration(timeline);
    let hasMix = false;
    if ((voices.size > 0 || music) && filmSeconds <= 15 * 60) {
      const clips: MixClip[] = [];
      for (const e of timeline) {
        const v = voices.get(e.index);
        if (v && e.voiceStart !== undefined) clips.push({ audio: v, start: e.voiceStart, role: "dialogue", end: e.startSec + e.durationSec });
      }
      if (music) clips.push({ audio: music, start: 0, role: "music", end: filmSeconds, fadeOut: 2 });
      const loudness = new URL(req.url).searchParams.get("loudness") === "cinema" ? -27 : -16;
      const mix = mixTimeline(clips, { duration: filmSeconds, targetLufs: loudness, peakDb: -1 });
      archive.append(encodeWav(mix.audio, 24), { name: "audio/mix.wav" });
      hasMix = true;
    }

    const storyboardJson = {
      project: {
        id: project.id,
        name: project.name,
        artworkDefs: project.artworkDefs,
        aspectRatio: project.aspectRatio,
        resolution: project.resolution,
        playbackSpeed: project.playbackSpeed,
        durationSec: timelineDuration(timeline),
        audio: hasMix ? { mix: "audio/mix.wav", sampleRate: 48000, bitDepth: 24, channels: 2 } : null,
        exportedAt: new Date().toISOString(),
      },
      frames: project.frames.map((f) => {
        const t = timelineByIndex.get(f.index);
        const badge = formatFrameBadge(f.index);
        return {
          index: f.index,
          file: includedIndexes.has(f.index) ? `${badge}.png` : null,
          shotType: f.shotType,
          description: f.description,
          artworkSvg: f.artworkSvg,
          status: f.status,
          generatedAt: f.generatedAt,
          startSec: t?.startSec ?? null,
          durationSec: t?.durationSec ?? null,
          scene: f.scene,
          transitionIn: t?.transitionIn ?? null,
          dialogue: f.dialogue,
          voice: voices.has(f.index) ? { file: `audio/${badge}.wav`, startSec: t?.voiceStart ?? null, durationSec: t?.voiceDuration ?? null } : null,
          motion: clipIndexes.has(f.index)
            ? {
                fps: f.clipFps,
                frameCount: f.clipFrameCount,
                frames: `clips/${badge}/%04d.png`,
                webp: f.clipPath ? `clips/${badge}.webp` : null,
                gltf: gltfIndexes.has(f.index) ? `gltf/${badge}.gltf` : null,
                passes: passesOf.has(f.index)
                  ? Object.fromEntries(passesOf.get(f.index)!.map((p) => [p, `passes/${badge}/${p}/%04d.png`]))
                  : null,
                spec: f.motionSpec ? (JSON.parse(f.motionSpec) as unknown) : null,
              }
            : null,
        };
      }),
    };
    archive.append(JSON.stringify(storyboardJson, null, 2), {
      name: "storyboard.json",
    });

    const descriptionOf = new Map(exported.map((f) => [f.index, f.description]));
    archive.append(
      buildTimedSrt(
        timeline.map((e) => ({ description: descriptionOf.get(e.index)!, startSec: e.startSec, durationSec: e.durationSec })),
      ),
      { name: "captions.srt" },
    );
    // Phụ đề THOẠI: đúng lúc nhân vật nói (không có giọng → cả frame)
    const dialogueCues = timeline.flatMap((e) => {
      const f = exported.find((x) => x.index === e.index)!;
      if (!f.dialogue) return [];
      return [{ description: f.dialogue, startSec: e.voiceStart ?? e.startSec, durationSec: e.voiceDuration ?? e.durationSec }];
    });
    if (dialogueCues.length > 0) archive.append(buildTimedSrt(dialogueCues), { name: "subtitles.srt" });
    archive.append(
      buildAssembleScript(
        timeline.map((entry) => ({ badge: formatFrameBadge(entry.index), entry })),
        24,
        hasMix ? { mix: "audio/mix.wav" } : undefined,
      ),
      { name: "assemble.sh" },
    );
    // Giao nhận cho phần mềm dựng: EDL CMX3600 + OpenTimelineIO (media = segment _shots/)
    const editorialShots = timeline.map((entry) => {
      const badge = formatFrameBadge(entry.index);
      return { badge, entry, media: `_shots/${badge}.mp4`, ...(voices.has(entry.index) && { voiceMedia: `audio/${badge}.wav` }) };
    });
    archive.append(buildEdl(project.name, editorialShots), { name: "edit/film.edl" });
    archive.append(JSON.stringify(buildOtio(project.name, editorialShots), null, 2), { name: "edit/film.otio" });

    void archive.finalize();

    return new Response(Readable.toWeb(passthrough) as ReadableStream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${slugify(project.name)}.zip"`,
        "Cache-Control": "no-store",
      },
    });
  });
}
