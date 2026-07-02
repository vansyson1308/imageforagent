import { prisma } from "@/lib/db";
import { AppError } from "@/lib/services/apiError";
import { handleRoute, parseBody } from "@/lib/services/routeHelpers";
import { enforceRateLimit } from "@/lib/services/rateLimit";
import { aiEditSchema } from "@/lib/validation/schemas";
import { getTextProvider } from "@/lib/providers";

/**
 * AI bulk edit — trả BẢN ĐỀ XUẤT, KHÔNG ghi DB.
 * FE hiển thị diff và gọi /api/storyboard/apply-edit khi user duyệt.
 */
export async function POST(req: Request): Promise<Response> {
  return handleRoute(async () => {
    enforceRateLimit("storyboard:ai-edit", 10);
    const body = await parseBody(req, aiEditSchema);

    const frames = await prisma.frame.findMany({
      where: { projectId: body.projectId },
      orderBy: { index: "asc" },
      select: { index: true, shotType: true, description: true },
    });
    if (frames.length === 0) {
      throw new AppError("NOT_FOUND", "Project chưa có frame nào để sửa.");
    }

    const provider = getTextProvider();
    const proposal = await provider.editScript(body.instruction, frames);

    // Chuẩn hoá index liên tục 1..N phòng model trả lộn xộn
    const normalized = proposal
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((f, i) => ({ ...f, index: i + 1 }));

    return Response.json({ frames: normalized });
  });
}
