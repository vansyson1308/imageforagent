import path from "node:path";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/services/apiError";
import { handleRoute } from "@/lib/services/routeHelpers";
import { enforceRateLimit } from "@/lib/services/rateLimit";
import { readBuffer, saveBuffer } from "@/lib/services/storage";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Nhân bản project: giữ kịch bản (frames về draft, không copy ảnh generate)
 * + copy toàn bộ asset reference sang thư mục project mới.
 * Phục vụ làm video series với cùng mascot/style.
 */
export async function POST(_req: Request, ctx: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    enforceRateLimit("projects:duplicate", 5);
    const { id } = await ctx.params;
    const source = await prisma.project.findUnique({
      where: { id },
      include: { frames: true, assets: true },
    });
    if (!source) throw new AppError("NOT_FOUND", "Không tìm thấy project.");

    const copy = await prisma.project.create({
      data: {
        name: `${source.name} (bản sao)`,
        artworkDefs: source.artworkDefs,
        aspectRatio: source.aspectRatio,
        resolution: source.resolution,
        playbackSpeed: source.playbackSpeed,
        sheetUrl: source.sheetUrl,
        wmPosition: source.wmPosition,
        wmScale: source.wmScale,
        wmOpacity: source.wmOpacity,
        frames: {
          create: source.frames.map((f) => ({
            index: f.index,
            shotType: f.shotType,
            description: f.description,
            artworkSvg: f.artworkSvg, // giữ artwork — 1 lần /api/render là dựng lại ảnh
            status: "draft",
          })),
        },
      },
    });

    // Copy file asset sang thư mục project mới
    for (const asset of source.assets) {
      const ext = path.posix.extname(asset.filePath) || ".png";
      const newRelPath = `${copy.id}/assets/${randomUUID()}${ext}`;
      try {
        const data = await readBuffer(asset.filePath);
        await saveBuffer(newRelPath, data);
        await prisma.asset.create({
          data: {
            projectId: copy.id,
            kind: asset.kind,
            filePath: newRelPath,
            mimeType: asset.mimeType,
            order: asset.order,
          },
        });
      } catch {
        // file gốc mất — bỏ qua asset này, không chặn duplicate
      }
    }

    return Response.json(copy, { status: 201 });
  });
}
