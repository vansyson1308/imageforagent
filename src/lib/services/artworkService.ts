import { prisma } from "@/lib/db";
import { renderArtwork } from "@/lib/services/svgRenderer";
import { applyWatermark } from "@/lib/services/watermarker";
import { saveBuffer, toPosix } from "@/lib/services/storage";
import { logger } from "@/lib/services/logger";

interface RenderableProject {
  readonly id: string;
  readonly artworkDefs: string | null;
  readonly aspectRatio: string;
  readonly resolution: string;
  readonly wmPosition: string;
  readonly wmScale: number;
  readonly wmOpacity: number;
  readonly assets: ReadonlyArray<{ kind: string; filePath: string }>;
}

interface RenderableFrame {
  readonly id: string;
  readonly artworkSvg: string | null;
}

/**
 * Render artwork của 1 frame → lưu raw PNG → đóng watermark (nếu có logo,
 * lỗi watermark fallback về raw như pipeline cũ) → cập nhật DB status done.
 * Throw AppError("ARTWORK_INVALID") nếu SVG không render được — caller
 * quyết định lưu trạng thái failed.
 */
export async function renderFrameArtwork(
  project: RenderableProject,
  frame: RenderableFrame,
): Promise<void> {
  const png = await renderArtwork(
    project.artworkDefs,
    frame.artworkSvg ?? "",
    project.aspectRatio,
    project.resolution,
  );

  const rawRelPath = toPosix(`${project.id}/frames/${frame.id}.raw.png`);
  await saveBuffer(rawRelPath, png);

  // Watermark lỗi không được phá frame — ảnh đã render OK, fallback raw
  const watermarkAsset = project.assets.find((a) => a.kind === "watermark");
  let imageRelPath = rawRelPath;
  let wmWarning: string | null = null;
  if (watermarkAsset) {
    try {
      const wmRelPath = toPosix(`${project.id}/frames/${frame.id}.wm.png`);
      await applyWatermark(rawRelPath, wmRelPath, watermarkAsset.filePath, {
        position: project.wmPosition,
        scalePercent: project.wmScale,
        opacity: project.wmOpacity,
      });
      imageRelPath = wmRelPath;
    } catch (err: unknown) {
      logger.warn({ err, frameId: frame.id }, "watermark failed — falling back to raw");
      wmWarning =
        "Ảnh đã render nhưng đóng watermark lỗi — chỉnh settings watermark rồi bấm 'Áp dụng lại'.";
    }
  }

  await prisma.frame.update({
    where: { id: frame.id },
    data: {
      status: "done",
      rawImagePath: rawRelPath,
      imagePath: imageRelPath,
      generatedAt: new Date(),
      errorMsg: wmWarning,
    },
  });
}
