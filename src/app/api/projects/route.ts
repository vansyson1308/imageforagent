import { prisma } from "@/lib/db";
import { handleRoute, parseBody } from "@/lib/services/routeHelpers";
import { enforceRateLimit } from "@/lib/services/rateLimit";
import { createProjectSchema } from "@/lib/validation/schemas";
import { assertProjectQuota, cleanupDemoProjects, requireDemoSession } from "@/lib/services/demoGuard";

export async function POST(req: Request): Promise<Response> {
  return handleRoute(async () => {
    enforceRateLimit("projects:create", 10);
    const body = await parseBody(req, createProjectSchema);
    // Demo mode: project belongs to the visitor's session (cap + 24 h cleanup)
    const sid = requireDemoSession(req);
    if (sid) {
      await cleanupDemoProjects();
      await assertProjectQuota(sid);
    }
    const project = await prisma.project.create({ data: { name: body.name, demoSession: sid } });
    return Response.json(project, { status: 201 });
  });
}

export async function GET(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const sid = requireDemoSession(req);
    const projects = await prisma.project.findMany({
      where: sid ? { demoSession: sid } : undefined,
      orderBy: { updatedAt: "desc" },
      include: { _count: { select: { frames: true, assets: true } } },
    });
    const doneCounts = await prisma.frame.groupBy({
      by: ["projectId"],
      where: { status: "done" },
      _count: { _all: true },
    });
    const doneMap = new Map(doneCounts.map((d) => [d.projectId, d._count._all]));
    const result = projects.map((p) => ({
      ...p,
      frameCount: p._count.frames,
      doneCount: doneMap.get(p.id) ?? 0,
    }));
    return Response.json(result);
  });
}
