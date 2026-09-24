import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/services/apiError";
import { handleRoute, parseBody } from "@/lib/services/routeHelpers";
import { enforceRateLimit } from "@/lib/services/rateLimit";
import { resolveVoice } from "@/lib/services/voiceService";
import { audioDuration } from "@/lib/services/audio/wav";
import { removeQuiet, saveBuffer, toPosix } from "@/lib/services/storage";
import { renderFrameMotion } from "@/lib/services/clipService";
import { withImageUrl } from "@/lib/services/dto";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const dialogueSchema = z.object({
  text: z.string().min(1).max(2000),
  /** WAV base64 (giọng thu/tạo ngoài) — hoặc tts để engine đọc bằng espeak-ng local. */
  wav: z.string().max(40_000_000).optional(),
  tts: z
    .object({
      voice: z.string().regex(/^[a-z]{2,3}([-+][\w-]{1,32})?$/).default("vi"),
      speed: z.number().int().min(80).max(400).default(160),
    })
    .optional(),
  /** Giây từ đầu shot tới lúc bắt đầu nói. */
  offset: z.number().min(0).max(600).default(0),
});

/**
 * PUT thoại cho frame: văn bản (phụ đề) + giọng (WAV hoặc TTS local). Frame
 * là shot motion có rig lipsync ⇒ render lại clip để miệng khớp giọng.
 */
export async function PUT(req: Request, ctx: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    enforceRateLimit("frames:dialogue", 10);
    const { id } = await ctx.params;
    const body = await parseBody(req, dialogueSchema);
    const frame = await prisma.frame.findUnique({ where: { id } });
    if (!frame) throw new AppError("NOT_FOUND", "Không tìm thấy frame.");
    const voice = await resolveVoice({ wav: body.wav, text: body.text, tts: body.tts });
    let voicePath: string | null = null;
    let voiceDuration: number | null = null;
    if (voice) {
      voicePath = toPosix(`${frame.projectId}/audio/${frame.id}.wav`);
      await saveBuffer(voicePath, voice.buffer);
      voiceDuration = Math.round(audioDuration(voice.audio) * 1000) / 1000;
    } else if (frame.voicePath) {
      await removeQuiet(frame.voicePath);
    }
    const saved = await prisma.frame.update({
      where: { id },
      data: { dialogue: body.text, voicePath, voiceDuration, voiceOffset: body.offset },
    });
    const warnings: string[] = [];
    if (saved.motionSpec && /"type"\s*:\s*"lipsync"/.test(saved.motionSpec)) {
      const project = await prisma.project.findUnique({ where: { id: saved.projectId }, include: { assets: true } });
      if (project) warnings.push(...(await renderFrameMotion(project, saved)).warnings);
    }
    if (voiceDuration !== null && saved.clipDuration && body.offset + voiceDuration > saved.clipDuration) {
      warnings.push(`Voice (${voiceDuration}s from ${body.offset}s) runs past the shot (${saved.clipDuration}s) — it will be cut at the shot end.`);
    }
    const fresh = await prisma.frame.findUnique({ where: { id } });
    return Response.json({ ...withImageUrl(fresh!), warnings });
  });
}

export async function DELETE(_req: Request, ctx: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    enforceRateLimit("frames:dialogue");
    const { id } = await ctx.params;
    const frame = await prisma.frame.findUnique({ where: { id } });
    if (!frame) throw new AppError("NOT_FOUND", "Không tìm thấy frame.");
    if (frame.voicePath) await removeQuiet(frame.voicePath);
    const fresh = await prisma.frame.update({
      where: { id },
      data: { dialogue: null, voicePath: null, voiceDuration: null, voiceOffset: 0 },
    });
    return Response.json(withImageUrl(fresh));
  });
}
