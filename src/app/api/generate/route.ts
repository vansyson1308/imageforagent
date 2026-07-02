import { handleRoute, parseBody } from "@/lib/services/routeHelpers";
import { enforceRateLimit } from "@/lib/services/rateLimit";
import { generateSchema } from "@/lib/validation/schemas";
import { startJob } from "@/lib/services/jobRunner";

export async function POST(req: Request): Promise<Response> {
  return handleRoute(async () => {
    enforceRateLimit("generate:start", 10);
    const body = await parseBody(req, generateSchema);
    const jobId = await startJob(body.projectId, body.frameIds);
    return Response.json({ jobId }, { status: 202 });
  });
}
