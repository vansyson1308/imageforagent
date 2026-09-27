/**
 * Frame-stepped screen capture for the demo video: every output frame is a
 * screenshot taken after the virtual camera moved a little, so scrolling is
 * smooth (spring-eased) and time-lapses stay fluid. Playwright's recordVideo
 * (≈25 fps, repaint-driven) + wheel steps + setpts looked jerky.
 *
 *   npx tsx demo/video/record-smooth.ts --base http://localhost:3100 [--showcase https://<host>/showcase] [--out demo/video/_work]
 *
 * Writes _work/live.mp4 + _work/live.json ({fps, a, b, c} frame counts:
 * A = typing (1×), B = the run (time-lapsed by build.sh), C = the result tour (1×))
 * and _work/showcase.mp4. 1920×1080 at 30 fps (viewport 1280×720 × DPR 1.5).
 */
import "../../scripts/director/env";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const argv = process.argv.slice(2);
const arg = (k: string, d = "") => {
  const i = argv.indexOf(k);
  return i >= 0 ? (argv[i + 1] ?? d) : d;
};
const FPS = 30;
const STORY =
  "Every evening, old Mrs. Tanaka lights a paper lantern in the window of her noodle shop so her son, a fisherman, can find the harbour. One stormy night the lantern blows out. The children of the street bring their own lanterns and line the pier with light. At dawn, the fishing boat comes home.";

interface Page {
  goto(url: string): Promise<unknown>;
  waitForSelector(sel: string, o?: { timeout?: number }): Promise<unknown>;
  click(sel: string): Promise<void>;
  keyboard: { type(t: string): Promise<void> };
  getByRole(role: string, o: { name: string | RegExp; exact?: boolean }): { click(): Promise<void> };
  locator(sel: string): { count(): Promise<number> };
  on(ev: "dialog", fn: (d: { accept(): Promise<void> }) => void): void;
  evaluate<T>(fn: string): Promise<T>;
  screenshot(o: { type: "jpeg"; quality: number }): Promise<Buffer>;
}
interface Browser {
  newContext(o: Record<string, unknown>): Promise<{ newPage(): Promise<Page>; close(): Promise<void> }>;
  close(): Promise<void>;
}

async function loadPlaywright(): Promise<{ chromium: { launch(o?: Record<string, unknown>): Promise<Browser> } }> {
  const req = createRequire(import.meta.url);
  for (const c of [process.env.PLAYWRIGHT_MODULE, "playwright", "/opt/node22/lib/node_modules/playwright", "/usr/lib/node_modules/playwright", "/usr/local/lib/node_modules/playwright"].filter(Boolean) as string[]) {
    try {
      return req(c);
    } catch {
      // next
    }
  }
  throw new Error("Playwright not found: npm i -g playwright, or set PLAYWRIGHT_MODULE.");
}

/** JPEG frames piped into ffmpeg at a constant 30 fps. */
class FrameSink {
  private readonly ff: ChildProcessWithoutNullStreams;
  count = 0;
  constructor(file: string) {
    this.ff = spawn("ffmpeg", ["-loglevel", "error", "-y", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(FPS), "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p", file]);
    this.ff.stderr.on("data", (d) => process.stderr.write(d));
  }
  async push(jpeg: Buffer, times = 1) {
    for (let i = 0; i < times; i++) {
      if (!this.ff.stdin.write(jpeg)) await new Promise((r) => this.ff.stdin.once("drain", r));
      this.count++;
    }
  }
  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ff.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
      this.ff.stdin.end();
    });
  }
}

/** Critically-damped-ish spring: smooth start and stop, bounded speed. */
class Camera {
  y = 0;
  private v = 0;
  constructor(private readonly maxStep: number) {}
  step(target: number): number {
    this.v = this.v * 0.82 + (target - this.y) * 0.018;
    this.v = Math.max(-this.maxStep, Math.min(this.maxStep, this.v));
    this.y += this.v;
    return Math.round(this.y * 10) / 10;
  }
}

const POSITIONS = `(() => {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const tops = {};
  const want = { grid: /^\\s*shots\\s*$/i, timeline: /crew timeline/i };
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    for (const [k, re] of Object.entries(want)) {
      if (tops[k] === undefined && re.test(n.textContent || "")) tops[k] = n.parentElement.getBoundingClientRect().top + scrollY;
    }
  }
  const v = document.querySelector("video");
  return { grid: tops.grid ?? null, timeline: tops.timeline ?? null, video: v ? v.getBoundingClientRect().top + scrollY : null, max: document.documentElement.scrollHeight - innerHeight };
})()`;

/** Wait two animation frames (the compositor repaints video layers after a scroll), then capture. */
async function shoot(page: Page, sink: FrameSink, times = 1) {
  await page.evaluate(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`);
  await sink.push(await page.screenshot({ type: "jpeg", quality: 92 }), times);
}

async function recordLive(browser: Browser, base: string, out: string) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
  const page = await ctx.newPage();
  page.on("dialog", (d) => void d.accept());
  await page.goto(`${base}/`);
  await page.waitForSelector("textarea", { timeout: 60_000 });
  const fresh = await page.evaluate<string>(
    `fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Demo film" }) }).then((r) => r.json()).then((j) => j.id)`,
  );
  await page.goto(`${base}/?p=${fresh}`);
  await page.waitForSelector("textarea", { timeout: 60_000 });
  await page.getByRole("button", { name: "en", exact: true }).click();
  await page.getByRole("button", { name: "papercut" }).click();
  const sink = new FrameSink(path.join(out, "live.mp4"));

  // A · typing, one frame per 4 characters (real-time pace at 30 fps)
  await shoot(page, sink, 24);
  await page.click("textarea");
  for (let i = 0; i < STORY.length; i += 4) {
    await page.keyboard.type(STORY.slice(i, i + 4));
    await shoot(page, sink);
  }
  await shoot(page, sink, 15);
  await page.getByRole("button", { name: /Make my film/ }).click();
  await shoot(page, sink, 15);
  const a = sink.count;

  // B · the run: the camera eases toward the shot grid while cards fill in
  const cam = new Camera(9);
  const t0 = Date.now();
  let lastPos = { grid: null as number | null, timeline: null as number | null, video: null as number | null, max: 0 };
  for (let i = 0; ; i++) {
    if (i % 10 === 0) lastPos = await page.evaluate(POSITIONS);
    if ((await page.locator("video").count()) > 0 || Date.now() - t0 > 20 * 60_000) break;
    const target = lastPos.grid !== null ? Math.min(lastPos.max, Math.max(0, lastPos.grid - 150)) : 0;
    await page.evaluate(`window.scrollTo(0, ${cam.step(target)})`);
    await shoot(page, sink);
  }
  const b = sink.count - a;

  // C · result tour at 1×: the crew timeline (models, tokens, cost), then back to the finished shots
  const tour = new Camera(7);
  tour.y = cam.y;
  lastPos = await page.evaluate(POSITIONS);
  const stops = [
    { y: lastPos.timeline !== null ? lastPos.timeline - 120 : lastPos.max, frames: 150 },
    { y: lastPos.grid !== null ? lastPos.grid - 150 : 0, frames: 150 },
  ];
  for (const s of stops) {
    const target = Math.min(lastPos.max, Math.max(0, s.y));
    for (let f = 0; f < s.frames; f++) {
      await page.evaluate(`window.scrollTo(0, ${tour.step(target)})`);
      await shoot(page, sink);
    }
  }
  const c = sink.count - a - b;
  await sink.close();
  await ctx.close();
  writeFileSync(path.join(out, "live.json"), JSON.stringify({ fps: FPS, a, b, c, projectId: fresh, runSeconds: Math.round((Date.now() - t0) / 1000) }, null, 2));
  console.log(`live: A ${a} · B ${b} · C ${c} frames, project ${fresh}`);
}

async function recordShowcase(browser: Browser, url: string, out: string) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
  const page = await ctx.newPage();
  await page.goto(url);
  await page.evaluate(`new Promise((r) => setTimeout(r, 2500))`);
  const max = (await page.evaluate<{ max: number }>(POSITIONS)).max;
  const sink = new FrameSink(path.join(out, "showcase.mp4"));
  const frames = 11 * FPS;
  const end = Math.min(max, 1400);
  for (let f = 0; f < frames; f++) {
    const t = f / (frames - 1);
    const e = t < 0.12 ? 0 : t > 0.88 ? 1 : (1 - Math.cos(Math.PI * ((t - 0.12) / 0.76))) / 2; // hold, ease in-out, hold
    await page.evaluate(`window.scrollTo(0, ${Math.round(e * end * 10) / 10})`);
    await shoot(page, sink);
  }
  await sink.close();
  await ctx.close();
  console.log(`showcase: ${frames} frames`);
}

async function main() {
  const base = arg("--base", "http://localhost:3100").replace(/\/+$/, "");
  const showcase = arg("--showcase", "https://studio-production-049c.up.railway.app/showcase");
  const out = arg("--out", "demo/video/_work");
  const only = arg("--only");
  mkdirSync(out, { recursive: true });
  const { chromium } = await loadPlaywright();
  const remote = (u: string) => !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(u);
  // Chromium ignores HTTPS_PROXY; pass it for remote hosts only (sandboxed recorders)
  const launch = async (u: string) => chromium.launch(process.env.HTTPS_PROXY && remote(u) ? { proxy: { server: process.env.HTTPS_PROXY } } : {});
  if (only !== "showcase") {
    const b = await launch(base);
    await recordLive(b, base, out);
    await b.close();
  }
  if (only !== "live") {
    const b = await launch(showcase);
    await recordShowcase(b, showcase, out);
    await b.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
