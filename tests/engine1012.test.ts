import { afterAll, beforeAll, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import sharp from "sharp";
import { prisma } from "@/lib/db";
import { MockLlmProvider, type MockHandler } from "@/lib/providers/mockLlmProvider";
import { DEMO_LIBRARY, demoHandler, demoPlan, MOCK_MODELS } from "@/lib/services/director/demoCrew";
import { createRun, executeRun, registerRun, unregisterRun } from "@/lib/services/director/loop";
import { DEFAULT_BUDGET } from "@/lib/services/director/budget";
import { critiqueSchema, planSchema, type Plan } from "@/lib/services/director/schemas";
import { bucketsNamed, enforceFidelity, fidelityBrief, offPlanAxes, plannedBucket, withinBucket } from "@/lib/services/director/fidelity";
import { normalizePlan, propStateOf, restateProps, stateAliases, stateMembers } from "@/lib/services/director/plan";
import { airborneProps, attachHeldProps, tetherAirborne } from "@/lib/services/director/acting";
import { buildDoll, dollFace, dollSchema } from "@/lib/services/director/dollKit";
import { validateDrawing } from "@/lib/services/director/artist";
import { artistUser } from "@/lib/services/director/prompts";
import { extractSvgFragment, unwrapSvg } from "@/lib/services/director/svgTools";
import { measuredProblems } from "@/lib/services/director/publishGate";
import { heroSymbols, MAX_REDRAWS } from "@/lib/services/director/recognize";
import { renderArtwork, sanitizeSvg } from "@/lib/services/svgRenderer";
import type { KitSpec } from "@/lib/services/director/cast";

/** Owner decisions and the engine PR of 2026-10-12 (D71, D72). */

const canvas = { w: 1920, h: 1080 };
const kiteTake2 = JSON.parse(readFileSync("docs/hackathon/evidence/reshoot-2026-10-12/v2-kite-take2-trace.json", "utf8")) as { steps: Array<{ action: string; shotIndex: number | null; output: string | null }> };
const verdicts = (shot: number) => kiteTake2.steps.filter((s) => s.action === "score" && s.shotIndex === shot).map((s) => critiqueSchema.parse(JSON.parse(s.output!)));

describe("1 · time of day in buckets (D71): morning vs afternoon is not off-plan", () => {
  it("kite take 2, shot 2: “late afternoon, not morning” is one bucket → on-plan; shot 8: “sunset, not afternoon” is two → still off-plan", () => {
    const [s2] = verdicts(2);
    expect(s2.fidelity?.note).toBe("brightness indicates late afternoon, not morning");
    expect(offPlanAxes(s2)).toEqual(["time"]);
    expect(offPlanAxes(enforceFidelity(s2))).toEqual([]);
    expect(enforceFidelity(s2).fidelity?.note).toMatch(/same time-of-day bucket: not off-plan, D71/);
    const [s8] = verdicts(8);
    expect(s8.fidelity?.note).toBe("Sun position suggests sunset, not afternoon");
    expect(offPlanAxes(enforceFidelity(s8))).toEqual(["time"]);
  });

  it("a note that names one time only, or two buckets, keeps the verdict", () => {
    const v = (note: string) => critiqueSchema.parse({ score: 8, verdict: "accept", issues: [], fixes: [], fidelity: { time: "wrong", place: "ok", action: "ok", note } });
    for (const note of ["Night lighting and setting not clearly depicted; action not evident.", "Scene should be evening but lighting reads as daytime", "dusk lighting contradicts daytime plan", "The scene is rendered as daytime despite the story specifying a night scene (đêm giao thừa)."]) {
      expect(withinBucket(v(note)).fidelity?.time, note).toBe("wrong");
    }
    for (const note of ["reads as noon, the plan says morning", "golden hour light, but the plan says afternoon", "plan: buổi sáng; render: buổi chiều"]) expect(withinBucket(v(note)).fidelity?.time, note).toBe("ok");
    expect([...bucketsNamed("sunset, not afternoon")].sort()).toEqual(["day", "dusk"]);
  });

  it("the critic's brief states the planned bucket and the set's bucket (a golden set is the DAY bucket)", () => {
    const p = planSchema.parse(demoPlan("One. Two.", 2));
    const shot = { ...p.shots[0], scene: "Beach", description: "Morning on the beach, Maya runs with her kite." };
    expect(plannedBucket(shot)).toBe("day");
    expect(plannedBucket({ ...shot, description: "Sunset on the beach." })).toBe("dusk");
    const brief = fidelityBrief(p, { ...shot, cast: [...shot.cast] }, new Map([["home", "golden"]]));
    expect(brief).toMatch(/the DAY bucket \(dawn to golden late afternoon\)/);
    expect(brief).toMatch(/#home is lit for golden \(the DAY bucket/);
  });
});

// ---------- prop states ----------

function kitePlan(): Plan {
  const p = planSchema.parse(demoPlan("Maya flies a kite. The wind tears it. Grandpa mends it. It flies again.", 4));
  const kite = {
    id: "kite",
    name: "Red kite",
    kind: "prop" as const,
    look: "a red diamond kite with a cross spar and a ribbon tail",
    colors: ["#d9603b", "#7a2a12"],
    airborne: true,
    states: [
      { id: "intact", look: "whole, taut sail" },
      { id: "torn", look: "a long rip from corner to corner, the sail flapping loose" },
      { id: "mended", look: "the rip stitched with white thread and a gold star patch" },
    ],
  };
  return planSchema.parse({
    ...p,
    cast: [...p.cast, kite],
    shots: [
      { ...p.shots[0], cast: [...p.shots[0].cast, "kite"] },
      { ...p.shots[1], cast: [...p.shots[1].cast, "kite"], propStates: [{ prop: "kite", state: "torn" }] },
      { ...p.shots[2], cast: [...p.shots[2].cast, "kite"] },
      { ...p.shots[3], cast: [...p.shots[3].cast, "kite"], propStates: [{ prop: "kite", state: "mended" }, { prop: "kite", state: "nonsense" as "torn" }] },
    ],
  });
}

describe("B · prop states: the plan declares them, the Cast draws one per state, each shot uses its state's symbol", () => {
  it("normalises: every shot showing the kite gets a state — named, else the one it was last seen in, else the first", () => {
    const plan = normalizePlan(kitePlan(), 24);
    expect(plan.shots.map((s) => propStateOf(s).get("kite"))).toEqual(["intact", "torn", "torn", "mended"]);
    // a state on a character or a set, or a single state, is dropped
    const p = planSchema.parse(demoPlan("A. B.", 2));
    const odd = normalizePlan({ ...p, cast: p.cast.map((c) => ({ ...c, states: [{ id: "one", look: "x x x" }, { id: "two", look: "y y y" }] })) }, 24);
    expect(odd.cast.every((c) => !c.states)).toBe(true);
  });

  it("the Cast is asked for one symbol per later state from the same base; the first state places the base", () => {
    const plan = normalizePlan(kitePlan(), 24);
    expect(stateMembers(plan).map((m) => m.id)).toEqual(["kite--torn", "kite--mended"]);
    expect(stateMembers(plan)[0].look).toMatch(/The SAME object as #kite .* state "torn": a long rip/);
    const defs = '<symbol id="kite" viewBox="0 0 400 400"><path d="M0 0"/></symbol><symbol id="kite--torn" viewBox="0 0 400 400"><path d="M1 1"/></symbol>';
    const a = stateAliases(plan, defs);
    expect(a.map((x) => [x.id, x.first])).toEqual([["kite--intact", true], ["kite--mended", false]]);
    expect(a[0].symbol).toBe('<symbol id="kite--intact" viewBox="0 0 400 400"><use href="#kite" x="0" y="0" width="400" height="400"/></symbol>');
  });

  it("a shot planned TORN gets the torn symbol (whatever the Artist wrote), in a plain placement and in the hands", async () => {
    const plan = normalizePlan(kitePlan(), 24);
    const torn = plan.shots[1];
    expect(restateProps('<use href="#kite" x="1" y="2" width="3" height="3"/><use xlink:href="#kite--intact"/>', torn)).toBe('<use href="#kite--torn" x="1" y="2" width="3" height="3"/><use xlink:href="#kite--torn"/>');
    // the Artist is told which symbol to use and why
    expect(artistUser({ plan, shot: torn, index: 2, symbols: ["kite", "kite--torn"], canvas })).toMatch(/KEY OBJECT STATE[\s\S]*#kite is TORN in this shot: place <use href="#kite--torn"/);
    // the engine puts the planned state in a holder's hands
    const spec = dollSchema.parse({ age: "child", skin: "#f1c9a5", hairStyle: "bob", hairColor: "#2b1d16", top: "tshirt", topColor: "#e8b04a", bottom: "shorts", accent: "#d9483b" });
    const kits: ReadonlyMap<string, KitSpec> = new Map([["kid", { kind: "doll", spec }]]);
    const held = attachHeldProps('<use href="#kid--hold-sad" x="700" y="200" width="533" height="800"/><use href="#kite" x="0" y="0" width="100" height="100"/>', { ...torn, cast: ["kid", "kite"] }, kits, ["kite"]);
    expect(held.svg).toMatch(/<use href="#kite--torn" x="\d+" y="\d+"/);
    expect(held.svg).not.toMatch(/href="#kite"/);
    expect(held.held).toEqual(["kite"]);
  });

  it("the critic's brief names the key object's planned state", () => {
    const plan = normalizePlan(kitePlan(), 24);
    expect(fidelityBrief(plan, plan.shots[1], new Map())).toMatch(/Key object: #kite must show its state "torn": a long rip/);
  });
});

// ---------- C · the kite string ----------

describe("C · an airborne kite hangs on a string from its holder's hand, drawn by the engine", () => {
  const spec = dollSchema.parse({ age: "child", skin: "#f1c9a5", hairStyle: "ponytail", hairColor: "#5a3a22", top: "tshirt", topColor: "#f2c14e", bottom: "pants", bottomColor: "#3d6fa8", accent: "#d9483b" });
  const kits: ReadonlyMap<string, KitSpec> = new Map([["maya", { kind: "doll", spec }]]);
  const KITE = `<symbol id="kite" viewBox="0 0 400 400"><path d="M200 20 L380 200 L200 380 L20 200 Z" fill="#d9603b"/><path d="M200 20 L200 380 M20 200 L380 200" stroke="#7a2a12" stroke-width="10"/><path d="M200 380 Q240 420 200 460" stroke="#7a2a12" stroke-width="6" fill="none"/></symbol>`;
  const SKY = `<symbol id="beach" viewBox="0 0 1920 1080"><rect width="1920" height="1080" fill="#9fd3f0"/><rect y="760" width="1920" height="320" fill="#ecd9a8"/></symbol>`;
  const p = planSchema.parse(demoPlan("A. B.", 2));
  const shot = { ...p.shots[0], cast: ["maya", "kite", "beach"], acting: [{ who: "maya", pose: "point" as const, expression: "smile" as const }] };

  it("finds airborne props by flag or by name, unless flagged false", () => {
    expect(airborneProps([{ id: "kite", name: "Red kite", kind: "prop" }, { id: "x", name: "Balloon", kind: "prop" }, { id: "y", name: "Kite", kind: "prop", airborne: false }, { id: "z", name: "Lantern", kind: "prop", airborne: true }, { id: "w", name: "Kite", kind: "character" }])).toEqual(["kite", "x", "z"]);
  });

  it("draws the string from the pointing hand to the kite's centre, before the kite; none for a kite on the ground; rendered for a look", async () => {
    const maya = '<use href="#maya--point-smile" x="300" y="300" width="400" height="600"/>';
    const flying = '<use href="#kite" x="1150" y="80" width="260" height="260"/>';
    const out = tetherAirborne(`<use href="#beach" x="0" y="0" width="1920" height="1080"/>${maya}${flying}`, shot, kits, ["kite"], canvas);
    const m = out.svg.match(/<path data-tether="kite" d="M([\d.]+) ([\d.]+) Q[\d. ]+ ([\d.]+) ([\d.]+)"/);
    expect(m).toBeTruthy();
    const hand = dollFace(spec, "point", "smile").hand;
    const s = Math.min(400 / 400, 600 / 600);
    expect(Number(m![1])).toBeCloseTo(300 + hand.x * s, 0);
    expect(Number(m![2])).toBeCloseTo(300 + hand.y * s, 0);
    expect([Number(m![3]), Number(m![4])]).toEqual([1280, 210]);
    expect(out.svg.indexOf("data-tether")).toBeLessThan(out.svg.indexOf('href="#kite"'));
    expect(out.notes[0]).toMatch(/string drawn from #maya's hand to #kite/);
    // again on its own output: the old string is replaced, not doubled
    expect(tetherAirborne(out.svg, shot, kits, ["kite"], canvas).svg.match(/data-tether/g)).toHaveLength(1);
    // a kite lying on the sand has no string
    expect(tetherAirborne(`${maya}<use href="#kite" x="900" y="800" width="200" height="200"/>`, shot, kits, ["kite"], canvas).svg).not.toMatch(/data-tether/);
    // the render, for the reviewer's eyes (owner: "render check by eye")
    const defs = SKY + KITE + buildDoll("maya", spec, { pose: "point", expression: "smile" });
    sanitizeSvg(out.svg, "frame");
    const png = await renderArtwork(defs, out.svg, "16:9", "1K");
    expect((await sharp(png).metadata()).width).toBe(1024);
    if (process.env.TETHER_PNG) {
      mkdirSync(path.dirname(process.env.TETHER_PNG), { recursive: true });
      writeFileSync(process.env.TETHER_PNG, png);
    }
  });

  it("validateDrawing ties the string on the final layout", async () => {
    const defs = SKY + KITE + buildDoll("maya", spec) + buildDoll("maya", spec, { pose: "point", expression: "smile" });
    const d = await validateDrawing(
      "```svg\n<use href=\"#beach\" x=\"0\" y=\"0\" width=\"1920\" height=\"1080\"/><use href=\"#maya--point-smile\" x=\"300\" y=\"300\" width=\"400\" height=\"600\"/><use href=\"#kite\" x=\"1150\" y=\"80\" width=\"260\" height=\"260\"/>\n```",
      { castDefs: defs, symbols: ["beach", "kite", "maya", "maya--point-smile"], aspectRatio: "16:9", shot: { ...shot, shotType: "Wide shot", mode: "still" }, index: 1, canvas, fps: 12, characters: ["maya"], sets: ["beach"], props: ["kite"], kits, strict: false, airborne: ["kite"] },
    );
    expect(d.svg).toMatch(/data-tether="kite"/);
    expect(d.checks?.facts.join(" ")).toMatch(/string drawn from #maya's hand to #kite/);
  });
});

// ---------- D3 · a stray <svg> root is unwrapped, never a lost shot ----------

describe("D · an <svg> root or nested <svg> viewport is unwrapped, then sanitized as usual", () => {
  it("unwraps an outer root (its viewBox mapped onto the canvas) and turns a nested viewport into a <g transform>", () => {
    expect(unwrapSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080"><use href="#a"/></svg>', canvas)).toBe('<use href="#a"/>');
    expect(unwrapSvg('<svg viewBox="0 0 960 540"><use href="#a"/></svg>', canvas)).toBe('<g transform="translate(0 0) scale(2)"><use href="#a"/></g>');
    expect(unwrapSvg('<use href="#set"/><svg x="600" y="100" width="700" height="700" viewBox="0 0 400 400"><use href="#kite"/></svg><use href="#kid"/>', canvas)).toBe('<use href="#set"/><g transform="translate(600 100) scale(1.75)"><use href="#kite"/></g><use href="#kid"/>');
    // an unclosed root (a cut-off reply) and a lone closing tag
    expect(unwrapSvg('<svg viewBox="0 0 1920 1080"><use href="#a"/>', canvas)).toBe('<use href="#a"/>');
    expect(extractSvgFragment("```svg\n<use href=\"#a\"/></svg>\n```", canvas)).toBe('<use href="#a"/>');
  });

  it("whatever was inside is still sanitized: a script or an external reference in a nested viewport is rejected", () => {
    for (const bad of ['<svg x="0" y="0" width="10" height="10"><script>alert(1)</script></svg>', '<svg viewBox="0 0 10 10"><image href="https://evil.example/x.png"/></svg>', '<use href="#a"/><svg x="1" y="1" width="9" height="9"><rect onclick="x()"/></svg>']) {
      expect(() => sanitizeSvg(extractSvgFragment("```svg\n" + bad + "\n```", canvas), "frame"), bad).toThrow();
    }
    // the <svg> tags' own attributes are never copied (only the transform we compute): a handler on them is gone
    const out = extractSvgFragment('```svg\n<svg><svg onload="alert(1)" x="5" y="5"><rect width="1" height="1"/></svg></svg>\n```', canvas);
    expect(out).toBe('<g transform="translate(5 5)"><rect width="1" height="1"/></g>');
    expect(() => sanitizeSvg(out, "frame")).not.toThrow();
  });

  it("validateDrawing keeps a frame the Artist wrapped in <svg> (fūrin take 2 lost shot 8 to this)", async () => {
    const d = await validateDrawing('```svg\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080"><use href="#home" x="0" y="0" width="1920" height="1080"/><svg x="500" y="300" width="400" height="600" viewBox="0 0 400 600"><use href="#hero" x="0" y="0" width="400" height="600"/></svg></svg>\n```', {
      castDefs: DEMO_LIBRARY,
      symbols: ["hero", "home"],
      aspectRatio: "16:9",
      shot: { ...planSchema.parse(demoPlan("A. B.", 2)).shots[0], shotType: "Wide shot", mode: "still" as const },
      index: 1,
      canvas,
      fps: 12,
      characters: ["hero"],
      sets: ["home"],
      strict: false,
    });
    expect(d.svg).not.toMatch(/<svg/);
    expect(d.svg).toContain('<g transform="translate(500 300) scale(1)">');
  });
});

describe("D · the night-tint ordering rule goes with the FIRST draw", () => {
  it("a night shot's first brief spells out the drawing order and the brightness bar; a day shot's does not", () => {
    const p = planSchema.parse(demoPlan("A. B.", 2));
    const night = { ...p.shots[0], description: "Night on the veranda, lantern glow; Yui listens to the chime." };
    expect(artistUser({ plan: p, shot: night, index: 1, symbols: [], canvas })).toMatch(/NIGHT SHOT — drawing order: 1\) the set, 2\) the navy tint .* 4\) the characters and props LAST/);
    expect(artistUser({ plan: p, shot: { ...night, description: "Morning sun on the veranda." }, index: 1, symbols: [], canvas })).not.toMatch(/NIGHT SHOT/);
  });
});

// ---------- A · the recognition gate, end to end with the scripted crew ----------

const FURIN_FLOWER = `<symbol id="furin" viewBox="0 0 400 400"><rect x="196" y="0" width="8" height="200" fill="#5a4630"/>${Array.from({ length: 12 }, (_, k) => `<ellipse cx="${200 + Math.round(60 * Math.cos((k * Math.PI) / 6))}" cy="${260 + Math.round(60 * Math.sin((k * Math.PI) / 6))}" rx="30" ry="18" fill="#ffffff"/>`).join("")}<circle cx="200" cy="260" r="26" fill="#f4d35e"/></symbol>`;
const FURIN_BELL = `<symbol id="furin" viewBox="0 0 400 400"><rect x="197" y="0" width="6" height="60" fill="#5a4630"/><path d="M110 200 Q110 70 200 70 Q290 70 290 200 Z" fill="#9fd6e8"/><path d="M130 190 Q135 100 200 86" stroke="#e8f6fb" stroke-width="10" fill="none"/><rect x="110" y="196" width="180" height="10" fill="#3f7f95"/><circle cx="160" cy="140" r="14" fill="#e85a4f"/><circle cx="240" cy="140" r="14" fill="#e85a4f"/><circle cx="200" cy="120" r="10" fill="#e85a4f"/><rect x="198" y="206" width="4" height="60" fill="#5a4630"/><circle cx="200" cy="214" r="9" fill="#c9a23c"/><rect x="170" y="262" width="60" height="130" rx="4" fill="#f2e3b0"/><path d="M182 290 L218 290 M182 320 L214 320 M182 350 L216 350" stroke="#3a2a1a" stroke-width="5"/><path d="M285 200 Q300 120 260 80" stroke="#ffffff" stroke-width="6" fill="none" stroke-opacity="0.6"/></symbol>`;
const RINGING = FURIN_BELL.replace('id="furin"', 'id="furin--ringing"').replace('</symbol>', '<path d="M90 120 Q70 140 90 160 M310 120 Q330 140 310 160" stroke="#3f7f95" stroke-width="6" fill="none"/></symbol>');

let storage: string;
const created: string[] = [];
beforeAll(async () => {
  storage = await fs.mkdtemp(path.join(os.tmpdir(), "engine1012-"));
  process.env.STORAGE_ROOT = storage;
});
afterAll(async () => {
  await prisma.project.deleteMany({ where: { id: { in: created } } });
  await fs.rm(storage, { recursive: true, force: true });
});

function furinPlan(story: string) {
  const p = demoPlan(story, 4);
  return {
    ...p,
    cast: [...p.cast, { id: "furin", name: "Fūrin (glass wind chime)", kind: "prop", look: "a small blue glass bell hanging from the eaves by a string, a clapper and a long paper strip (tanzaku) below", colors: ["#9fd6e8", "#f2e3b0"], states: [{ id: "still", look: "hanging still" }, { id: "ringing", look: "swinging, the strip lifted by the wind" }] }],
    shots: p.shots.map((s, i) => ({ ...s, cast: [...s.cast, "furin"], ...(i >= 2 ? { propStates: [{ prop: "furin", state: "ringing" }] } : {}) })),
  };
}

/** The scripted crew with a vision model that sees `sightings` in turn, and a Nano that matches "chime"/"bell". */
function recognizingCrew(sightings: string[], log: string[]): MockHandler {
  const base = demoHandler();
  return (m, o, i) => {
    const role = m[0].content.match(/^ROLE: (\w+)/)?.[1];
    const user = m[m.length - 1].content;
    if (role === "DIRECTOR") return furinPlan("Yui hangs a wind chime. It rings. Grandma smiles. The summer ends.");
    if (role === "CAST" && /named it/.test(user)) {
      log.push("redraw");
      return "```svg\n" + FURIN_BELL + "\n```";
    }
    if (role === "CAST") {
      // the first turn already asks for the key object's later state, from the same base
      if (/- furin--ringing \(prop, "Fūrin \(glass wind chime\) \(ringing\)"\): The SAME object as #furin/.test(user)) log.push("asked for furin--ringing");
      return "```svg\n" + DEMO_LIBRARY + "\n" + FURIN_FLOWER + "\n" + RINGING + "\n```";
    }
    if (role === "NAME_OBJECT") {
      const name = sightings.length > 1 ? sightings.shift()! : sightings[0];
      log.push(`saw ${name}`);
      return { name, description: `${name}, drawn on a plain background` };
    }
    if (role === "PROP_CHECK") return { match: /chime|bell/.test(user.match(/named it: "([^"]*)"/)?.[1] ?? ""), reason: "compared the names" };
    return base(m, o, i);
  };
}

async function castOnly(handler: MockHandler, visionAvailable = true) {
  const p = await prisma.project.create({ data: { name: "engine1012-test" } });
  created.push(p.id);
  const d = { provider: new MockLlmProvider(handler), models: MOCK_MODELS, visionAvailable, modelNotes: [], tavily: null, ceiling: DEFAULT_BUDGET };
  const req = { projectId: p.id, story: "Yui hangs a wind chime. It rings. Grandma smiles. The summer ends.", language: "en", style: "storybook", critic: true, research: false, maxShots: 4, stopAfter: "cast" as const };
  const { runId, budget } = await createRun(req, d);
  const ctrl = registerRun(runId);
  try {
    return { runId, projectId: p.id, summary: await executeRun(runId, req, d, budget, () => {}, ctrl.signal) };
  } finally {
    unregisterRun(runId);
  }
}

describe("A · hero-prop recognition gate (mock crew): render alone → the vision model names it → Nano checks → the Cast redraws on a miss", () => {
  it("lists the hero's symbols to check: the base (its first state) and each later state", () => {
    const plan = normalizePlan(planSchema.parse(furinPlan("A. B. C. D.")), 24);
    expect(heroSymbols(plan).map((t) => [t.symbol, t.state?.id])).toEqual([["furin", "still"], ["furin--ringing", "ringing"]]);
  });

  it("a fūrin the viewer calls “a white flower on a stick” is redrawn, recognised, and the run stops after the cast (preview)", async () => {
    const log: string[] = [];
    const { runId, projectId, summary } = await castOnly(recognizingCrew(["a white flower on a stick", "a glass wind chime"], log));
    expect(summary.status).toBe("done");
    expect(summary.shots).toBe(4);
    expect(summary.rendered).toBe(0);
    expect(summary.propRecognition).toEqual([
      { symbol: "furin", prop: "furin", state: "still", ok: true, saw: "a glass wind chime", redraws: 1 },
      { symbol: "furin--ringing", prop: "furin", state: "ringing", ok: true, saw: "a glass wind chime", redraws: 0 },
    ]);
    expect(log).toEqual(["asked for furin--ringing", "saw a white flower on a stick", "redraw", "saw a glass wind chime", "saw a glass wind chime"]);
    const steps = await prisma.directorStep.findMany({ where: { runId }, orderBy: { seq: "asc" } });
    const verdict = steps.filter((s) => s.action === "recognize:verdict");
    expect(verdict[0].outputSummary).toMatch(/#furin \(still\) alone, named "a white flower on a stick": NOT recognised/);
    expect(verdict[0].imagePath).toMatch(/recognize-furin-0\.jpg$/);
    expect(steps.some((s) => s.action === "defs:recognize" && /redrawn after the viewer saw "a white flower on a stick"/.test(s.outputSummary ?? ""))).toBe(true);
    expect(steps.some((s) => s.action === "prop-states")).toBe(true);
    expect(steps.some((s) => s.action === "stop-after-cast")).toBe(true);
    expect(steps.some((s) => s.role === "artist")).toBe(false);
    // the library now holds the bell, and every state has a symbol
    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    expect(project.artworkDefs).toContain('<path d="M110 200 Q110 70 200 70');
    expect(project.artworkDefs).toMatch(/id="furin--still"/);
    expect(project.artworkDefs).toMatch(/id="furin--ringing"/);
    // a preview is never a publishable film
    expect(measuredProblems("done", summary).join(" ")).toMatch(/cast-only preview run, not a film/);
  }, 120_000);

  it(`still not recognised after ${MAX_REDRAWS} redraws → reported, and the publish gate blocks it`, async () => {
    const log: string[] = [];
    const { summary } = await castOnly(recognizingCrew(["a white flower on a stick"], log));
    expect(summary.propRecognition?.[0]).toMatchObject({ symbol: "furin", ok: false, saw: "a white flower on a stick", redraws: MAX_REDRAWS });
    expect(log.filter((l) => l === "redraw")).toHaveLength(MAX_REDRAWS + MAX_REDRAWS);
    expect(measuredProblems("done", { ...summary, stopAfter: undefined }).join(" ")).toMatch(/the key object #furin is not recognised on its own \(a viewer saw "a white flower on a stick"\)/);
  }, 120_000);

  it("without a vision model the gate says so and reports “not checked” (null), which also blocks publishing", async () => {
    const { runId, summary } = await castOnly(recognizingCrew(["x"], []), false);
    expect(summary.propRecognition?.map((r) => r.ok)).toEqual([null, null]);
    expect((await prisma.directorStep.findFirst({ where: { runId, action: "recognize:skipped" } }))?.outputSummary).toMatch(/no vision model/);
    expect(measuredProblems("done", { ...summary, stopAfter: undefined }).join(" ")).toMatch(/#furin was not checked by the recognition gate/);
  }, 120_000);
});
