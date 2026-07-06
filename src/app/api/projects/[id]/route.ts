import { prisma } from "@/lib/db";
import { AppError } from "@/lib/services/apiError";
import { handleRoute, parseBody } from "@/lib/services/routeHelpers";
import { enforceRateLimit } from "@/lib/services/rateLimit";
import { patchProjectSchema } from "@/lib/validation/schemas";
import { withAssetUrl, withImageUrl } from "@/lib/services/dto";
import { removeDirQuiet } from "@/lib/services/storage";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, ctx: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    const { id } = await ctx.params;
    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        frames: { orderBy: { index: "asc" } },
        assets: { orderBy: [{ kind: "asc" }, { order: "asc" }] },
      },
    });
    if (!project) throw new AppError("NOT_FOUND", "Không tìm thấy project.");
    return Response.json({
      ...project,
      frames: project.frames.map(withImageUrl),
      assets: project.assets.map(withAssetUrl),
    });
  });
}

export async function PATCH(req: Request, ctx: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    enforceRateLimit("projects:patch");
    const { id } = await ctx.params;
    const body = await parseBody(req, patchProjectSchema);
    const existing = await prisma.project.findUnique({ where: { id } });
    if (!existing) throw new AppError("NOT_FOUND", "Không tìm thấy project.");
    const project = await prisma.project.update({ where: { id }, data: body });
    return Response.json(project);
  });
}

export async function DELETE(_req: Request, ctx: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    enforceRateLimit("projects:delete", 10);
    const { id } = await ctx.params;
    const existing = await prisma.project.findUnique({ where: { id } });
    if (!existing) throw new AppError("NOT_FOUND", "Không tìm thấy project.");
    await prisma.project.delete({ where: { id } }); // cascade frames + assets
    await removeDirQuiet(id);
    return Response.json({ ok: true });
  });
}
