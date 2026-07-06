import { prisma } from "@/lib/db";
import { AppError } from "@/lib/services/apiError";
import { handleRoute, parseBody } from "@/lib/services/routeHelpers";
import { enforceRateLimit } from "@/lib/services/rateLimit";
import { artworkSchema } from "@/lib/validation/schemas";
import { sanitizeSvg } from "@/lib/services/svgRenderer";
import { renderFrameArtwork } from "@/lib/services/artworkService";
import { withImageUrl } from "@/lib/services/dto";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * PUT artwork SVG cho 1 frame → sanitize → render sync (~50ms) → done.
 * Render lỗi: VẪN LƯU artworkSvg + status failed (agent không mất WIP),
 * trả 422 ARTWORK_INVALID kèm hint sửa.
 */
export async function PUT(req: Request, ctx: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    enforceRateLimit("frames:artwork", 30);
    const { id } = await ctx.params;
    const body = await parseBody(req, artworkSchema);

    const frame = await prisma.frame.findUnique({ where: { id } });
    if (!frame) throw new AppError("NOT_FOUND", "Không tìm thấy frame.");

    const project = await prisma.project.findUnique({
      where: { id: frame.projectId },
      include: { assets: true },
    });
    if (!project) throw new AppError("NOT_FOUND", "Không tìm thấy project.");

    // Sanitize trước khi lưu — reject sớm với hint rõ ràng
    sanitizeSvg(body.svg, "frame");

    const saved = await prisma.frame.update({
      where: { id },
      data: { artworkSvg: body.svg },
    });

    try {
      await renderFrameArtwork(project, saved);
    } catch (err: unknown) {
      // Lưu trạng thái failed để UI/agent thấy — artwork không mất
      const message =
        err instanceof AppError
          ? err.hint
            ? `${err.message} — ${err.hint}`
            : err.message
          : err instanceof Error
            ? err.message
            : "Render lỗi.";
      await prisma.frame.update({
        where: { id },
        data: { status: "failed", errorMsg: message },
      });
      throw err;
    }

    const fresh = await prisma.frame.findUnique({ where: { id } });
    return Response.json(withImageUrl(fresh!));
  });
}
