import { afterAll, beforeAll, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import sharp from "sharp";
import { prisma } from "@/lib/db";
import { MockLlmProvider } from "@/lib/providers/mockLlmProvider";
import { demoHandler, MOCK_MODELS } from "@/lib/services/director/demoCrew";
import { createRun, executeRun, registerRun, unregisterRun } from "@/lib/services/director/loop";
import { DEFAULT_BUDGET } from "@/lib/services/director/budget";
import { buildDoll, dollProportions, dollSchema, normalizeDollSpec } from "@/lib/services/director/dollKit";
import { buildSet, normalizeSetSpec, setSchema } from "@/lib/services/director/setKit";
import { LOGICAL_CANVAS, renderArtwork } from "@/lib/services/svgRenderer";
import { resolveStoragePath } from "@/lib/services/storage";
import { HARU, KISSATEN, VERANDA } from "../scripts/director/look-still";

/**
 * The Hidamari look (owner decision C, 2026-10-10): Haru-san and every guest
 * with adult proportions (the channel forbids chibi), a real cardigan, long
 * skirt, low bun, round tortoiseshell glasses, a navy apron; the Showa-era
 * kissaten 「ひだまり」 and its back veranda; 9:16 Shorts.
 */
const headShare = (spec: Parameters<typeof dollProportions>[0]) => {
  const f = dollProportions(spec);
  return (2 * f.headR) / (f.footY - (f.headY - f.headR));
};

describe("adult proportions (no chibi)", () => {
  it("an adult figure's head is about 1/6 of its height; the storybook figure keeps its big head", () => {
    for (const age of ["adult", "elder"] as const) {
      const base = { ...HARU, age };
      expect(headShare({ ...base, figure: "adult" }), age).toBeLessThan(1 / 5.8);
      expect(headShare({ ...base, figure: "storybook" }), age).toBeGreaterThan(1 / 5.2);
    }
    expect(dollSchema.parse({ ...HARU, figure: undefined }).figure).toBe("storybook");
  });

  it("Haru-san's kit spec: cardigan (not a jacket), long skirt, low bun, round glasses, navy apron, brown shoes", () => {
    const svg = buildDoll("haru", HARU);
    expect(HARU.top).toBe("cardigan");
    expect(svg).toContain(`fill="${HARU.apronColor}"`);
    expect(svg).toContain(`fill="${HARU.shoeColor}"`);
    expect(svg).toContain(`fill="${HARU.innerColor}"`);
    expect(svg).toMatch(/stroke="#6b3f22"/); // tortoiseshell rims
  });

  it("maps the Cast's words to the new options instead of the old ones", () => {
    const n = normalizeDollSpec({ top: "Cardigan", bottom: "long skirt", hairStyle: "low bun", accessories: ["tortoiseshell glasses", "apron"] }).spec as Record<string, unknown>;
    expect(n).toMatchObject({ top: "cardigan", bottom: "long-skirt", hairStyle: "low-bun", accessories: ["round-glasses", "apron"] });
    expect((normalizeDollSpec({ top: "knit" }).spec as { top: string }).top).toBe("cardigan");
  });
});

describe("the kissaten 「ひだまり」 and its back veranda", () => {
  it("normalises the Cast's words for them", () => {
    expect((normalizeSetSpec({ place: "cafe" }).spec as { place: string }).place).toBe("kissaten");
    expect((normalizeSetSpec({ place: "喫茶店" }).spec as { place: string }).place).toBe("kissaten");
    expect((normalizeSetSpec({ place: "縁側" }).spec as { place: string }).place).toBe("veranda");
    expect((normalizeSetSpec({ place: "kissaten", props: ["siphon coffee maker", "tube radio", "wall clock"] }).spec as { props: string[] }).props).toEqual(["siphon", "radio", "clock"]);
  });

  it("draws its built-in furniture (siphon, tube radio, clock, counter) at 16:9 and 9:16, deterministically", async () => {
    for (const ar of ["16:9", "9:16"] as const) {
      const c = LOGICAL_CANVAS[ar];
      const svg = buildSet("hidamari", KISSATEN, c);
      expect(svg, ar).toContain(`viewBox="0 0 ${c.w} ${c.h}"`);
      expect(svg, ar).toContain('fill="#dfeef5"'); // siphon glass
      expect(svg, ar).toContain('fill="#c9b48a"'); // radio grille cloth
      expect(svg, ar).toContain('fill="#fbf6ea"'); // clock face
      expect(svg).toBe(buildSet("hidamari", KISSATEN, c));
      const png = await renderArtwork(svg, `<use href="#hidamari" x="0" y="0" width="${c.w}" height="${c.h}"/>`, ar, "1K");
      const m = await sharp(png).metadata();
      expect((m.height ?? 0) > (m.width ?? 0)).toBe(ar === "9:16");
    }
  });

  it("the veranda at night has the moon, deck boards and a lit shoji", () => {
    const svg = buildSet("veranda", VERANDA, LOGICAL_CANVAS["16:9"]);
    expect(svg).toContain('fill="#f6f1d8"'); // the moon
    expect(svg).toContain('fill="#ffe2a8"'); // shoji lit from inside
    expect(setSchema.parse({ ...VERANDA, props: ["lantern"] }).props).toEqual(["lantern"]);
  });
});

// ---------- 9:16 Shorts, end to end with the scripted crew ----------

let storage: string;
const created: string[] = [];
beforeAll(async () => {
  storage = await fs.mkdtemp(path.join(os.tmpdir(), "hidamari-kit-test-"));
  process.env.STORAGE_ROOT = storage;
});
afterAll(async () => {
  await prisma.project.deleteMany({ where: { id: { in: created } } });
  await fs.rm(storage, { recursive: true, force: true });
});

describe("director loop: a 9:16 Short (mock crew)", () => {
  it("makes vertical frames and stores the project as 9:16", async () => {
    const p = await prisma.project.create({ data: { name: "shorts-test" } });
    created.push(p.id);
    const deps = { provider: new MockLlmProvider(demoHandler({ criticScores: [9] })), models: MOCK_MODELS, visionAvailable: true, modelNotes: [], tavily: null, ceiling: DEFAULT_BUDGET };
    const req = { projectId: p.id, story: "Haru opens the kissaten. A guest comes in. They drink tea.", language: "en", style: "storybook", critic: true, research: false, maxShots: 3, aspectRatio: "9:16" as const, figure: "adult" as const };
    const { runId, budget } = await createRun(req, deps);
    const ctrl = registerRun(runId);
    let summary;
    try {
      summary = await executeRun(runId, req, deps, budget, () => {}, ctrl.signal);
    } finally {
      unregisterRun(runId);
    }
    expect(summary.status).toBe("done");
    expect(summary.rendered).toBe(3);
    const project = await prisma.project.findUniqueOrThrow({ where: { id: p.id }, include: { frames: { orderBy: { index: "asc" } } } });
    expect(project.aspectRatio).toBe("9:16");
    for (const f of project.frames) {
      const m = await sharp(await fs.readFile(resolveStoragePath(f.imagePath!))).metadata();
      expect(m.height!, `frame ${f.index}`).toBeGreaterThan(m.width!);
    }
  }, 120_000);
});
