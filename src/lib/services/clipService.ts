import { prisma } from "@/lib/db";
import { AppError } from "@/lib/services/apiError";
import { motionSpecSchema, type MotionSpec } from "@/lib/validation/motionSchema";
import { encodeAnimatedWebp, renderMotionClip } from "@/lib/services/motionRenderer";
import { renderFrameArtwork } from "@/lib/services/artworkService";
import { removeDirQuiet, removeQuiet, saveBuffer, toPosix } from "@/lib/services/storage";

/**
 * clipService — render shot hoạt hình của một frame: chuỗi PNG full-res
 * ({projectId}/clips/{frameId}/0001.png…) + animated WebP xem nhanh; frame
 * POSTER trở thành artworkSvg của frame và đi qua pipeline ảnh tĩnh sẵn có
 * (watermark, export F01.png, grid UI) — storyboard vẫn là storyboard.
 */

interface ClipProject {
  readonly id: string;
  readonly artworkDefs: string | null;
  readonly aspectRatio: string;
  readonly resolution: string;
  readonly wmPosition: string;
  readonly wmScale: number;
  readonly wmOpacity: number;
  readonly assets: ReadonlyArray<{ kind: string; filePath: string }>;
}

interface ClipFrame {
  readonly id: string;
  readonly shotType: string;
  readonly motionSpec: string | null;
}

export const pad4 = (n: number) => String(n).padStart(4, "0");

export function clipDirOf(projectId: string, frameId: string): string {
  return toPosix(`${projectId}/clips/${frameId}`);
}

export function clipWebpOf(projectId: string, frameId: string): string {
  return toPosix(`${projectId}/clips/${frameId}.webp`);
}

export function parseStoredMotion(json: string): MotionSpec {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new AppError("CONSTRUCTION_INVALID", "Stored motion spec is not valid JSON.", "Re-submit it with PUT /api/frames/:id/motion.");
  }
  const parsed = motionSpecSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new AppError(
      "CONSTRUCTION_INVALID",
      `Stored motion spec is invalid — ${issue.path.join(".")}: ${issue.message}`,
      "Re-submit it with PUT /api/frames/:id/motion.",
    );
  }
  return parsed.data;
}

export interface FrameClipResult {
  readonly stats: Awaited<ReturnType<typeof renderMotionClip>>["stats"];
  readonly warnings: string[];
}

export async function renderFrameMotion(project: ClipProject, frame: ClipFrame): Promise<FrameClipResult> {
  if (!frame.motionSpec) {
    throw new AppError("VALIDATION", "Frame has no motion spec.", "PUT /api/frames/:id/motion with {motion} first.");
  }
  const motion = parseStoredMotion(frame.motionSpec);
  const dir = clipDirOf(project.id, frame.id);
  // Số frame có thể giảm giữa hai lần render — xoá chuỗi cũ trước
  await removeDirQuiet(dir);

  const result = await renderMotionClip({
    motion,
    ctx: { shotType: frame.shotType },
    defs: project.artworkDefs,
    aspectRatio: project.aspectRatio,
    resolution: project.resolution,
    onFrame: (f) => saveBuffer(`${dir}/${pad4(f.index + 1)}.png`, f.png),
  });

  const webpPath = clipWebpOf(project.id, frame.id);
  await saveBuffer(webpPath, await encodeAnimatedWebp(result.frames.map((f) => f.png), motion.fps));

  // Poster = ảnh tĩnh storyboard (watermark + grid + F01.png như mọi frame)
  const saved = await prisma.frame.update({
    where: { id: frame.id },
    data: {
      artworkSvg: result.posterBody,
      clipDir: dir,
      clipPath: webpPath,
      clipFps: motion.fps,
      clipFrameCount: result.stats.frameCount,
      clipDuration: result.stats.frameCount / motion.fps,
    },
  });
  await renderFrameArtwork(project, saved);

  return { stats: result.stats, warnings: result.warnings };
}

/** Gỡ motion khỏi frame (giữ poster làm ảnh tĩnh) + xoá file clip. */
export async function clearFrameMotion(projectId: string, frameId: string): Promise<void> {
  await prisma.frame.update({
    where: { id: frameId },
    data: { motionSpec: null, clipDir: null, clipPath: null, clipFps: null, clipFrameCount: null, clipDuration: null },
  });
  await removeClipFiles(projectId, frameId);
}

export async function removeClipFiles(projectId: string, frameId: string): Promise<void> {
  await removeDirQuiet(clipDirOf(projectId, frameId));
  await removeQuiet(clipWebpOf(projectId, frameId));
}
