import { PassThrough, Readable } from "node:stream";
import { ZipArchive } from "archiver";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/services/apiError";
import { handleRoute } from "@/lib/services/routeHelpers";
import { enforceRateLimit } from "@/lib/services/rateLimit";
import { resolveStoragePath } from "@/lib/services/storage";
import { buildSrt } from "@/lib/services/srtBuilder";
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
 * Export ZIP: F01.png…FNN.png (ảnh final có watermark) + storyboard.json
 * (metadata đầy đủ cho khâu dựng video / image-to-video) + captions.srt
 * (timing theo playbackSpeed). Stream bằng archiver — không dồn RAM.
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
    const passthrough = new PassThrough();
    archive.pipe(passthrough);

    for (const frame of doneFrames) {
      archive.file(resolveStoragePath(frame.imagePath!), {
        name: `${formatFrameBadge(frame.index)}.png`,
      });
    }

    const storyboardJson = {
      project: {
        id: project.id,
        name: project.name,
        characterDesc: project.characterDesc,
        aspectRatio: project.aspectRatio,
        resolution: project.resolution,
        playbackSpeed: project.playbackSpeed,
        exportedAt: new Date().toISOString(),
      },
      frames: project.frames.map((f) => ({
        index: f.index,
        file: f.status === "done" ? `${formatFrameBadge(f.index)}.png` : null,
        shotType: f.shotType,
        description: f.description,
        status: f.status,
        generatedAt: f.generatedAt,
      })),
    };
    archive.append(JSON.stringify(storyboardJson, null, 2), {
      name: "storyboard.json",
    });

    archive.append(buildSrt(doneFrames, project.playbackSpeed), {
      name: "captions.srt",
    });

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
