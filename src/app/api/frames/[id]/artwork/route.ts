import { handleRoute, parseBody } from "@/lib/services/routeHelpers";
import { enforceRateLimit } from "@/lib/services/rateLimit";
import { artworkSchema } from "@/lib/validation/schemas";
import { withImageUrl } from "@/lib/services/dto";
import { writeFrameArtwork } from "@/lib/services/frameWrites";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * PUT artwork SVG cho 1 frame → sanitize → render sync (~50ms) → done.
 * Frame đang là shot motion → gỡ motion (ảnh tĩnh thay thế clip).
 * Render lỗi: VẪN LƯU artworkSvg + status failed (agent không mất WIP),
 * trả 422 ARTWORK_INVALID kèm hint sửa. Logic chung: frameWrites.ts.
 */
export async function PUT(req: Request, ctx: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    enforceRateLimit("frames:artwork", 30);
    const { id } = await ctx.params;
    const body = await parseBody(req, artworkSchema);
    return Response.json(withImageUrl(await writeFrameArtwork(id, body.svg)));
  });
}
