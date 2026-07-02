import { prisma } from "@/lib/db";
import { AppError } from "@/lib/services/apiError";
import { handleRoute, parseBody } from "@/lib/services/routeHelpers";
import { enforceRateLimit } from "@/lib/services/rateLimit";
import { importScriptSchema } from "@/lib/validation/schemas";
import { parseTsv } from "@/lib/services/tsvParser";
import { readSheetScript } from "@/lib/services/sheetReader";
import { withImageUrl } from "@/lib/services/dto";

/**
 * Nạp kịch bản từ Google Sheet hoặc TSV — thay TOÀN BỘ frame hiện có
 * (transaction). Nếu project đã có frame và chưa confirmOverwrite → 409.
 */
export async function POST(req: Request): Promise<Response> {
  return handleRoute(async () => {
    enforceRateLimit("script:import", 10);
    const body = await parseBody(req, importScriptSchema);

    const project = await prisma.project.findUnique({
      where: { id: body.projectId },
      include: { _count: { select: { frames: true } } },
    });
    if (!project) throw new AppError("NOT_FOUND", "Không tìm thấy project.");

    if (project._count.frames > 0 && !body.confirmOverwrite) {
      throw new AppError(
        "CONFIRM_REQUIRED",
        `Project đang có ${project._count.frames} frame — import sẽ thay thế toàn bộ.`,
        "Gửi lại với confirmOverwrite=true để xác nhận ghi đè.",
      );
    }

    const result =
      body.source === "sheet"
        ? await readSheetScript(body.sheetUrl!)
        : parseTsv(body.tsvText!);

    if (!result.ok) {
      const detail = result.errors
        .map((e) => e.message)
        .slice(0, 5)
        .join(" · ");
      throw new AppError("SHEET_BAD_FORMAT", `Kịch bản có lỗi: ${detail}`);
    }

    const frames = await prisma.$transaction(async (tx) => {
      await tx.frame.deleteMany({ where: { projectId: body.projectId } });
      await tx.frame.createMany({
        data: result.frames.map((f) => ({
          projectId: body.projectId,
          index: f.index,
          shotType: f.shotType,
          description: f.description,
        })),
      });
      if (body.source === "sheet" && body.sheetUrl) {
        await tx.project.update({
          where: { id: body.projectId },
          data: { sheetUrl: body.sheetUrl },
        });
      }
      return tx.frame.findMany({
        where: { projectId: body.projectId },
        orderBy: { index: "asc" },
      });
    });

    return Response.json({ frames: frames.map(withImageUrl) });
  });
}
