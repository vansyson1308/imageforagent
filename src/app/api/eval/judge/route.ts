import { z } from "zod";
import { AppError } from "@/lib/services/apiError";
import { handleRoute, parseBody } from "@/lib/services/routeHelpers";
import { enforceRateLimit } from "@/lib/services/rateLimit";
import { demoConfig, passcodeMatches } from "@/lib/services/demoMode";
import { createNemotronProvider } from "@/lib/providers";
import { JUDGE_MODELS } from "@/lib/services/evalJudges";

const bodySchema = z.object({
  model: z.enum(JUDGE_MODELS),
  prompt: z.string().min(1).max(4000),
  /** One frame as a data URI (the bench sends ≤ 1024 px JPEG). */
  image: z.string().max(3_000_000).regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/),
  maxTokens: z.number().int().min(16).max(400).default(200),
  json: z.boolean().default(true),
});

/**
 * POST — score one frame with an eval judge, on the server (D48): the
 * benchmark's judges run where the provider key lives, so the key never
 * leaves the server. Operator only: without the operator passcode in
 * `x-operator-passcode` (constant-time compare) the route does not exist
 * (404). Only the judge models are callable, never a crew or critic model.
 * The client records the returned cost in its spend ledger.
 */
export async function POST(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const cfg = demoConfig();
    if (!cfg.operatorPasscode || !passcodeMatches(req.headers.get("x-operator-passcode") ?? "", cfg.operatorPasscode)) throw new AppError("NOT_FOUND", "Not found.");
    enforceRateLimit("eval:judge", 60);
    const body = await parseBody(req, bodySchema);
    const provider = createNemotronProvider();
    if (!provider) throw new AppError("NOT_FOUND", "Not found.");
    const r = await provider.chat([{ role: "user", content: body.prompt, images: [body.image] }], {
      model: body.model,
      maxTokens: body.maxTokens,
      temperature: 0,
      ...(body.json && { responseFormat: { type: "json_object" as const } }),
    });
    return Response.json({ text: r.text, model: r.model, usage: r.usage, costUsd: r.costUsd });
  });
}
