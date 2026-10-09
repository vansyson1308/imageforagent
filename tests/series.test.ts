import { afterAll, beforeAll, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { prisma } from "@/lib/db";
import { MockLlmProvider, type MockHandler } from "@/lib/providers/mockLlmProvider";
import { demoHandler, MOCK_MODELS } from "@/lib/services/director/demoCrew";
import { createRun, executeRun } from "@/lib/services/director/loop";
import { DEFAULT_BUDGET } from "@/lib/services/director/budget";
import { listSeries, loadSeries, lockSeriesCast, mergeLibraries, saveSeries, symbolHash } from "@/lib/services/director/series";
import { planSchema } from "@/lib/services/director/schemas";
import { POST as saveRoute, GET as listRoute } from "@/app/api/series/route";

// WP5 acceptance: the host stays pixel-identical across episodes (same symbol markup, by hash).

let storage: string;
const created: string[] = [];
beforeAll(async () => {
  storage = await fs.mkdtemp(path.join(os.tmpdir(), "series-"));
  process.env.STORAGE_ROOT = storage;
});
afterAll(async () => {
  await prisma.project.deleteMany({ where: { id: { in: created } } });
  await prisma.series.deleteMany({ where: { name: { startsWith: "Hidamari test" } } });
  await fs.rm(storage, { recursive: true, force: true });
});

const HOST = { age: "elder", skin: "#e9c09c", hairStyle: "bun", hairColor: "#d8d4cc", top: "kimono", topColor: "#7a8f6a", accent: "#c97d60", accessories: ["glasses"] };
const OTHER_HOST = { ...HOST, topColor: "#ff0000", hairStyle: "spiky" }; // what the Cast would draw if it were asked again
const GUEST = { age: "child", skin: "#f1c9a5", hairStyle: "ponytail", hairColor: "#2b1d16", top: "dress", topColor: "#e88aa0", accent: "#d9483b" };
const ROOM = `<symbol id="tearoom" viewBox="0 0 1920 1080"><rect width="1920" height="1080" fill="#e9d8b8"/>${Array.from({ length: 14 }, (_, i) => `<rect x="${i * 140}" y="${120 + (i % 3) * 30}" width="90" height="160" fill="#b88a5a"/>`).join("")}<rect y="760" width="1920" height="320" fill="#8a6a4a"/><circle cx="1500" cy="300" r="90" fill="#f4e4c0"/></symbol>`;

function crew(episode: 1 | 2): { handler: MockHandler; castPrompts: string[] } {
  const base = demoHandler({ criticScores: [9] });
  const castPrompts: string[] = [];
  const plan = (cast: object[], shots: object[]) => ({ title: `Hidamari test episode ${episode}`, logline: "L", palette: ["#e9d8b8", "#7a8f6a", "#c97d60"], cast, shots });
  const host = { id: "haru", name: "Haru-san", kind: "character", look: "an elderly woman host in a green kimono", colors: ["#7a8f6a"] };
  const room = { id: "tearoom", name: "Sabo Hidamari", kind: "set", look: "a warm tea room", colors: ["#e9d8b8"] };
  const guest = { id: "mii", name: "Mii", kind: "character", look: "a little girl in a pink dress", colors: ["#e88aa0"] };
  const shot = (cast: string[], dialogue: string | null, speaker: string | null, t: string) => ({ scene: "Tea room", shotType: t, description: "Haru-san welcomes the viewer in the tea room.", mode: "still", durationSec: 3, dialogue, speaker, transition: "cut", cast });
  const handler: MockHandler = (m, o, i) => {
    const role = m[0].content.split("\n")[0];
    if (role === "ROLE: DIRECTOR")
      return episode === 1
        ? plan([host, room], [shot(["haru", "tearoom"], "Welcome to Hidamari.", "Haru-san", "Wide shot"), shot(["haru", "tearoom"], null, null, "Close-up")])
        : plan([{ ...host, look: "REDESIGNED host (must be ignored)" }, guest], [shot(["haru", "tearoom"], "Welcome back.", "Haru-san", "Wide shot"), shot(["haru", "mii", "tearoom"], "Hello!", "Mii", "Medium shot")]);
    if (role === "ROLE: CAST") {
      castPrompts.push(m[1].content);
      return "```svg\n" + ROOM + "\n```\n```json\n" + JSON.stringify({ dolls: { haru: episode === 1 ? HOST : OTHER_HOST, mii: GUEST } }) + "\n```";
    }
    if (role === "ROLE: ARTIST") {
      const n = Number(m[1].content.match(/shot (\d+) of/)?.[1] ?? 1);
      const people = n === 2 && episode === 2 ? '<use href="#haru" x="300" y="200" width="560" height="840"/><use href="#mii" x="1100" y="380" width="420" height="630"/>' : n === 2 ? '<use href="#haru" x="600" y="0" width="900" height="1350"/>' : '<use href="#haru" x="700" y="320" width="480" height="720"/>';
      return '```svg\n<use href="#tearoom" x="0" y="0" width="1920" height="1080"/>' + people + "\n```";
    }
    return base(m, o, i);
  };
  return { handler, castPrompts };
}

async function episode(n: 1 | 2, seriesId: string | null) {
  const p = await prisma.project.create({ data: { name: `ep${n}` } });
  created.push(p.id);
  const { handler, castPrompts } = crew(n);
  const deps = { provider: new MockLlmProvider(handler), models: MOCK_MODELS, visionAvailable: true, modelNotes: [], tavily: null, ceiling: DEFAULT_BUDGET };
  const series = seriesId ? await loadSeries(seriesId, null, false) : null;
  const req = { projectId: p.id, story: "Haru-san welcomes the viewers to her tea room and tells today's story.", language: "en", style: "storybook", critic: true, research: false, maxShots: 2, series };
  const { runId, budget } = await createRun(req, deps);
  const summary = await executeRun(runId, req, deps, budget, () => {}, new AbortController().signal);
  const defs = (await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).artworkDefs ?? "";
  return { runId, summary, defs, castPrompts, projectId: p.id };
}

describe("series mode (WP5)", () => {
  it("episode 2 reuses the host verbatim (same symbol hash), draws only the guest, locks the Bible and keeps the host's voice", async () => {
    const ep1 = await episode(1, null);
    expect(ep1.summary.status).toBe("done");
    const saved = await saveSeries({ runId: ep1.runId, name: "Hidamari test", demoSession: null });
    expect(saved.members).toEqual(["haru", "tearoom"]);

    const ep2 = await episode(2, saved.id);
    expect(ep2.summary.status).toBe("done");
    expect(ep2.summary.rendered).toBe(2);
    // identity: the host's symbol and the set are byte-identical across episodes
    expect(symbolHash(ep2.defs, "haru")).toBe(symbolHash(ep1.defs, "haru"));
    expect(symbolHash(ep2.defs, "tearoom")).toBe(symbolHash(ep1.defs, "tearoom"));
    expect(symbolHash(ep1.defs, "haru")).toMatch(/^[0-9a-f]{64}$/);
    // the Cast was asked only for the new guest
    expect(ep2.castPrompts).toHaveLength(1);
    expect(ep2.castPrompts[0]).toContain("- mii (character");
    expect(ep2.castPrompts[0]).not.toContain("- haru (");
    // the episode could not redesign the host
    const bible = JSON.parse((await prisma.directorRun.findUniqueOrThrow({ where: { id: ep2.runId } })).bible!);
    expect(bible.cast.find((c: { id: string }) => c.id === "haru").look).toBe("an elderly woman host in a green kimono");
    // the host speaks with the same voice in both episodes
    const voice = async (runId: string) => (await prisma.directorStep.findMany({ where: { runId, action: "voice", shotIndex: 1 } }))[0]?.model;
    expect(await voice(ep2.runId)).toBe(await voice(ep1.runId));
    const steps = await prisma.directorStep.findMany({ where: { runId: ep2.runId, action: "series-cast" } });
    expect(steps[0].outputSummary).toMatch(/reused haru, tearoom verbatim .* drew new: mii/);
    expect((await prisma.directorRun.findUniqueOrThrow({ where: { id: ep2.runId } })).seriesId).toBe(saved.id);
  }, 240_000);

  it("pure helpers: lock, merge without id collisions, list", async () => {
    const s = { id: "s", name: "S", language: "en", style: "storybook", palette: ["#000000"], cast: [{ id: "haru", name: "Haru", kind: "character" as const, look: "LOCKED", colors: ["#111111"] }], library: '<linearGradient id="g"/><symbol id="haru" viewBox="0 0 400 600"><rect fill="url(#g)"/></symbol>', kits: new Map(), voices: {} };
    const plan = planSchema.parse({ title: "t", logline: "l", palette: ["#000000", "#111111", "#222222"], cast: [{ id: "mii", name: "Mii", kind: "character", look: "a little girl", colors: ["#333333"] }], shots: [{ scene: "a", shotType: "Wide shot", description: "Haru and Mii.", mode: "still", durationSec: 3, dialogue: null, speaker: null, transition: "cut", cast: ["haru", "mii"] }] });
    expect(lockSeriesCast(plan, s).cast.map((c) => [c.id, c.look])).toEqual([["mii", "a little girl"], ["haru", "LOCKED"]]);
    const merged = mergeLibraries(s.library, '<linearGradient id="g"/><symbol id="mii" viewBox="0 0 400 600"><rect fill="url(#g)"/></symbol>');
    expect(merged).toContain('<linearGradient id="g-ep"/><symbol id="mii" viewBox="0 0 400 600"><rect fill="url(#g-ep)"/>');
    expect(merged.startsWith(s.library)).toBe(true);
    expect((await listSeries(null, false)).some((x) => x.name === "Hidamari test")).toBe(true);
  });

  it("API: save needs a finished run; list is session-scoped in demo mode", async () => {
    const bad = await saveRoute(new Request("http://t", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId: "doesnotexist00", name: "x" }) }));
    expect(bad.status).toBe(404);
    const list = await (await listRoute(new Request("http://t"))).json();
    expect(Array.isArray(list.series)).toBe(true);
  });
});
