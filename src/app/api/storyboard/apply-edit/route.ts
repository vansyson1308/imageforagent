import { handleRoute, parseBody } from "@/lib/services/routeHelpers";
import { enforceRateLimit } from "@/lib/services/rateLimit";
import { applyEditSchema } from "@/lib/validation/schemas";
import { withImageUrl } from "@/lib/services/dto";
import { replaceScript } from "@/lib/services/frameWrites";

/**
 * Ghi bản kịch bản đã duyệt (từ diff-review AI edit) — thay toàn bộ frame
 * trong transaction. Frame giữ nguyên description+shotType cũ sẽ giữ ảnh
 * đã generate; frame đổi nội dung reset về draft.
 */
export async function POST(req: Request): Promise<Response> {
  return handleRoute(async () => {
    enforceRateLimit("storyboard:apply-edit", 10);
    const body = await parseBody(req, applyEditSchema);

    const frames = await replaceScript(body.projectId, body.frames);

    return Response.json({ frames: frames.map(withImageUrl) });
  });
}
