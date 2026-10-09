import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { renderArtwork } from "@/lib/services/svgRenderer";
import { buildCritter, buildDoll, critterSchema, dollSchema, EXPRESSIONS, POSES, variantId, type DrawPose } from "@/lib/services/director/dollKit";
import { actingBrief, actingLayer, actingSymbol, blinkTimes, kitPlacements, neededVariants, placementMap, speakerId, variantDefs, windowKeys } from "@/lib/services/director/acting";
import { buildShotMotion } from "@/lib/services/director/camera";
import { withoutUses } from "@/lib/services/director/svgTools";
import { motionSpecSchema } from "@/lib/validation/motionSchema";
import { evaluateMotionAt, frameCountOf, frameTime, prepareMotion } from "@/lib/services/motion/evaluate";
import { sanitizeSvg } from "@/lib/services/svgRenderer";
import { planSchema } from "@/lib/services/director/schemas";
import type { KitSpec } from "@/lib/services/director/cast";

const lan = dollSchema.parse({ age: "child", skin: "#f1c9a5", hairStyle: "bob", hairColor: "#2b1d16", top: "tshirt", topColor: "#e8b04a", bottom: "shorts", accent: "#d9483b", accessories: ["bow"] });
const fox = critterSchema.parse({ fur: "#d98a3a", belly: "#f6e7d0", ears: "pointy", tail: "bushy", muzzle: "pointed", accent: "#3a6ea5" });
const kits = new Map<string, KitSpec>([
  ["lan", { kind: "doll", spec: lan }],
  ["fox", { kind: "critter", spec: fox }],
]);
const canvas = { w: 1920, h: 1080 };

const plan = planSchema.parse({
  title: "T",
  logline: "L",
  palette: ["#111111", "#222222", "#333333"],
  cast: [
    { id: "lan", name: "Lan", kind: "character", look: "a girl", colors: ["#e8b04a"] },
    { id: "fox", name: "Fox", kind: "character", look: "a fox", colors: ["#d98a3a"] },
    { id: "park", name: "Park", kind: "set", look: "a park", colors: ["#7ccf7c"] },
  ],
  shots: [
    { scene: "A", shotType: "Wide shot", description: "Lan walks into the park.", mode: "motion", durationSec: 4, dialogue: null, speaker: null, transition: "cut", cast: ["lan", "park"], acting: [{ who: "lan", pose: "walk", expression: "smile" }] },
    { scene: "A", shotType: "Medium shot", description: "Lan waves at the fox.", mode: "still", durationSec: 3, dialogue: "Hello!", speaker: "Lan", transition: "cut", cast: ["lan", "fox", "park"], acting: [{ who: "lan", pose: "wave", expression: "laugh" }, { who: "fox", pose: "sit", expression: "surprised" }] },
  ],
});

describe("acting kit", () => {
  it("every pose × expression is a valid, sanitizer-clean symbol for both kits, deterministic", () => {
    const poses: DrawPose[] = [...POSES.filter((p) => p !== "walk"), "walk_a", "walk_b"];
    for (const pose of poses)
      for (const expression of EXPRESSIONS) {
        const a = buildDoll("lan", lan, { pose, expression });
        expect(buildDoll("lan", lan, { pose, expression })).toBe(a);
        expect(a).toContain(`<symbol id="${variantId("lan", pose, expression)}" viewBox="0 0 400 600">`);
        expect(() => sanitizeSvg(a, "defs")).not.toThrow();
        const c = buildCritter("fox", fox, { pose, expression });
        expect(() => sanitizeSvg(c, "defs")).not.toThrow();
      }
    expect(variantId("lan")).toBe("lan");
    expect(variantId("lan", "wave", "smile")).toBe("lan--wave-smile");
  });

  it("identity is kept across poses: the head renders pixel-identical when the pose doesn't move it", async () => {
    const defs = [buildDoll("lan", lan), ...(["wave", "point", "hold", "hug"] as const).map((p) => buildDoll("lan", lan, { pose: p, withGradient: false }))].join("\n");
    const head = async (sym: string) => {
      const png = await renderArtwork(defs, `<rect width="1920" height="1080" fill="#ffffff"/><use href="#${sym}" x="660" y="0" width="600" height="900"/>`, "16:9", "1K");
      // the head region of a 600×900 placement at x=660: viewBox head ≈ x 120–280, y 40–220 → canvas
      const left = Math.round(((660 + 130 * 1.5) / 1920) * 1024);
      const top = Math.round(((40 * 1.5) / 1080) * 576);
      return sharp(png).extract({ left, top, width: Math.round((140 * 1.5 * 1024) / 1920), height: Math.round((150 * 1.5 * 576) / 1080) }).raw().toBuffer();
    };
    const base = await head("lan");
    for (const p of ["wave", "point", "hold", "hug"]) expect((await head(`lan--${p}-neutral`)).equals(base), p).toBe(true);
  });

  it("the plan asks for exactly the variants it uses; the Artist is told which symbol to place", () => {
    const v = neededVariants(plan, kits).map((x) => variantId(x.who, x.pose, x.expression));
    expect(v).toEqual(["lan--walk_a-smile", "lan--walk_b-smile", "lan--wave-laugh", "fox--sit-surprised"]);
    expect(actingSymbol(plan.shots[1], "lan", kits)).toBe("lan--wave-laugh");
    expect(actingSymbol(plan.shots[1], "park", kits)).toBe("park");
    expect(actingBrief(plan.shots[0], kits)).toMatch(/#lan--walk_a-smile.*engine animates the walk/);
    const defs = variantDefs(plan, kits, buildDoll("lan", lan) + buildCritter("fox", fox));
    expect(defs).not.toMatch(/id="lan-skin"/); // variants reuse the base gradient
    expect(defs.match(/<symbol /g)).toHaveLength(4);
    expect(speakerId(plan, plan.shots[1])).toBe("lan");
    expect(speakerId(plan, plan.shots[0])).toBeNull();
  });

  it("gates treat a posed variant as the character (withoutUses strips variants)", () => {
    const svg = '<use href="#park" x="0" y="0" width="1920" height="1080"/><use href="#lan--wave-laugh" x="10" y="20" width="400" height="600"/><use href="#lantern" x="1" y="1" width="9" height="9"/>';
    expect(withoutUses(svg, "lan")).toBe('<use href="#park" x="0" y="0" width="1920" height="1080"/><use href="#lantern" x="1" y="1" width="9" height="9"/>');
    expect(withoutUses(svg, "lan")).not.toContain("lantern\" x=\"1\" y=\"1\" width=\"9\" height=\"9\"/><use href=\"#lan--");
  });
});

describe("acting layer", () => {
  const painting = '<use href="#park" x="0" y="0" width="1920" height="1080"/><use href="#lan--wave-smile" x="400" y="300" width="400" height="600"/><g transform="translate(1900 0) scale(-1 1)"><use href="#fox" x="0" y="500" width="300" height="450"/></g>';

  it("finds plain top-level kit placements only (a transformed fox is left alone)", () => {
    const p = kitPlacements(painting, kits);
    expect(p.map((x) => [x.who, x.pose, x.expression])).toEqual([["lan", "wave", "smile"]]);
    expect(placementMap(p[0])).toEqual({ s: 1, ox: 400, oy: 300 });
  });

  it("blinks: seeded, 2 frames each, valid motion spec that rides the camera", () => {
    expect(blinkTimes(6, "3:lan")).toEqual(blinkTimes(6, "3:lan"));
    expect(blinkTimes(6, "3:lan")).not.toEqual(blinkTimes(6, "4:lan"));
    const out = actingLayer({ index: 2, svg: painting, kits, duration: 6, fps: 12, canvas });
    expect(out.summary[0]).toMatch(/^lan blinks \d+×$/);
    const motion = motionSpecSchema.parse(buildShotMotion({ index: 2, shotType: "Medium shot", duration: 6, fps: 12, canvas, background: "#000000", ambient: out.layer }));
    const prep = prepareMotion(motion);
    const lidScale = (i: number) => {
      const scene = evaluateMotionAt(prep, frameTime(motion, i)) as { shapes: Array<{ id: string; scale: number }> };
      return scene.shapes.find((s) => s.id === "act2-lan-lid0")!.scale;
    };
    const shown = Array.from({ length: frameCountOf(motion) }, (_, i) => lidScale(i) > 0.5);
    const times = blinkTimes(6, "2:lan");
    expect(shown.filter(Boolean).length).toBe(times.length * 2);
  });

  it("lip-sync: the speaker's mouth follows the measured envelope, nobody else's", () => {
    const open = [0, 0.4, 0.9, 0.7, 0.2, 0, 0.5, 1, 0.3, 0];
    const out = actingLayer({ index: 1, svg: painting, kits, duration: 3, fps: 12, canvas, lip: { who: "lan", open, fps: 12, offset: 0.3 } });
    const track = out.layer.tracks.find((t) => t.target === "shapes.act1-lan-mouth.scale")!;
    expect(track.keys.length).toBeGreaterThan(open.length - 2);
    const ys = track.keys.map((k) => (k.v as number[])[1]);
    expect(Math.max(...ys)).toBe(1);
    expect(ys[0]).toBeLessThan(0.01);
    const none = actingLayer({ index: 1, svg: painting, kits, duration: 3, fps: 12, canvas, lip: { who: "fox", open, fps: 12, offset: 0 } });
    expect(none.layer.tracks.some((t) => t.target.includes("mouth"))).toBe(false);
    motionSpecSchema.parse(buildShotMotion({ index: 1, shotType: "Close-up", duration: 3, fps: 12, canvas, background: "#000000", ambient: out.layer }));
  });

  it("walk: no-slip by construction: the planted foot of each step is exactly the back foot of the next", () => {
    const svg = '<use href="#park" x="0" y="0" width="1920" height="1080"/><use href="#lan--walk_a-smile" x="200" y="400" width="400" height="600"/>';
    const out = actingLayer({ index: 5, svg, kits, duration: 4, fps: 12, canvas });
    expect(out.svg).not.toContain("lan--walk"); // the walker left the painting
    const w = out.walks[0];
    expect(w.direction).toBe(1);
    expect(w.steps).toBeGreaterThan(3);
    // foot x of a stride frame in its viewBox, from the kit's own markup (shoe ellipses)
    const feet = (pose: "walk_a" | "walk_b") => [...buildDoll("lan", lan, { pose }).matchAll(/<ellipse cx="([\d.]+)" cy="[\d.]+" rx="[\d.]+" ry="11" fill="#2b2530"\/>/g)].map((m) => Number(m[1]) - 4).sort((a, b) => a - b);
    const [aBack, aFront] = feet("walk_a");
    const [bBack, bFront] = feet("walk_b");
    const xOf = (k: number) => Number(w.patterns[k].match(/<use href="#[^"]+" x="([-\d.]+)"/)![1]);
    const { s } = placementMap({ x: 0, y: 0, w: 400, h: 600 });
    for (let k = 0; k < w.steps; k++) {
      const [plantedFront, nextBack] = k % 2 === 0 ? [xOf(k) + aFront * s, xOf(k + 1) + bBack * s] : [xOf(k) + bFront * s, xOf(k + 1) + aBack * s];
      expect(Math.abs(plantedFront - nextBack)).toBeLessThan(0.15);
    }
    const motion = motionSpecSchema.parse(buildShotMotion({ index: 5, shotType: "Wide shot", duration: 4, fps: 12, canvas, background: "#000000", ambient: out.layer }));
    // exactly one walker layer visible on every frame
    const prep = prepareMotion(motion);
    for (let i = 0; i < frameCountOf(motion); i++) {
      const scene = evaluateMotionAt(prep, frameTime(motion, i)) as { shapes: Array<{ id: string; scale: number }> };
      expect(scene.shapes.filter((x) => x.id.startsWith("act5-lan-s") && x.scale > 0.5)).toHaveLength(1);
    }
  });

  it("visibility windows are exact", () => {
    expect(windowKeys(0, 1, 4).map((k) => [k.t, k.v])).toEqual([[0, 1], [0.999, 1], [1, 0.001], [4, 0.001]]);
    expect(windowKeys(1, 4, 4).map((k) => [k.t, k.v])).toEqual([[0, 0.001], [0.999, 0.001], [1, 1], [4, 1]]);
  });
});

// ---------- e2e: the scripted crew through the real loop (DB + real renders, no network) ----------
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { afterAll, beforeAll } from "vitest";
import { prisma } from "@/lib/db";
import { MockLlmProvider, type MockHandler } from "@/lib/providers/mockLlmProvider";
import { demoHandler, MOCK_MODELS } from "@/lib/services/director/demoCrew";
import { createRun, executeRun } from "@/lib/services/director/loop";
import { DEFAULT_BUDGET } from "@/lib/services/director/budget";
import { resolveStoragePath } from "@/lib/services/storage";

describe("acting end to end (mock crew)", () => {
  let storage: string;
  const created: string[] = [];
  beforeAll(async () => {
    storage = await fs.mkdtemp(path.join(os.tmpdir(), "acting-e2e-"));
    process.env.STORAGE_ROOT = storage;
  });
  afterAll(async () => {
    await prisma.project.deleteMany({ where: { id: { in: created } } });
    await fs.rm(storage, { recursive: true, force: true });
  });

  it("the Cast's kit characters are posed per shot, walk across a clip, blink and lip-sync", async () => {
    const base = demoHandler({ criticScores: [9] });
    const SET = `<symbol id="park" viewBox="0 0 1920 1080"><rect width="1920" height="1080" fill="#9fd3f0"/>${Array.from({ length: 16 }, (_, i) => `<circle cx="${i * 130 + 40}" cy="${200 + (i % 3) * 60}" r="${30 + (i % 4) * 8}" fill="#ffffff"/>`).join("")}<rect y="760" width="1920" height="320" fill="#7ccf7c"/>${Array.from({ length: 10 }, (_, i) => `<rect x="${i * 200 + 60}" y="520" width="26" height="250" fill="#6b4a2b"/><circle cx="${i * 200 + 73}" cy="500" r="70" fill="#3f8f4f"/>`).join("")}</symbol>`;
    const handler: MockHandler = (m, o, i) => {
      const role = m[0].content.split("\n")[0];
      if (role === "ROLE: DIRECTOR") return plan;
      if (role === "ROLE: CAST") return "```svg\n" + SET + "\n```\n```json\n" + JSON.stringify({ dolls: { lan: lan }, critters: { fox: fox } }) + "\n```";
      if (role === "ROLE: ARTIST") {
        const shot = Number(m[1].content.match(/shot (\d+) of/)?.[1] ?? 1);
        return shot === 1
          ? '```svg\n<use href="#park" x="0" y="0" width="1920" height="1080"/><use href="#lan--walk_a-smile" x="200" y="380" width="420" height="630"/>\n```\n```json\n{"shapes":[],"tracks":[]}\n```'
          : '```svg\n<use href="#park" x="0" y="0" width="1920" height="1080"/><use href="#lan--wave-laugh" x="1100" y="200" width="560" height="840"/><use href="#fox--sit-surprised" x="300" y="420" width="380" height="570"/>\n```';
      }
      return base(m, o, i);
    };
    const p = await prisma.project.create({ data: { name: "acting-e2e" } });
    created.push(p.id);
    const deps = { provider: new MockLlmProvider(handler), models: MOCK_MODELS, visionAvailable: true, modelNotes: [], tavily: null, ceiling: DEFAULT_BUDGET };
    const req = { projectId: p.id, story: "Lan walks into the park and waves at a fox.", language: "en", style: "storybook", critic: true, research: false, maxShots: 2 };
    const { runId, budget } = await createRun(req, deps);
    const summary = await executeRun(runId, req, deps, budget, () => {}, new AbortController().signal);
    expect(summary.status).toBe("done");
    expect(summary.rendered).toBe(2);
    const steps = await prisma.directorStep.findMany({ where: { runId }, orderBy: { seq: "asc" } });
    expect(steps.find((s) => s.action === "acting-variants")?.outputSummary).toMatch(/lan walk_a\/smile, lan walk_b\/smile, lan wave\/laugh, fox sit\/surprised/);
    const renders = steps.filter((s) => s.action === "render-clip").map((s) => s.outputSummary ?? "");
    expect(renders.some((r) => /acting: lan walks \d+ steps right/.test(r))).toBe(true);
    // shot 2: Lan laughs (eyes closed, so no blink) and speaks her line; the fox blinks
    expect(renders.some((r) => /acting: lan lip-sync [\d.]+ s, fox blinks \d+×/.test(r))).toBe(true);
    // the walk is visible in the rendered clip: the walker's position differs between the first and last frame
    const f1 = (await prisma.frame.findMany({ where: { projectId: p.id }, orderBy: { index: "asc" } }))[0];
    const files = (await fs.readdir(resolveStoragePath(f1.clipDir!))).filter((f) => f.endsWith(".png")).sort();
    const first = await sharp(path.join(resolveStoragePath(f1.clipDir!), files[0])).raw().toBuffer();
    const last = await sharp(path.join(resolveStoragePath(f1.clipDir!), files.at(-1)!)).raw().toBuffer();
    expect(first.equals(last)).toBe(false);
  }, 180_000);
});
