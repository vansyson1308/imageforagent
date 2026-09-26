import { z } from "zod";
import { AppError } from "@/lib/services/apiError";
import { handleRoute, parseBody } from "@/lib/services/routeHelpers";
import { enforceRateLimit } from "@/lib/services/rateLimit";
import { DEMO_COOKIE, demoConfig, demoSessionOf, newSessionCookie, passcodeMatches } from "@/lib/services/demoMode";

const unlockSchema = z.object({ passcode: z.string().min(1).max(200) });

/** POST {passcode} → signed demo session cookie (HttpOnly, 7 days). */
export async function POST(req: Request): Promise<Response> {
  return handleRoute(async () => {
    enforceRateLimit("demo:unlock", 5);
    const cfg = demoConfig();
    if (!cfg.enabled) return Response.json({ ok: true, demo: false });
    const body = await parseBody(req, unlockSchema);
    if (!cfg.passcode) throw new AppError("UNAUTHORIZED", "Demo passcode is not configured on this server.", "The operator must set DEMO_PASSCODE.");
    if (!passcodeMatches(body.passcode.trim(), cfg.passcode)) throw new AppError("UNAUTHORIZED", "Wrong passcode.", "Use the passcode from the submission's testing instructions.");
    const { value } = newSessionCookie(cfg.passcode);
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    return Response.json(
      { ok: true, demo: true },
      { headers: { "Set-Cookie": `${DEMO_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 3600}${secure}` } },
    );
  });
}

/** GET → {demo, unlocked} (public; drives the UI gate). */
export async function GET(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const cfg = demoConfig();
    return Response.json({ demo: cfg.enabled, unlocked: !cfg.enabled || demoSessionOf(req, cfg) !== null, configured: !cfg.enabled || cfg.passcode.length > 0 });
  });
}
