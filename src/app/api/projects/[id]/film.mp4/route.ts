import { prisma } from "@/lib/db";
import { AppError } from "@/lib/services/apiError";
import { handleRoute } from "@/lib/services/routeHelpers";
import { enforceRateLimit } from "@/lib/services/rateLimit";
import { requireDemoSession } from "@/lib/services/demoGuard";
import { assembleFilm } from "@/lib/services/filmAssembler";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const maxDuration = 600;

/**
 * GET — the project's film as MP4 (1K, 12 fps, −16 LUFS mix), assembled
 * server-side with ffmpeg on first request, then cached until any shot
 * changes. Redirects to the file route (HTTP Range for seeking).
 */
export async function GET(req: Request, ctx: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    enforceRateLimit("film:mp4", 6);
    const { id } = await ctx.params;
    requireDemoSession(req);
    const project = await prisma.project.findUnique({ where: { id }, select: { id: true } });
    if (!project) throw new AppError("NOT_FOUND", "Không tìm thấy project.");
    const film = await assembleFilm(id);
    const location = `/api/files/${film.path}`;
    return new Response(null, {
      status: 302,
      headers: { Location: location, "Cache-Control": "no-store", "X-Film-Duration": String(film.durationSec), "X-Film-Cached": String(film.cached) },
    });
  });
}
