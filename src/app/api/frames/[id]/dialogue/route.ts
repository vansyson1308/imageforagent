import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/services/apiError";
import { handleRoute, parseBody } from "@/lib/services/routeHelpers";
import { enforceRateLimit } from "@/lib/services/rateLimit";
import { removeQuiet } from "@/lib/services/storage";
import { writeFrameDialogue } from "@/lib/services/frameWrites";
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
    const { frame, warnings } = await writeFrameDialogue(id, body);
    return Response.json({ ...withImageUrl(frame), warnings });
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
