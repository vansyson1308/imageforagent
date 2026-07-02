import { prisma } from "@/lib/db";
import { AppError } from "@/lib/services/apiError";
import { handleRoute } from "@/lib/services/routeHelpers";
import { enforceRateLimit } from "@/lib/services/rateLimit";
import { removeQuiet } from "@/lib/services/storage";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function DELETE(_req: Request, ctx: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    enforceRateLimit("assets:delete", 20);
    const { id } = await ctx.params;
    const asset = await prisma.asset.findUnique({ where: { id } });
    if (!asset) throw new AppError("NOT_FOUND", "Không tìm thấy asset.");
    await prisma.asset.delete({ where: { id } });
    await removeQuiet(asset.filePath);
    return Response.json({ ok: true });
  });
}
