import { NextResponse, type NextRequest } from "next/server";
import { DEMO_COOKIE, demoConfig, isPublicPath, verifySession } from "@/lib/services/demoMode";

/**
 * Demo passcode gate (Next 16 `proxy`, the renamed middleware). No-op
 * unless DEMO_MODE=true. Pages redirect to /unlock; API calls get 401 JSON.
 */
export function proxy(request: NextRequest) {
  const cfg = demoConfig();
  if (!cfg.enabled) return NextResponse.next();
  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();
  if (verifySession(request.cookies.get(DEMO_COOKIE)?.value, cfg.passcode)) return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Demo passcode required.", hint: "Open /unlock and enter the passcode from the submission's testing instructions." } },
      { status: 401 },
    );
  }
  const url = request.nextUrl.clone();
  url.pathname = "/unlock";
  url.search = `?next=${encodeURIComponent(pathname + request.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
