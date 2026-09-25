import { prisma } from "@/lib/db";
import { AppError } from "@/lib/services/apiError";
import { sanitizeSvg } from "@/lib/services/svgRenderer";
import { renderFrameArtwork } from "@/lib/services/artworkService";
import { clearFrameMotion, renderFrameMotion, type FrameClipResult } from "@/lib/services/clipService";
import { motionSpecSchema } from "@/lib/validation/motionSchema";
import { resolveVoice } from "@/lib/services/voiceService";
import { audioDuration } from "@/lib/services/audio/wav";
import { removeQuiet, saveBuffer, toPosix } from "@/lib/services/storage";
import type { Frame } from "@/generated/prisma/client";

/**
 * frameWrites — the write paths shared by the REST routes and the in-process
 * Director (same validation, same persistence, same failure semantics: a
 * render failure still SAVES the agent's source with status "failed" + the
 * error hint, then rethrows).
 */

function failureMessage(err: unknown): string {
  if (err instanceof AppError) return err.hint ? `${err.message} — ${err.hint}` : err.message;
  return err instanceof Error ? err.message : "Render lỗi.";
}

async function markFailed(id: string, err: unknown): Promise<void> {
  // .catch: frame có thể bị xoá song song (P2025) — không nuốt lỗi gốc
  await prisma.frame.update({ where: { id }, data: { status: "failed", errorMsg: failureMessage(err) } }).catch(() => {});
}

async function loadFrameAndProject(id: string) {
  const frame = await prisma.frame.findUnique({ where: { id } });
  if (!frame) throw new AppError("NOT_FOUND", "Không tìm thấy frame.");
  const project = await prisma.project.findUnique({ where: { id: frame.projectId }, include: { assets: true } });
  if (!project) throw new AppError("NOT_FOUND", "Không tìm thấy project.");
  return { frame, project };
}

/** Still artwork: sanitize → (motion frame reverts to a still) → save → render sync. */
export async function writeFrameArtwork(id: string, svg: string): Promise<Frame> {
  const { frame, project } = await loadFrameAndProject(id);
  sanitizeSvg(svg, "frame");
  if (frame.motionSpec) await clearFrameMotion(frame.projectId, id);
  const saved = await prisma.frame.update({ where: { id }, data: { artworkSvg: svg } });
  try {
    await renderFrameArtwork(project, saved);
  } catch (err: unknown) {
    await markFailed(id, err);
    throw err;
  }
  const fresh = await prisma.frame.findUnique({ where: { id } });
  if (!fresh) throw new AppError("NOT_FOUND", "Frame đã bị xoá trong lúc render.");
  return fresh;
}

/**
 * Motion shot: validate with motionSpecSchema, sanitize the static layers,
 * store the RAW JSON (round-trips exactly), render the clip sync.
 */
export async function writeFrameMotion(id: string, rawMotion: unknown): Promise<{ frame: Frame } & FrameClipResult> {
  const motion = motionSpecSchema.parse(rawMotion);
  const { project } = await loadFrameAndProject(id);
  if (motion.backdrop) sanitizeSvg(motion.backdrop, "frame");
  if (motion.overlay) sanitizeSvg(motion.overlay, "frame");
  const saved = await prisma.frame.update({ where: { id }, data: { motionSpec: JSON.stringify(rawMotion) } });
  let result: FrameClipResult;
  try {
    result = await renderFrameMotion(project, saved);
  } catch (err: unknown) {
    await markFailed(id, err);
    throw err;
  }
  const fresh = await prisma.frame.findUnique({ where: { id } });
  if (!fresh) throw new AppError("NOT_FOUND", "Frame đã bị xoá trong lúc render.");
  return { frame: fresh, ...result };
}

export interface DialogueInput {
  readonly text: string;
  readonly wav?: string;
  readonly tts?: { readonly voice: string; readonly speed: number };
  readonly offset: number;
}

/** Dialogue line: subtitle + voice (WAV or local TTS); re-renders a lipsync shot. */
export async function writeFrameDialogue(id: string, input: DialogueInput): Promise<{ frame: Frame; warnings: string[] }> {
  const frame = await prisma.frame.findUnique({ where: { id } });
  if (!frame) throw new AppError("NOT_FOUND", "Không tìm thấy frame.");
  const voice = await resolveVoice({ wav: input.wav, text: input.text, tts: input.tts });
  let voicePath: string | null = null;
  let voiceDuration: number | null = null;
  if (voice) {
    voicePath = toPosix(`${frame.projectId}/audio/${frame.id}.wav`);
    await saveBuffer(voicePath, voice.buffer);
    voiceDuration = Math.round(audioDuration(voice.audio) * 1000) / 1000;
  } else if (frame.voicePath) {
    await removeQuiet(frame.voicePath);
  }
  const saved = await prisma.frame.update({
    where: { id },
    data: { dialogue: input.text, voicePath, voiceDuration, voiceOffset: input.offset },
  });
  const warnings: string[] = [];
  if (saved.motionSpec && /"type"\s*:\s*"lipsync"/.test(saved.motionSpec)) {
    const project = await prisma.project.findUnique({ where: { id: saved.projectId }, include: { assets: true } });
    if (project) warnings.push(...(await renderFrameMotion(project, saved)).warnings);
  }
  if (voiceDuration !== null && saved.clipDuration && input.offset + voiceDuration > saved.clipDuration) {
    warnings.push(`Voice (${voiceDuration}s from ${input.offset}s) runs past the shot (${saved.clipDuration}s) — it will be cut at the shot end.`);
  }
  const fresh = await prisma.frame.findUnique({ where: { id } });
  return { frame: fresh!, warnings };
}

export interface ScriptRow {
  readonly index: number;
  readonly shotType: string;
  readonly description: string;
}

/**
 * Replace the whole script (apply-edit semantics): frames whose shotType +
 * description are unchanged keep their artwork, motion and voice; changed
 * frames reset to draft.
 */
export async function replaceScript(projectId: string, rows: readonly ScriptRow[]): Promise<Frame[]> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { frames: { orderBy: { index: "asc" } } },
  });
  if (!project) throw new AppError("NOT_FOUND", "Không tìm thấy project.");
  const oldByIndex = new Map(project.frames.map((f) => [f.index, f]));
  return prisma.$transaction(async (tx) => {
    await tx.frame.deleteMany({ where: { projectId } });
    for (const f of rows) {
      const old = oldByIndex.get(f.index);
      const unchanged = old !== undefined && old.shotType === f.shotType && old.description === f.description;
      await tx.frame.create({
        data: {
          projectId,
          index: f.index,
          shotType: f.shotType,
          description: f.description,
          status: unchanged ? old.status : "draft",
          imagePath: unchanged ? old.imagePath : null,
          rawImagePath: unchanged ? old.rawImagePath : null,
          generatedAt: unchanged ? old.generatedAt : null,
          // Frame giữ nguyên nội dung giữ nguyên artwork + shot motion
          // (thiếu dòng này /api/render sau đó bỏ sót frame đã có ảnh)
          ...(unchanged && {
            artworkSvg: old.artworkSvg,
            errorMsg: old.errorMsg,
            motionSpec: old.motionSpec,
            clipDir: old.clipDir,
            clipPath: old.clipPath,
            clipFps: old.clipFps,
            clipFrameCount: old.clipFrameCount,
            clipDuration: old.clipDuration,
            dialogue: old.dialogue,
            voicePath: old.voicePath,
            voiceDuration: old.voiceDuration,
            voiceOffset: old.voiceOffset,
          }),
        },
      });
    }
    return tx.frame.findMany({ where: { projectId }, orderBy: { index: "asc" } });
  });
}
