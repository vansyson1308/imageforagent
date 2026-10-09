import { handleRoute } from "@/lib/services/routeHelpers";
import { enforceRateLimit } from "@/lib/services/rateLimit";
import { runHealthChecks } from "@/lib/services/health";

export const dynamic = "force-dynamic";

/**
 * GET — public health report (no secrets, no paid calls): DB, storage,
 * ffmpeg, TTS, Token Factory reachability (`GET /v1/models`), Tavily key
 * presence, demo budget, version + commit. 200 when nothing failed, else 503.
 * The daily GitHub Actions check (`.github/workflows/health.yml`) calls it.
 */
export async function GET(): Promise<Response> {
  return handleRoute(async () => {
    enforceRateLimit("health", 30);
    const report = await runHealthChecks({ env: process.env });
    return Response.json(report, { status: report.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
  });
}
