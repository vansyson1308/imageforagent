import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { POST as startDirector, GET as listRuns } from "@/app/api/projects/[id]/director/route";
import { GET as getRun } from "@/app/api/projects/[id]/director/runs/[runId]/route";
import { POST as cancelRoute } from "@/app/api/projects/[id]/director/runs/[runId]/cancel/route";
import { GET as filmRoute } from "@/app/api/projects/[id]/film.mp4/route";
import { POST as createProject, GET as listProjects } from "@/app/api/projects/route";
import { POST as unlock, GET as unlockStatus } from "@/app/api/demo/unlock/route";
import { GET as meta } from "@/app/api/meta/route";
import { proxy } from "@/proxy";
import { assembleSteps, ffmpegAvailable } from "@/lib/services/filmAssembler";
import { signSession, verifySession, passcodeMatches, DEMO_COOKIE } from "@/lib/services/demoMode";
import { buildTimeline } from "@/lib/services/timeline";

// Route-level tests: handlers are called directly with real Requests (no server,
// no network). LLM_PROVIDER=mock → the scripted demo crew.

let storage: string;
const created: string[] = [];
const hasFfmpeg = ffmpegAvailable();

beforeAll(async () => {
  storage = await fs.mkdtemp(path.join(os.tmpdir(), "director-routes-"));
  process.env.STORAGE_ROOT = storage;
  process.env.LLM_PROVIDER = "mock";
  delete process.env.DEMO_MODE;
});

// The in-memory rate limiter (3 Director starts / 10 s) is global — reset between tests
beforeEach(() => {
  (globalThis as unknown as { __rateLimit?: Map<string, unknown> }).__rateLimit?.clear();
});

afterAll(async () => {
  await prisma.project.deleteMany({ where: { id: { in: created } } });
  await fs.rm(storage, { recursive: true, force: true });
  delete process.env.LLM_PROVIDER;
});

const ctx = <T extends object>(p: T) => ({ params: Promise.resolve(p) });
const json = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

async function newProject(): Promise<string> {
  const p = await prisma.project.create({ data: { name: "routes" } });
  created.push(p.id);
  return p.id;
}

interface Sse {
  event: string;
  data: Record<string, unknown>;
}

async function readSse(res: Response, onEvent?: (e: Sse) => Promise<void> | void): Promise<Sse[]> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const out: Sse[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const ev = chunk.match(/^event: (.+)$/m)?.[1];
      const data = chunk.match(/^data: (.+)$/m)?.[1];
      if (ev && data) {
        const e = { event: ev, data: JSON.parse(data) };
        out.push(e);
        await onEvent?.(e);
      }
    }
  }
  return out;
}

const STORY = "Lan lights a paper lantern for the Mid-Autumn festival. The wind lifts it over the rooftops. Her grandfather helps her find it by the river.";

describe("POST /api/projects/:id/director (SSE)", () => {
  let projectId = "";
  let runId = "";

  it("streams run → plan → steps → frames → done, and persists the trace", async () => {
    projectId = await newProject();
    const res = await startDirector(json(`http://t/api/projects/${projectId}/director`, { story: STORY, language: "en", maxShots: 3 }), ctx({ id: projectId }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    runId = res.headers.get("x-director-run")!;
    const events = await readSse(res);
    const names = events.map((e) => e.event);
    expect(names[0]).toBe("run");
    expect(names).toContain("plan");
    expect(names).toContain("step");
    expect(names.filter((n) => n === "frame").length).toBeGreaterThanOrEqual(3);
    expect(names.at(-1)).toBe("done");
    expect(events.at(-1)!.data).toMatchObject({ status: "done" });
    expect(events[0].data).toMatchObject({ provider: "mock" });

    const trace = await getRun(new Request("http://t"), ctx({ id: projectId, runId }));
    const body = await trace.json();
    expect(body.status).toBe("done");
    expect(body.steps.length).toBeGreaterThan(8);
    expect(body.steps.some((s: { imageUrl: string | null }) => s.imageUrl?.startsWith("/api/files/"))).toBe(true);
    expect(body.summary.rendered).toBe(3);

    const list = await (await listRuns(new Request("http://t"), ctx({ id: projectId }))).json();
    expect(list.runs[0]).toMatchObject({ id: runId, status: "done", live: false });
  }, 120_000);

  it("rejects bad input with the error envelope", async () => {
    const res = await startDirector(json("http://t", { story: "short" }), ctx({ id: projectId }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION");
    const missing = await startDirector(json("http://t", { story: STORY }), ctx({ id: "nope-nope-nope" }));
    expect(missing.status).toBe(404);
  });

  it("cancels a live run via POST …/cancel", async () => {
    const pid = await newProject();
    const res = await startDirector(json("http://t", { story: STORY, maxShots: 3 }), ctx({ id: pid }));
    const rid = res.headers.get("x-director-run")!;
    let cancelStatus = "";
    const events = await readSse(res, async (e) => {
      if (e.event === "plan") {
        const c = await cancelRoute(new Request("http://t", { method: "POST" }), ctx({ id: pid, runId: rid }));
        cancelStatus = (await c.json()).status;
      }
    });
    expect(cancelStatus).toBe("cancelling");
    expect(events.at(-1)!.data).toMatchObject({ type: "done", status: "cancelled" });
    expect((await prisma.directorRun.findUniqueOrThrow({ where: { id: rid } })).status).toBe("cancelled");
  }, 120_000);

  it("cancels when the client disconnects (request signal aborted)", async () => {
    const pid = await newProject();
    const ac = new AbortController();
    const req = new Request("http://t", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ story: STORY, maxShots: 3 }), signal: ac.signal });
    const res = await startDirector(req, ctx({ id: pid }));
    const rid = res.headers.get("x-director-run")!;
    const events = await readSse(res, (e) => {
      if (e.event === "plan") ac.abort();
    });
    expect(events.at(-1)!.data).toMatchObject({ status: "cancelled" });
    expect((await prisma.directorRun.findUniqueOrThrow({ where: { id: rid } })).status).toBe("cancelled");
  }, 120_000);

  it.skipIf(!hasFfmpeg)("GET film.mp4 assembles the film once (cached after), duration matches the timeline", async () => {
    const res = await filmRoute(new Request("http://t"), ctx({ id: projectId }));
    expect(res.status).toBe(302);
    const loc = res.headers.get("location")!;
    expect(loc).toMatch(/^\/api\/files\/.+\/film\/film-[0-9a-f]{12}\.mp4$/);
    expect(res.headers.get("x-film-cached")).toBe("false");
    const abs = path.join(storage, loc.replace("/api/files/", ""));
    const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", abs], { encoding: "utf8" });
    const info = JSON.parse(probe.stdout);
    const want = Number(res.headers.get("x-film-duration"));
    expect(Math.abs(Number(info.format.duration) - want)).toBeLessThan(0.25);
    expect(info.streams.map((s: { codec_type: string }) => s.codec_type)).toEqual(expect.arrayContaining(["video", "audio"]));
    const again = await filmRoute(new Request("http://t"), ctx({ id: projectId }));
    expect(again.headers.get("x-film-cached")).toBe("true");
  }, 180_000);

  it("exposes the Director in /api/meta without leaking keys", async () => {
    const m = await (await meta()).json();
    expect(m.director).toMatchObject({ enabled: true, provider: "mock" });
    expect(JSON.stringify(m)).not.toMatch(/NEBIUS_API_KEY|Bearer/);
  });
});

describe("film assembler steps (pure)", () => {
  it("mirrors assemble.sh: segments, xfade graph at timeline offsets, audio mux, argv only", () => {
    const tl = buildTimeline(
      [
        { index: 1, description: "a", clip: { fps: 12, frameCount: 36, duration: 3 } },
        { index: 2, description: "b", transition: { kind: "dissolve", duration: 0.5 } },
      ],
      2,
    );
    const steps = assembleSteps(
      tl.map((e) => ({ badge: `F0${e.index}`, entry: e, still: `/s/F0${e.index}.png`, clipPattern: e.kind === "clip" ? "/c/%04d.png" : null })),
      "/w",
      "/o/film.mp4",
      12,
      "/w/mix.wav",
    );
    expect(steps.map((s) => s.label)).toEqual(["shot F01", "still F02", "transitions", "mux audio"]);
    const graph = steps[2].args[steps[2].args.indexOf("-filter_complex") + 1];
    expect(graph).toContain(`xfade=transition=fade:duration=${tl[1].transitionIn!.duration}:offset=${tl[1].startSec}`);
    expect(steps[3].args).toEqual(expect.arrayContaining(["-map", "1:a", "-c:a", "aac", "/o/film.mp4"]));
    for (const s of steps) for (const a of s.args) expect(a).not.toMatch(/[;&|`$]\s*(rm|sh)\b/);
  });
});

describe("demo mode", () => {
  const PASS = "judge-2026";
  beforeAll(() => {
    process.env.DEMO_MODE = "true";
    process.env.DEMO_PASSCODE = PASS;
    process.env.DEMO_MAX_PROJECTS_PER_SESSION = "2";
  });
  afterAll(() => {
    delete process.env.DEMO_MODE;
    delete process.env.DEMO_PASSCODE;
    delete process.env.DEMO_MAX_PROJECTS_PER_SESSION;
  });

  it("signs and verifies sessions; tampering or a new passcode invalidates them", () => {
    const c = signSession("abcdefgh1234", PASS);
    expect(verifySession(c, PASS)).toBe("abcdefgh1234");
    expect(verifySession(c.replace("abcdefgh1234", "abcdefgh1235"), PASS)).toBeNull();
    expect(verifySession(c, "other")).toBeNull();
    expect(verifySession(undefined, PASS)).toBeNull();
    expect(passcodeMatches(PASS, PASS)).toBe(true);
    expect(passcodeMatches("x", PASS)).toBe(false);
    expect(passcodeMatches("", "")).toBe(false);
  });

  it("proxy: API → 401 JSON, pages → /unlock, showcase and unlock stay public", async () => {
    const api = proxy(new NextRequest("http://t/api/projects"));
    expect(api.status).toBe(401);
    expect((await api.json()).error.code).toBe("UNAUTHORIZED");
    const page = proxy(new NextRequest("http://t/projects?x=1"));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toBe("http://t/unlock?next=%2Fprojects%3Fx%3D1");
    for (const p of ["/unlock", "/showcase", "/showcase/lantern/film.mp4", "/api/demo/unlock", "/api/meta"]) {
      expect(proxy(new NextRequest(`http://t${p}`)).headers.get("x-middleware-next")).toBe("1");
    }
    const ok = proxy(new NextRequest("http://t/api/projects", { headers: { cookie: `${DEMO_COOKIE}=${encodeURIComponent(signSession("sessionAAAA", PASS))}` } }));
    expect(ok.headers.get("x-middleware-next")).toBe("1");
  });

  it("unlock → cookie → own projects only, capped per session; Director needs the session", async () => {
    expect((await (await unlockStatus(new Request("http://t"))).json())).toMatchObject({ demo: true, unlocked: false, configured: true });
    const bad = await unlock(json("http://t", { passcode: "nope" }));
    expect(bad.status).toBe(401);
    const good = await unlock(json("http://t", { passcode: PASS }));
    expect(good.status).toBe(200);
    const setCookie = good.headers.get("set-cookie")!;
    expect(setCookie).toMatch(/^sbs_demo=.+; Path=\/; HttpOnly; SameSite=Lax/);
    const cookie = setCookie.split(";")[0];

    expect((await createProject(json("http://t", { name: "anon" }))).status).toBe(401);
    const a = await createProject(json("http://t", { name: "mine 1" }, { cookie }));
    const b = await createProject(json("http://t", { name: "mine 2" }, { cookie }));
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    const pa = await a.json();
    created.push(pa.id, (await b.json()).id);
    expect(pa.demoSession).toBeTruthy();
    const c = await createProject(json("http://t", { name: "too many" }, { cookie }));
    expect(c.status).toBe(429);
    expect((await c.json()).error.code).toBe("QUOTA_EXCEEDED");
    const mine = await (await listProjects(new Request("http://t", { headers: { cookie } }))).json();
    expect(mine.map((p: { name: string }) => p.name).sort()).toEqual(["mine 1", "mine 2"]);

    const other = await newProject(); // not this session's
    const denied = await startDirector(json("http://t", { story: STORY }, { cookie }), ctx({ id: other }));
    expect(denied.status).toBe(401);
    const anon = await startDirector(json("http://t", { story: STORY }), ctx({ id: pa.id }));
    expect(anon.status).toBe(401);
  });

  it("deletes demo projects older than the retention window", async () => {
    const old = await prisma.project.create({ data: { name: "old demo", demoSession: "sessionOLD1", createdAt: new Date(Date.now() - 25 * 3600_000) } });
    const keep = await prisma.project.create({ data: { name: "regular", createdAt: new Date(Date.now() - 48 * 3600_000) } });
    created.push(old.id, keep.id);
    const { cleanupDemoProjects } = await import("@/lib/services/demoGuard");
    expect(await cleanupDemoProjects()).toBeGreaterThanOrEqual(1);
    expect(await prisma.project.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await prisma.project.findUnique({ where: { id: keep.id } })).not.toBeNull();
  });

  it("enforces the global daily token budget", async () => {
    const { dailyGate } = await import("@/lib/services/demoGuard");
    process.env.DEMO_DAILY_TOKEN_BUDGET = "1000";
    const pid = await newProject();
    await prisma.directorRun.create({ data: { projectId: pid, story: "x", models: "{}", config: "{}", tokensIn: 900, tokensOut: 200, status: "done" } });
    await expect(dailyGate()).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
    process.env.DEMO_DAILY_TOKEN_BUDGET = "1000000000";
    const g = await dailyGate();
    g.spend(10);
    expect(() => g.gate()).not.toThrow();
    delete process.env.DEMO_DAILY_TOKEN_BUDGET;
  });
});
