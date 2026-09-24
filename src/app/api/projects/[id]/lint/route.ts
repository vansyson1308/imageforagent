import { prisma } from "@/lib/db";
import { AppError } from "@/lib/services/apiError";
import { handleRoute } from "@/lib/services/routeHelpers";
import { buildTimeline, timelineDuration, timelineInputOf } from "@/lib/services/timeline";
import { cameraOfMotionSpec, lintStoryboard } from "@/lib/services/storyboardLint";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET lint storyboard — soát luật dựng (180°, jump cut, tốc độ đọc phụ đề,
 * độ dài shot, thoại tràn shot…) trên CÙNG timeline mà export dùng.
 */
export async function GET(_req: Request, ctx: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    const { id } = await ctx.params;
    const project = await prisma.project.findUnique({ where: { id }, include: { frames: { orderBy: { index: "asc" } } } });
    if (!project) throw new AppError("NOT_FOUND", "Không tìm thấy project.");
    const timeline = buildTimeline(project.frames.map((f) => timelineInputOf(f)), project.playbackSpeed);
    const findings = lintStoryboard(
      project.frames.map((f) => ({ ...f, camera: cameraOfMotionSpec(f.motionSpec) })),
      timeline,
    );
    const count = (s: string) => findings.filter((x) => x.severity === s).length;
    return Response.json({
      ok: count("error") === 0,
      durationSec: timelineDuration(timeline),
      summary: { error: count("error"), warning: count("warning"), info: count("info") },
      findings,
    });
  });
}
