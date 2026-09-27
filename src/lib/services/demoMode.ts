import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Public demo mode (DEMO_MODE=true): a passcode gate plus caps that make a
 * public URL safe to hand to judges.
 *   - passcode → signed session cookie `sbs_demo` = "<sid>.<hmac(sid)>". The
 *     HMAC key derives from DEMO_PASSCODE, so changing the passcode logs
 *     everyone out.
 *   - per-session project cap, ≤ 12 shots / 1K / 12 fps (Director ceiling),
 *     demo projects deleted after 24 h, a global daily token budget.
 * This module is pure (config + signing). The DB-backed parts live in demoGuard.ts.
 */

export const DEMO_COOKIE = "sbs_demo";

export interface DemoConfig {
  readonly enabled: boolean;
  readonly passcode: string;
  readonly maxProjectsPerSession: number;
  readonly dailyTokenBudget: number;
  readonly maxConcurrentRuns: number;
  readonly retentionHours: number;
}

const int = (v: string | undefined, d: number) => {
  const n = Number(v);
  return v && Number.isFinite(n) && n > 0 ? Math.floor(n) : d;
};

export function demoConfig(env: NodeJS.ProcessEnv = process.env): DemoConfig {
  return {
    enabled: env.DEMO_MODE === "true",
    passcode: env.DEMO_PASSCODE ?? "",
    maxProjectsPerSession: int(env.DEMO_MAX_PROJECTS_PER_SESSION, 3),
    dailyTokenBudget: int(env.DEMO_DAILY_TOKEN_BUDGET, 3_000_000),
    maxConcurrentRuns: int(env.DEMO_MAX_CONCURRENT_RUNS, 2),
    retentionHours: int(env.DEMO_RETENTION_HOURS, 24),
  };
}

function key(passcode: string): Buffer {
  return createHmac("sha256", "storyboard-studio-demo").update(passcode).digest();
}

export function signSession(sid: string, passcode: string): string {
  return `${sid}.${createHmac("sha256", key(passcode)).update(sid).digest("base64url")}`;
}

export function newSessionCookie(passcode: string): { sid: string; value: string } {
  const sid = randomBytes(12).toString("base64url");
  return { sid, value: signSession(sid, passcode) };
}

/** Returns the session id when the cookie is authentic, else null. */
export function verifySession(cookie: string | undefined | null, passcode: string): string | null {
  if (!cookie || !passcode) return null;
  const dot = cookie.indexOf(".");
  if (dot <= 0) return null;
  const sid = cookie.slice(0, dot);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(sid)) return null;
  const expected = Buffer.from(signSession(sid, passcode));
  const got = Buffer.from(cookie);
  return expected.length === got.length && timingSafeEqual(expected, got) ? sid : null;
}

export function passcodeMatches(given: string, passcode: string): boolean {
  if (!passcode) return false;
  const a = createHmac("sha256", "cmp").update(given).digest();
  const b = createHmac("sha256", "cmp").update(passcode).digest();
  return timingSafeEqual(a, b);
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

/** Paths reachable without the passcode (the unlock page, the public showcase, static assets). */
export function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/unlock" ||
    pathname === "/showcase" ||
    pathname.startsWith("/showcase/") ||
    pathname.startsWith("/api/demo/") ||
    pathname === "/api/meta" ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico"
  );
}

/** Demo session of a request (null when demo mode is off or the cookie is invalid). */
export function demoSessionOf(req: Request, cfg: DemoConfig = demoConfig()): string | null {
  if (!cfg.enabled) return null;
  return verifySession(readCookie(req.headers.get("cookie"), DEMO_COOKIE), cfg.passcode);
}
