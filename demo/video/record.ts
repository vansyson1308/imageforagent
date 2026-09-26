/**
 * Screen-record the demo with Playwright `recordVideo` (1920×1080).
 *   npx tsx demo/video/record.ts --base https://<host> --passcode <p> [--out demo/video/_work]
 * Produces _work/live.webm (story → crew timeline → critic before/after →
 * film playing), _work/film.mp4 (the finished film, downloaded), _work/showcase.webm
 * and _work/markers.json (event times, seconds from the recording start).
 * Playwright is not a repo dependency: install it globally (`npm i -g playwright`)
 * or point PLAYWRIGHT_MODULE at it.
 */
import "../../scripts/director/env";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

interface Page {
  goto(url: string): Promise<unknown>;
  waitForSelector(sel: string, o?: { timeout?: number }): Promise<unknown>;
  fill(sel: string, v: string): Promise<void>;
  click(sel: string): Promise<void>;
  keyboard: { type(t: string, o?: { delay?: number }): Promise<void> };
  getByRole(role: string, o: { name: string | RegExp; exact?: boolean }): { click(): Promise<void>; count(): Promise<number> };
  locator(sel: string): { first(): { scrollIntoViewIfNeeded(): Promise<void>; count(): Promise<number> }; count(): Promise<number> };
  on(ev: "dialog", fn: (d: { accept(): Promise<void> }) => void): void;
  mouse: { wheel(x: number, y: number): Promise<void> };
  waitForTimeout(ms: number): Promise<void>;
  evaluate<T>(fn: string | (() => T)): Promise<T>;
  url(): string;
  video(): { path(): Promise<string> } | null;
  request: { get(url: string): Promise<{ ok(): boolean; body(): Promise<Buffer> }> };
}
interface Context {
  newPage(): Promise<Page>;
  close(): Promise<void>;
}
interface Browser {
  newContext(o: Record<string, unknown>): Promise<Context>;
  close(): Promise<void>;
}

const argv = process.argv.slice(2);
const arg = (k: string, d = "") => {
  const i = argv.indexOf(k);
  return i >= 0 ? (argv[i + 1] ?? d) : d;
};

const STORY =
  "Every evening, old Mrs. Tanaka lights a paper lantern in the window of her noodle shop so her son, a fisherman, can find the harbour. One stormy night the lantern blows out. The children of the street bring their own lanterns and line the pier with light. At dawn, the fishing boat comes home.";

async function loadPlaywright(): Promise<{ chromium: { launch(o?: Record<string, unknown>): Promise<Browser> } }> {
  const req = createRequire(import.meta.url);
  const candidates = [process.env.PLAYWRIGHT_MODULE, "playwright", "/opt/node22/lib/node_modules/playwright", "/usr/lib/node_modules/playwright", "/usr/local/lib/node_modules/playwright"].filter(Boolean) as string[];
  for (const c of candidates) {
    try {
      return req(c);
    } catch {
      // try next
    }
  }
  throw new Error("Playwright not found: npm i -g playwright (then npx playwright install chromium), or set PLAYWRIGHT_MODULE.");
}

async function main() {
  const base = arg("--base", "http://localhost:3000").replace(/\/+$/, "");
  const passcode = arg("--passcode") || process.env.DEMO_PASSCODE || "";
  const out = arg("--out", "demo/video/_work");
  const story = arg("--story", STORY);
  mkdirSync(out, { recursive: true });
  const { chromium } = await loadPlaywright();
  // Behind an egress proxy (CI sandboxes) Chromium needs it explicitly; normal machines have no HTTPS_PROXY
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(base);
  const browser = await chromium.launch(process.env.HTTPS_PROXY && !local ? { proxy: { server: process.env.HTTPS_PROXY } } : {});
  const t0 = Date.now();
  const markers: Record<string, number> = {};
  const mark = (k: string) => (markers[k] = (Date.now() - t0) / 1000);

  // ---- live run ----
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: out, size: { width: 1920, height: 1080 } } });
  const page = await ctx.newPage();
  page.on("dialog", (d) => void d.accept());
  await page.goto(`${base}/`);
  if (page.url().includes("/unlock")) {
    await page.fill("#passcode", passcode);
    await page.click("button[type=submit], form button");
    await page.waitForSelector("textarea", { timeout: 60_000 });
  }
  await page.waitForSelector("textarea", { timeout: 60_000 });
  // Always film a fresh project: the workspace otherwise opens the latest one (maybe mid-run)
  const fresh = await page.evaluate<string>(
    `fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Demo film" }) }).then((r) => r.json()).then((j) => j.id)`,
  );
  await page.goto(`${base}/?p=${fresh}`);
  await page.waitForSelector("textarea", { timeout: 60_000 });
  mark("ready");
  await page.getByRole("button", { name: "en", exact: true }).click();
  await page.click("textarea");
  await page.keyboard.type(story, { delay: 8 });
  await page.getByRole("button", { name: "papercut" }).click();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: /Make my film/ }).click();
  mark("start");
  // Follow the run: keep the newest content in view until the film player appears
  for (let i = 0; i < 1800; i++) {
    const hasVideo = (await page.locator("video").count()) > 0;
    const hasPlan = (await page.locator("text=Shots").count()) > 0;
    if (hasPlan && markers.plan === undefined) mark("plan");
    if ((await page.locator("text=→").count()) > 0 && markers.uplift === undefined) mark("uplift");
    if (hasVideo) break;
    await page.mouse.wheel(0, i % 20 < 10 ? 120 : -120);
    await page.waitForTimeout(1000);
  }
  mark("done");
  await page.locator("video").first().scrollIntoViewIfNeeded();
  await page.evaluate(`(() => { const v = document.querySelector("video"); if (v) { v.muted = true; v.play(); } })()`);
  await page.waitForTimeout(14_000);
  mark("end");
  const projectId = await page.evaluate<string>(`new URL(document.querySelector("video")?.src ?? location.href).pathname.split("/")[3] ?? ""`);
  const video = page.video();
  await ctx.close();
  if (video) renameSync(await video.path(), path.join(out, "live.webm"));
  if (projectId) {
    const res = await (await browser.newContext({})).newPage().then(async (p) => {
      if (passcode) {
        await p.goto(`${base}/unlock`);
        await p.fill("#passcode", passcode).catch(() => {});
        await p.click("form button").catch(() => {});
        await p.waitForTimeout(1500);
      }
      return p.request.get(`${base}/api/projects/${projectId}/film.mp4`);
    });
    if (res.ok()) writeFileSync(path.join(out, "film.mp4"), await res.body());
  }

  // ---- showcase ----
  const sctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: out, size: { width: 1920, height: 1080 } } });
  const sp = await sctx.newPage();
  await sp.goto(`${base}/showcase`);
  await sp.waitForTimeout(2500);
  for (let i = 0; i < 12; i++) {
    await sp.mouse.wheel(0, 90);
    await sp.waitForTimeout(700);
  }
  const sv = sp.video();
  await sctx.close();
  if (sv) renameSync(await sv.path(), path.join(out, "showcase.webm"));
  await browser.close();
  writeFileSync(path.join(out, "markers.json"), JSON.stringify({ base, projectId, markers }, null, 2));
  console.log("recorded", markers);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
