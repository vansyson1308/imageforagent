import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/services/apiError";
import { handleRoute, parseBody } from "@/lib/services/routeHelpers";
import { enforceRateLimit } from "@/lib/services/rateLimit";
import { decodeWavBase64, MAX_MUSIC_SECONDS } from "@/lib/services/voiceService";
import { audioDuration } from "@/lib/services/audio/wav";
import { removeQuiet, saveBuffer, toPosix } from "@/lib/services/storage";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const soundtrackSchema = z.object({ wav: z.string().min(16).max(200_000_000) });

/** PUT nhạc nền project (WAV base64) — export mix duck nó dưới thoại. */
export async function PUT(req: Request, ctx: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    enforceRateLimit("projects:soundtrack", 4);
    const { id } = await ctx.params;
    const body = await parseBody(req, soundtrackSchema);
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) throw new AppError("NOT_FOUND", "Không tìm thấy project.");
    const { buffer, audio } = decodeWavBase64(body.wav, MAX_MUSIC_SECONDS, "Soundtrack");
    const musicPath = toPosix(`${id}/audio/music.wav`);
    await saveBuffer(musicPath, buffer);
    await prisma.project.update({ where: { id }, data: { musicPath } });
    return Response.json({ ok: true, musicPath, duration: Math.round(audioDuration(audio) * 1000) / 1000 });
  });
}

export async function DELETE(_req: Request, ctx: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    const { id } = await ctx.params;
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) throw new AppError("NOT_FOUND", "Không tìm thấy project.");
    if (project.musicPath) await removeQuiet(project.musicPath);
    await prisma.project.update({ where: { id }, data: { musicPath: null } });
    return Response.json({ ok: true });
  });
}
