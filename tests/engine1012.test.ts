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
      return { name, description: `${name}, drawn on a plain background, swinging in the wind` };
    }
    if (role === "PROP_CHECK") return { category: /chime|bell/.test(user.match(/named it: "([^"]*)"/)?.[1] ?? ""), parts: [], lookalike: false, stateChange: /No state is checked/.test(user) ? null : true, reason: "compared the names" };
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
    expect(steps.some((s) => s.action === "defs:recognize" && /redrawn \(1\/4\) after the viewer saw "a white flower on a stick"/.test(s.outputSummary ?? ""))).toBe(true);
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
    expect(MAX_REDRAWS).toBe(4);
    // #furin: 4 accepted redraws, each looked at again (5 looks). #furin--ringing: every redraw comes back as #furin (wrong
    // id) → rejected → retried once with that problem; a rejected redraw costs no look (owner 2026-10-12, round 3)
    expect(log.filter((l) => l === "redraw")).toHaveLength(MAX_REDRAWS + 2 * MAX_REDRAWS);
    expect(log.filter((l) => l.startsWith("saw "))).toHaveLength(MAX_REDRAWS + 1 + 1);
    expect(measuredProblems("done", { ...summary, stopAfter: undefined }).join(" ")).toMatch(/the key object #furin is not recognised on its own \(a viewer saw "a white flower on a stick"\)/);
  }, 120_000);

  it("without a vision model the gate says so and reports “not checked” (null), which also blocks publishing", async () => {
    const { runId, summary } = await castOnly(recognizingCrew(["x"], []), false);
    expect(summary.propRecognition?.map((r) => r.ok)).toEqual([null, null]);
    expect((await prisma.directorStep.findFirst({ where: { runId, action: "recognize:skipped" } }))?.outputSummary).toMatch(/no vision model/);
    expect(measuredProblems("done", { ...summary, stopAfter: undefined }).join(" ")).toMatch(/#furin was not checked by the recognition gate/);
  }, 120_000);
});

// ---------- a full take REUSES the approved preview's cast (owner 2026-10-12, before any full take) ----------

describe("castFromRun: a take on an approved cast-only preview reuses its Bible, library and recognition verbatim", () => {
  it("no Cast call, no re-check, the planner is told the cast and its states, new ids are dropped, and the hashes match the preview's", async () => {
    const { loadCastFromRun, castHashes } = await import("@/lib/services/director/series");
    // 1 · the preview (cast-only), approved by eye
    const preview = await castOnly(recognizingCrew(["a glass wind chime"], []));
    const previewRun = await prisma.directorRun.findUniqueOrThrow({ where: { id: preview.runId } });
    const previewBible = JSON.parse(previewRun.bible!) as Plan;
    const previewHashes = castHashes(previewBible.cast, previewRun.library!);
    expect(previewHashes.map((h) => h.id)).toEqual(expect.arrayContaining(["furin", "furin--still", "furin--ringing", "home", "hero"]));
    // 2 · the take
    const calls: string[] = [];
    const prompts: string[] = [];
    const base = recognizingCrew(["never asked"], []);
    const take: MockHandler = (m, o, i) => {
      const role = m[0].content.match(/^ROLE: (\w+)/)?.[1] ?? "?";
      calls.push(role);
      if (role === "DIRECTOR") {
        prompts.push(m[m.length - 1].content);
        // the planner tries to add a new prop: the locked cast drops it
        const p = furinPlan("Yui hangs a wind chime. It rings. Grandma smiles. The summer ends.");
        return { ...p, cast: [...p.cast, { id: "teacup", name: "Teacup", kind: "prop", look: "a small teacup", colors: ["#ffffff"] }], shots: p.shots.map((s) => ({ ...s, cast: [...s.cast, "teacup"] })) };
      }
      return base(m, o, i);
    };
    const p = await prisma.project.create({ data: { name: "engine1012-take" } });
    created.push(p.id);
    const d = { provider: new MockLlmProvider(take), models: MOCK_MODELS, visionAvailable: true, modelNotes: [], tavily: null, ceiling: DEFAULT_BUDGET, floorRedraw: { enabled: false, reason: "test" } };
    const castFrom = await loadCastFromRun(preview.runId);
    const req = { projectId: p.id, story: "Yui hangs a wind chime. It rings. Grandma smiles. The summer ends.", language: "en", style: "storybook", critic: false, research: false, maxShots: 4, castFrom };
    const { runId, budget } = await createRun(req, d);
    const ctrl = registerRun(runId);
    let summary;
    try {
      summary = await executeRun(runId, req, d, budget, () => {}, ctrl.signal);
    } finally {
      unregisterRun(runId);
    }
    expect(summary.status).toBe("done");
    expect(summary.castFromRun).toBe(preview.runId);
    // no Cast call and no recognition re-spend
    expect(calls).not.toContain("CAST");
    expect(calls).not.toContain("NAME_OBJECT");
    expect(calls).not.toContain("PROP_CHECK");
    // the anatomy comes with the approved cast: no new ANATOMY call (round 3)
    expect(calls).not.toContain("ANATOMY");
    expect(previewBible.cast.find((c) => c.id === "furin")?.anatomy?.parts.length).toBeGreaterThanOrEqual(3);
    expect((JSON.parse((await prisma.directorRun.findUniqueOrThrow({ where: { id: runId } })).bible!) as Plan).cast.find((c) => c.id === "furin")?.anatomy).toEqual(previewBible.cast.find((c) => c.id === "furin")?.anatomy);
    expect(summary.propRecognition).toEqual(preview.summary.propRecognition);
    // the planner got the cast and its states
    expect(prompts[0]).toMatch(/REUSES an approved cast[\s\S]*- furin \(prop[\s\S]*STATES: "still" \(hanging still\), "ringing"/);
    const steps = await prisma.directorStep.findMany({ where: { runId }, orderBy: { seq: "asc" } });
    expect(steps.find((s) => s.action === "plan:cast-locked")?.outputSummary).toMatch(/dropped new id\(s\) #teacup/);
    expect(steps.find((s) => s.action === "recognize:carried")?.outputSummary).toMatch(/#furin recognised \("a glass wind chime"\)/);
    // the take's log: one hash per reused symbol, the same as the preview's
    const reused = JSON.parse(steps.find((s) => s.action === "cast-from-run")!.output!) as { sourceRunId: string; hashes: Array<{ id: string; sha: string }> };
    expect(reused.sourceRunId).toBe(preview.runId);
    expect(reused.hashes).toEqual(previewHashes);
    // and the take's library is the preview's, verbatim (plus the take's own posed variants and paintings, appended)
    const takeRun = await prisma.directorRun.findUniqueOrThrow({ where: { id: runId } });
    expect(castHashes(previewBible.cast, takeRun.library!)).toEqual(previewHashes);
    expect((JSON.parse(takeRun.bible!) as Plan).cast.map((c) => c.id)).toEqual(previewBible.cast.map((c) => c.id));
  }, 180_000);

  it("reads an older preview's set lighting back from its variants", async () => {
    const { inferSetTimes } = await import("@/lib/services/director/series");
    const defs = '<symbol id="beach" viewBox="0 0 1 1"/><symbol id="beach--night" viewBox="0 0 1 1"/><symbol id="room" viewBox="0 0 1 1"/><symbol id="room--day" viewBox="0 0 1 1"/><symbol id="yard" viewBox="0 0 1 1"/>';
    expect(inferSetTimes([{ id: "beach", kind: "set" }, { id: "room", kind: "set" }, { id: "yard", kind: "set" }], defs)).toEqual({ beach: "day", "beach--night": "night", room: "night", "room--day": "day" });
  });
});

describe("D71 in the sets: a dusk-lit set is wrong for a morning or afternoon shot (preview 2026-10-12, the kite's beach)", () => {
  it("the shots planned in daylight on a dusk set get a day variant; dusk and night shots keep the dusk set", async () => {
    const { setTimeVariant, setForShot } = await import("@/lib/services/director/fidelity");
    const p = planSchema.parse(demoPlan("A. B.", 2));
    const shot = (description: string) => ({ ...p.shots[0], scene: "Seafront", description, cast: ["beach"] });
    const plan = { shots: [shot("Brighton seafront on a windy autumn morning."), shot("Afternoon light on the seafront."), shot("Golden dusk bathes the beach.")] };
    expect(setTimeVariant(plan, "beach", "dusk")).toBe("day");
    const times = new Map([["beach", "dusk"], ["beach--day", "day"]]);
    expect(setForShot(plan.shots[0], "beach", times)).toBe("beach--day");
    expect(setForShot(plan.shots[2], "beach", times)).toBe("beach");
    expect(setForShot(shot("Night falls on the beach."), "beach", times)).toBe("beach");
    // a golden set is the DAY bucket: no variant needed for a morning shot
    expect(setTimeVariant({ shots: [plan.shots[0]] }, "beach", "golden")).toBeNull();
  });
});

describe("one malformed symbol costs only itself, never the whole library (preview 2026-10-12, bánh chưng)", () => {
  it("salvageLibrary keeps every symbol that renders, replaces the broken member with its placeholder and a broken state with its base", async () => {
    const { salvageLibrary } = await import("@/lib/services/director/cast");
    const members = [
      { id: "yard", name: "Yard", kind: "set" as const, look: "a courtyard", colors: ["#c8a878"] },
      { id: "cake", name: "Cake", kind: "prop" as const, look: "a square green cake", colors: ["#4f8a4f"] },
      { id: "cake--cooked", name: "Cake (cooked)", kind: "prop" as const, look: "cooked", colors: ["#4f8a4f"] },
    ];
    const extras = new Map([["yard-sky", '<linearGradient id="yard-sky"><stop offset="0" stop-color="#9fd3f0"/></linearGradient>'], ["cake-sheen", '<radialGradient id="cake-sheen"><stop offset="0" stop-color="#ffffff"/></radialGradient>']]);
    const good = '<symbol id="yard" viewBox="0 0 1920 1080"><rect width="1920" height="1080" fill="url(#yard-sky)"/></symbol>';
    const broken = '<symbol id="cake" viewBox="0 0 400 400"><rect x="10" y="10" width="380" height="380" fill="url(#cake-sheen)"</symbol>';
    const brokenState = '<symbol id="cake--cooked" viewBox="0 0 400 400"><circle cx="200" cy="200" r="150" fill="#3a6a3a"</symbol>';
    const out = await salvageLibrary([good, broken, brokenState], extras, members, canvas, "16:9");
    expect(out.broken).toEqual(["cake", "cake--cooked"]);
    expect(out.defs).toContain(good);
    expect(out.defs).toContain('<linearGradient id="yard-sky">');
    expect(out.defs).not.toContain("cake-sheen");
    expect(out.defs).toContain('<symbol id="cake--cooked" viewBox="0 0 400 400"><use href="#cake" x="0" y="0" width="400" height="400"/></symbol>');
    // the salvaged library renders as a whole
    await expect(renderArtwork(out.defs, '<use href="#yard" x="0" y="0" width="1920" height="1080"/><use href="#cake--cooked" x="700" y="300" width="400" height="400"/>', "16:9", "1K")).resolves.toBeInstanceOf(Buffer);
  });
});

/* ---------- Round 3 (owner 2026-10-12, after #33): the key object, by visible features ---------- */

const FURIN_ANATOMY = {
  category: ["wind chime", "glass bell", "hanging bell"],
  parts: [
    { part: "glass bell", look: "a small transparent glass bell, open at the bottom, a white highlight" },
    { part: "clapper", look: "a small clapper hanging inside the bell" },
    { part: "string", look: "a short string from the top of the bell to the eaves" },
    { part: "paper strip", look: "a long paper strip hanging below on a thread" },
  ],
  notLike: ["flower", "candle holder"],
  states: [
    { id: "still", change: "hanging straight down" },
    { id: "ringing", change: "the bell tilted and the paper strip lifted sideways by the wind" },
  ],
};

/** A crew with an anatomy, a viewer that sees `sightings`, and a Nano that answers `checks` in turn (the last one repeats). */
function anatomyCrew(sightings: string[], checks: Array<Record<string, unknown>> | ((user: string) => Record<string, unknown>), log: string[], redraws: string[] = []): MockHandler {
  const base = recognizingCrew(sightings, log);
  return (m, o, i) => {
    const role = m[0].content.match(/^ROLE: (\w+)/)?.[1] ?? "?";
    const user = m[m.length - 1].content;
    log.push(`role ${role}`);
    if (role === "ANATOMY") return FURIN_ANATOMY;
    if (role === "PROP_CHECK") {
      log.push(`check ${user.includes("Anatomy parts: glass bell") ? "with anatomy" : "no anatomy"}`);
      return typeof checks === "function" ? checks(user) : checks.length > 1 ? checks.shift()! : checks[0];
    }
    if (role === "CAST" && /named it/.test(user) && redraws.length) {
      log.push(`redraw prompt: ${/at least 12 separate shapes/.test(user) ? "rule" : "no rule"}${/REJECTED by the engine/.test(user) ? " +rejected" : ""}`);
      return "```svg\n" + redraws.shift()! + "\n```";
    }
    if (role === "CAST" && !/named it/.test(user)) log.push(`cast brief: ${/ANATOMY — draw EVERY part so a stranger names it "wind chime"/.test(user) ? "anatomy" : "none"}`);
    return base(m, o, i);
  };
}

const check = (c: Partial<{ category: boolean; parts: string[]; lookalike: boolean; stateChange: boolean | null }>) => ({ category: false, parts: [], lookalike: false, stateChange: null, reason: "r", ...c });

describe("Round 3 · recognised by visible features (owner 2026-10-12): category or ≥ 2/3 of the anatomy; look-alikes fail; a state needs its change", () => {
  it("propVerdict: the pass rule, applied by the engine on Nano's report", async () => {
    const { propVerdict } = await import("@/lib/services/director/recognize");
    const a = FURIN_ANATOMY;
    const saw = (name: string, description = "") => ({ name, description });
    const ringing = (drawn = true) => ({ id: "ringing", change: FURIN_ANATOMY.states[1].change, drawn });
    expect(propVerdict(a, check({ category: true }), { saw: saw("glass wind chime") }).ok).toBe(true);
    // 3 of 4 parts (≥ 2/3) without the name: passes; 2 of 4 does not
    expect(propVerdict(a, check({ parts: ["glass bell", "clapper", "Paper strip"] })).ok).toBe(true);
    expect(propVerdict(a, check({ parts: ["glass bell", "clapper"] }))).toEqual({ ok: false, why: "2/4 parts seen (need 3)" });
    // parts Nano invents (not in the anatomy) don't count
    expect(propVerdict(a, check({ parts: ["glass bell", "ribbon", "bow"] })).ok).toBe(false);
    // a generic look-alike fails whatever else was said ("gift box", "spatula")
    expect(propVerdict(a, check({ category: true, parts: ["glass bell", "clapper", "string"], lookalike: true }))).toEqual({ ok: false, why: "named a look-alike" });
    // a later state passes only when it was drawn and its visible change is named
    expect(propVerdict(a, check({ category: true, stateChange: false }), { saw: saw("wind chime"), state: ringing() })).toEqual({ ok: false, why: "category named; state change NOT named" });
    expect(propVerdict(a, check({ category: true, stateChange: true }), { saw: saw("wind chime", "the paper strip is lifted sideways by the wind"), state: ringing() }).ok).toBe(true);
    // a cast from before round 3 (no anatomy): Nano's category alone decides
    expect(propVerdict(undefined, check({ category: true })).ok).toBe(true);
    expect(propVerdict(undefined, check({ parts: ["glass bell", "clapper", "string"] })).ok).toBe(false);
  });

  it("the engine checks Nano's claims against the viewer's words (round-3 previews: two false passes)", async () => {
    const { propVerdict, headNoun } = await import("@/lib/services/director/recognize");
    expect(["glass wind chime", "paper-strip chime", "rice cake wrapped in leaves", "leaf parcel", "diamond-shaped kite", "gift box"].map(headNoun)).toEqual(["chime", "chime", "cake", "parcel", "kite", "box"]);
    // fūrin round 3, #furin--ringing: Nano said category: true for "a white flower on a stick"
    const r3 = JSON.parse(readFileSync("docs/hackathon/evidence/preview-2026-10-12-r3/v2-furin-trace.json", "utf8")) as { bible: Plan; steps: Array<{ action: string; output: string | null }> };
    const furin = r3.bible.cast.find((c) => c.id === "furin")!;
    const nano = r3.steps.filter((x) => x.action === "recognize:check" && x.output).map((x) => JSON.parse(x.output!)).at(-1);
    expect(nano.category).toBe(true);
    const flower = propVerdict(furin.anatomy, nano, { saw: { name: "a white flower on a stick", description: "A white flower with a long stem on a stick" }, state: { id: "ringing", change: furin.anatomy!.states[1].change, drawn: true } });
    expect(flower.ok).toBe(false);
    // kite round 3, #kite--patched: the Cast never drew it (the base drawing stood in), yet Nano said stateChange: true
    const kite = JSON.parse(readFileSync("docs/hackathon/evidence/preview-2026-10-12-r3/v2-kite-trace.json", "utf8")) as { bible: Plan };
    const k = kite.bible.cast.find((c) => c.id === "kite")!;
    const patched = { id: "patched", change: k.anatomy!.states.find((x) => x.id === "patched")!.change };
    const plainKite = { name: "kite", description: "A red diamond kite with a white string" };
    expect(propVerdict(k.anatomy, check({ category: true, stateChange: true }), { saw: plainKite, state: { ...patched, drawn: false } })).toEqual({ ok: false, why: "category named; state NOT drawn (the base drawing stands in)" });
    // and even drawn, a description that names no change word (colour and shape words don't count) fails
    expect(propVerdict(k.anatomy, check({ category: true, stateChange: true }), { saw: plainKite, state: { ...patched, drawn: true } }).ok).toBe(false);
    expect(propVerdict(k.anatomy, check({ category: true, stateChange: true }), { saw: { name: "kite", description: "a red kite with a white cloth patch sewn on with stitches" }, state: { ...patched, drawn: true } }).ok).toBe(true);
  });

  it("a stand-in state symbol (only the base placed) is told apart from a drawn one", async () => {
    const { isBaseStandIn } = await import("@/lib/services/director/recognize");
    const defs = `${FURIN_BELL}\n<symbol id="furin--still" viewBox="0 0 400 400"><use href="#furin" x="0" y="0" width="400" height="400"/></symbol>\n${RINGING}`;
    expect(isBaseStandIn(defs, "furin--still", "furin")).toBe(true);
    expect(isBaseStandIn(defs, "furin--ringing", "furin")).toBe(false);
  });

  it("Ultra writes the anatomy BEFORE the Cast draws; the Cast draws from it; Nano reads the viewer against it; it is kept in the Bible", async () => {
    const log: string[] = [];
    const { runId, summary } = await castOnly(anatomyCrew(["a glass bell, its paper strip lifted sideways by the wind"], [check({ category: true }), check({ category: true, stateChange: true })], log));
    const roles = log.filter((l) => l.startsWith("role ")).map((l) => l.slice(5));
    expect(roles.indexOf("ANATOMY")).toBeGreaterThan(roles.indexOf("DIRECTOR"));
    expect(roles.indexOf("ANATOMY")).toBeLessThan(roles.indexOf("CAST"));
    expect(log).toContain("cast brief: anatomy");
    expect(log.filter((l) => l.startsWith("check "))).toEqual(["check with anatomy", "check with anatomy"]);
    expect(summary.propRecognition?.map((r) => r.ok)).toEqual([true, true]);
    const run = await prisma.directorRun.findUniqueOrThrow({ where: { id: runId } });
    expect((JSON.parse(run.bible!) as Plan).cast.find((c) => c.id === "furin")?.anatomy).toEqual(FURIN_ANATOMY);
    const steps = await prisma.directorStep.findMany({ where: { runId }, orderBy: { seq: "asc" } });
    expect(steps.filter((s) => s.action === "plan:anatomy").at(-1)?.outputSummary).toMatch(/#furin anatomy: wind chime \/ glass bell \/ hanging bell — glass bell, clapper, string, paper strip · states: still → ringing/);
  }, 120_000);

  it("a look-alike (“a gift box”) is NOT recognised even when Nano lists matching parts; a later state whose change is not named is NOT recognised", async () => {
    const log: string[] = [];
    const { summary } = await castOnly(anatomyCrew(["a gift box"], (user) => (/No state is checked/.test(user) ? check({ category: false, parts: ["glass bell", "clapper", "string"], lookalike: true }) : check({ category: true, stateChange: false })), log));
    expect(summary.propRecognition?.[0]).toMatchObject({ symbol: "furin", ok: false, redraws: MAX_REDRAWS });
    expect(summary.propRecognition?.[1]).toMatchObject({ symbol: "furin--ringing", ok: false });
  }, 120_000);

  it(`a redraw the engine rejects (too few shapes) is retried once with that problem and costs no look; the ≥ 12-shape rule is in the redraw brief up front`, async () => {
    const log: string[] = [];
    const thin = FURIN_BELL.replace(/<circle[^>]*\/>/g, "").replace(/<rect x="170"[^>]*\/>/, "");
    const { summary } = await castOnly(anatomyCrew(["a white flower on a stick", "a glass wind chime"], [check({ category: false }), check({ category: true }), check({ category: true, stateChange: true })], log, [thin, FURIN_BELL]));
    expect(summary.propRecognition?.[0]).toMatchObject({ symbol: "furin", ok: true, redraws: 1, saw: "a glass wind chime" });
    expect(log.filter((l) => l.startsWith("redraw prompt"))).toEqual(["redraw prompt: rule", "redraw prompt: rule +rejected"]);
    // two looks at #furin (before, after the accepted redraw): the rejected one was never shown to the viewer
    expect(log.filter((l) => l === "saw a white flower on a stick" || l === "saw a glass wind chime").length).toBe(3);
  }, 120_000);
});

describe("Round 3 · every state symbol rendered alone shows something (bánh chưng round 1: --wrapped/--cooked/--onaltar were an empty background)", () => {
  const cakePlan = {
    cast: [
      { id: "yard", name: "Yard", kind: "set" as const, look: "a courtyard", colors: ["#c8a878", "#8a6a4a"] },
      { id: "banh-chung", name: "Bánh chưng", kind: "prop" as const, look: "a square leaf parcel", colors: ["#3f7d3f", "#d8c48a"], states: [{ id: "ingredients", look: "piles" }, { id: "wrapped", look: "wrapped" }, { id: "cooked", look: "cooked" }, { id: "onaltar", look: "on the altar" }] },
    ],
  };
  const visible = async (defs: string, id: string) => {
    const { renderAlone } = await import("@/lib/services/director/recognize");
    const { isNearlyBlank } = await import("@/lib/services/director/svgTools");
    return !(await isNearlyBlank(await renderAlone(defs, id, "16:9", canvas)));
  };

  it("the cause: the all-placeholder library has no state symbols, so each one rendered alone is the bare background", async () => {
    const { placeholderLibrary } = await import("@/lib/services/director/cast");
    const defs = placeholderLibrary(cakePlan.cast, canvas);
    expect(await visible(defs, "banh-chung")).toBe(true);
    for (const st of ["wrapped", "cooked", "onaltar"]) expect(await visible(defs, `banh-chung--${st}`), st).toBe(false);
  });

  it("the fix: ensureStateSymbols gives every state a symbol, and a blank one (drawn outside its viewBox) the base drawing", async () => {
    const { placeholderLibrary, ensureStateSymbols } = await import("@/lib/services/director/cast");
    const out = await ensureStateSymbols(cakePlan, placeholderLibrary(cakePlan.cast, canvas), canvas, "16:9");
    expect(out.fixed).toEqual(["banh-chung--wrapped", "banh-chung--cooked", "banh-chung--onaltar"]);
    for (const st of cakePlan.cast[1].states!) expect(await visible(out.defs, `banh-chung--${st.id}`), st.id).toBe(true);
    // a state drawn entirely outside its viewBox
    const offCanvas = `${placeholderLibrary(cakePlan.cast, canvas)}\n<symbol id="banh-chung--cooked" viewBox="0 0 400 400"><rect x="900" y="900" width="200" height="200" fill="#2f4f2f"/></symbol>`;
    const fixed = await ensureStateSymbols(cakePlan, offCanvas, canvas, "16:9");
    expect(fixed.fixed).toContain("banh-chung--cooked");
    expect(fixed.defs).not.toContain('x="900"');
    for (const st of cakePlan.cast[1].states!) expect(await visible(fixed.defs, `banh-chung--${st.id}`), st.id).toBe(true);
  });

  it("end to end: whatever the Cast returns, every state symbol in the run's library shows something alone", async () => {
    // a Cast that never returns a usable library: every member falls back to its placeholder
    const crew: MockHandler = (m, o, i) => (/^ROLE: CAST/.test(m[0].content) ? "nothing usable" : recognizingCrew(["a glass wind chime"], [])(m, o, i));
    const { projectId } = await castOnly(crew);
    const defs = (await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).artworkDefs ?? "";
    for (const id of ["furin", "furin--still", "furin--ringing"]) expect(await visible(defs, id), id).toBe(true);
  }, 120_000);
});

describe("Round 3 · a street or market is paved with stone (the Gion street's ground read as water)", () => {
  it("a blue or green ground on a paved place becomes stone; a stone-coloured one is kept; the paving has courses and joints", async () => {
    const { buildSet, stoneGround } = await import("@/lib/services/director/setKit");
    expect(stoneGround("#3d78b5")).not.toBe("#3d78b5");
    expect(stoneGround("#2f8f5a")).not.toBe("#2f8f5a");
    expect(stoneGround("#a9a39a")).toBe("#a9a39a");
    expect(stoneGround("#c9b89a")).toBe("#c9b89a");
    expect(stoneGround(undefined)).toBe("#b3aca1");
    const spec = { place: "market" as const, time: "dusk" as const, weather: "clear" as const, main: "#c9a27a", accent: "#b04a3a", ground: "#3d78b5", props: [], dressing: [] };
    const defs = buildSet("gion", spec, canvas, []);
    expect(defs).not.toMatch(/#3d78b5/i);
    // horizontal course lines with vertical joints, several rows
    expect((defs.match(/<path d="M0 [\d.]+ H1920( M[\d.]+ [\d.]+ V[\d.]+)+"/g) ?? []).length).toBeGreaterThanOrEqual(4);
    // the near ground is grey stone, not blue: sample the bottom band of the render
    const png = await renderArtwork(defs, '<use href="#gion" x="0" y="0" width="1920" height="1080"/>', "16:9", "1K");
    const { data, info } = await sharp(png).extract({ left: 0, top: 520, width: 1024, height: 50 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let r = 0, g = 0, b = 0;
    for (let k = 0; k < data.length; k += info.channels) [r, g, b] = [r + data[k], g + data[k + 1], b + data[k + 2]];
    const px = data.length / info.channels;
    expect(b / px - r / px).toBeLessThan(20);
  });
});

describe("Round 3 · the key object fills its own viewBox; a flying object's string is the engine's (kite round 3: a tiny kite under a long string)", () => {
  const parts = (cx: number, cy: number, r: number) =>
    [
      `<path d="M${cx} ${cy - r} L${cx + r * 0.75} ${cy} L${cx} ${cy + r} L${cx - r * 0.75} ${cy} Z" fill="#d94a3d"/>`,
      `<path d="M${cx} ${cy - r} L${cx + r * 0.75} ${cy} L${cx} ${cy} Z" fill="#e8665a"/>`,
      `<path d="M${cx} ${cy - r} V${cy + r} M${cx - r * 0.75} ${cy} H${cx + r * 0.75}" stroke="#c9a46a" stroke-width="${Math.max(2, r / 20)}"/>`,
      ...Array.from({ length: 10 }, (_, k) => `<circle cx="${cx - r * 0.4 + k * r * 0.08}" cy="${cy + r * 0.3}" r="${Math.max(1, r / 30)}" fill="#ffffff" fill-opacity="0.6"/>`),
    ].join("");
  const kiteMember = { id: "kite", name: "Red kite", kind: "prop" as const, look: "a red diamond kite", colors: ["#d94a3d"] };

  it("a small kite under a long string inside its symbol is rejected; the same kite drawn large passes", async () => {
    const { symbolProblems } = await import("@/lib/services/director/cast");
    const tiny = `<symbol id="kite" viewBox="0 0 400 400"><path d="M200 10 V330" stroke="#ffffff" stroke-width="2"/>${parts(200, 340, 40)}</symbol>`;
    const big = `<symbol id="kite" viewBox="0 0 400 400">${parts(200, 200, 170)}</symbol>`;
    const p1 = await symbolProblems(kiteMember, tiny, new Map(), canvas, "16:9", new Set(), true);
    expect(p1.join(" ")).toMatch(/the object itself fills only \d+% × \d+% of its viewBox; draw the object LARGE/);
    expect(await symbolProblems(kiteMember, big, new Map(), canvas, "16:9", new Set(), true)).toEqual([]);
    // not the key object: no fill rule
    expect(await symbolProblems(kiteMember, tiny, new Map(), canvas, "16:9", new Set(), false)).toEqual([]);
  });

  it("the Cast is told a flying key object (and each of its states) has no string in its symbol", async () => {
    const { castUser } = await import("@/lib/services/director/prompts");
    const plan = { ...planSchema.parse(demoPlan("One. Two. Three.", 3)), cast: [{ ...kiteMember, airborne: true, states: [{ id: "intact", look: "whole" }, { id: "torn", look: "a jagged hole" }] }] } as Plan;
    const brief = castUser({ ...plan, cast: [...plan.cast, ...stateMembers(plan)] }, undefined, "kite");
    expect(brief.match(/IT FLIES: do NOT draw its flying string/g)?.length).toBe(2);
    expect(brief).toMatch(/its main body filling 60–90% of the viewBox/);
  });
});
