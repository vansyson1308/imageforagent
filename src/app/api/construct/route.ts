import { handleRoute, parseBody } from "@/lib/services/routeHelpers";
import { enforceRateLimit } from "@/lib/services/rateLimit";
import { constructRequestSchema } from "@/lib/validation/constructSchema";
import { compileConstruction } from "@/lib/services/construct/compile";
import { LOGICAL_CANVAS, renderArtwork } from "@/lib/services/svgRenderer";

/**
 * POST /api/construct — compiler kỷ hà STATELESS: spec JSON (primitives +
 * boolean + transform + 3D) → SVG fragment. Không lưu DB; agent dán kết quả
 * vào artworkDefs/frame qua flow artwork sẵn có.
 *
 * Body có `preview` ⇒ response kèm `previewPng` (data URI base64) — agent
 * nhìn thấy hình ngay trong 1 round-trip, không cần đụng project/frame.
 * Lỗi spec: 422 CONSTRUCTION_INVALID + hint tiếng Anh hành động được.
 */
export async function POST(req: Request): Promise<Response> {
  return handleRoute(async () => {
    enforceRateLimit("construct:compile", 20);
    const body = await parseBody(req, constructRequestSchema);

    const result = compileConstruction(body.spec);

    let previewPng: string | undefined;
    if (body.preview) {
      const logical = LOGICAL_CANVAS[body.preview.aspectRatio];
      const wrapped = `<rect width="${logical.w}" height="${logical.h}" fill="${body.preview.background}"/>\n${result.svg}`;
      const png = await renderArtwork(
        null,
        wrapped,
        body.preview.aspectRatio,
        body.preview.resolution,
      );
      previewPng = `data:image/png;base64,${png.toString("base64")}`;
    }

    return Response.json({
      svg: result.svg,
      stats: result.stats,
      warnings: result.warnings,
      ...(previewPng !== undefined && { previewPng }),
    });
  });
}
