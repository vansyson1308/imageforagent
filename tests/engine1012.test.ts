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
import { measuredProblems, recognitionProblems } from "@/lib/services/director/publishGate";
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
    expect(recognitionProblems({ ...summary, stopAfter: undefined }).join(" ")).toMatch(/the key object #furin is not recognised on its own \(a viewer saw "a white flower on a stick"\)/);
  }, 120_000);

  it("without a vision model the gate says so and reports “not checked” (null), which also blocks publishing", async () => {
    const { runId, summary } = await castOnly(recognizingCrew(["x"], []), false);
    expect(summary.propRecognition?.map((r) => r.ok)).toEqual([null, null]);
    expect((await prisma.directorStep.findFirst({ where: { runId, action: "recognize:skipped" } }))?.outputSummary).toMatch(/no vision model/);
    expect(recognitionProblems({ ...summary, stopAfter: undefined }).join(" ")).toMatch(/#furin was not checked by the recognition gate/);
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
    expect(propVerdict(a, check({ parts: ["glass bell", "clapper"] }))).toMatchObject({ ok: false, why: "2/4 parts seen (need 3)" });
    // parts Nano invents (not in the anatomy) don't count
    expect(propVerdict(a, check({ parts: ["glass bell", "ribbon", "bow"] })).ok).toBe(false);
    // a generic look-alike fails whatever else was said ("gift box", "spatula")
    expect(propVerdict(a, check({ category: true, parts: ["glass bell", "clapper", "string"], lookalike: true }))).toMatchObject({ ok: false, why: "named a look-alike" });
    // a later state passes only when it was drawn and its visible change is named
    expect(propVerdict(a, check({ category: true, stateChange: false }), { saw: saw("wind chime"), state: ringing() })).toMatchObject({ ok: false, identity: true, why: "category named; state change NOT named" });
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
    expect(propVerdict(k.anatomy, check({ category: true, stateChange: true }), { saw: plainKite, state: { ...patched, drawn: false } })).toMatchObject({ ok: false, identity: true, why: "category named; state NOT drawn (the base drawing stands in)" });
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

describe("Round 4 · a miss keeps the best drawing of the round, not the last; a name with the category overrules Nano's look-alike flag", () => {
  it("Nano flags “kite” a look-alike: overruled (the viewer's name holds a category head noun and no look-alike's)", async () => {
    const { propVerdict } = await import("@/lib/services/director/recognize");
    const kite = { category: ["red diamond kite", "toy kite"], parts: [{ part: "sail", look: "red diamond" }, { part: "frame", look: "cross" }, { part: "tail", look: "bows" }], notLike: ["gift box with ribbon", "picture frame", "kite-shaped cookie"], states: [] };
    expect(propVerdict(kite, check({ category: true, lookalike: true }), { saw: { name: "kite", description: "a diamond-shaped kite with orange wings" } }).ok).toBe(true);
    expect(propVerdict(kite, check({ category: true, lookalike: true }), { saw: { name: "picture frame", description: "a red diamond frame, like a kite" } }).ok).toBe(false);
    expect(propVerdict(kite, check({ category: true }), { saw: { name: "kite-shaped cookie", description: "a cookie" } }).ok).toBe(false);
  });

  it("the ringing state is read as the object (not its change) first, then the redraws get worse: the first drawing is kept", async () => {
    const log: string[] = [];
    const worse = RINGING.replace("</symbol>", '<circle cx="380" cy="20" r="6" fill="#123456"/></symbol>');
    const sightings = ["a glass wind chime", "a glass wind chime", ...Array(8).fill("abstract shape")];
    const checks = (user: string) => (/No state is checked/.test(user) ? check({ category: true }) : /named it: "a glass wind chime"/.test(user) ? check({ category: true, stateChange: false }) : check({ category: false }));
    const { runId, projectId, summary } = await castOnly(anatomyCrew(sightings, checks, log, Array(4).fill(worse)));
    expect(summary.propRecognition?.[1]).toMatchObject({ symbol: "furin--ringing", ok: false, saw: "a glass wind chime", redraws: MAX_REDRAWS });
    const defs = (await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).artworkDefs ?? "";
    const { splitLibrary } = await import("@/lib/services/director/svgTools");
    expect(splitLibrary(defs).symbols.get("furin--ringing")).not.toContain("#123456");
    const steps = await prisma.directorStep.findMany({ where: { runId }, orderBy: { seq: "asc" } });
    expect(steps.find((s) => s.action === "recognize:kept-best")?.outputSummary).toMatch(/#furin--ringing: kept the best drawing of the round \(the viewer saw "a glass wind chime"\)/);
  }, 120_000);
});

/* ---------- D77 (owner 2026-10-12 evening): engine-drawn states, one look, the recognition override ---------- */

describe("D77 · prop state transforms: the engine tears and patches the APPROVED kite (round 4, #kite fc34c57b116c)", () => {
  const r4 = JSON.parse(readFileSync("docs/hackathon/evidence/preview-2026-10-12-r4/v2-kite-trace.json", "utf8")) as { bible: Plan; library: string };
  const px = async (png: Buffer, fx: number, fy: number) => {
    const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const i = (Math.round(fy * info.height) * info.width + Math.round(fx * info.width)) * info.channels;
    return [data[i], data[i + 1], data[i + 2]];
  };

  it("tear = a hole clipped THROUGH the kite (what is behind shows), with a flap; patch = a white stitched patch on the same spot; the base and every other symbol stay byte-identical", async () => {
    const { applyCastEdits, findSpot } = await import("@/lib/services/director/stateTransforms");
    const { castHashes } = await import("@/lib/services/director/series");
    const { renderAlone, RECOGNIZE_BACKGROUND } = await import("@/lib/services/director/recognize");
    const before = castHashes(r4.bible.cast, r4.library);
    expect(before.find((h) => h.id === "kite")?.sha).toBe("fc34c57b116c");
    const out = await applyCastEdits(r4.bible.cast, r4.library, [{ prop: "kite", state: "torn", op: "tear" }, { prop: "kite", state: "patched", op: "patch" }]);
    expect(() => sanitizeSvg(out.library, "defs")).not.toThrow();
    expect(out.changed).toEqual(["kite--torn", "kite--patched"]);
    const after = castHashes(out.cast, out.library);
    for (const h of after) if (!out.changed.includes(h.id)) expect(h.sha, h.id).toBe(before.find((b) => b.id === h.id)?.sha);
    expect(after.find((h) => h.id === "kite--starred")?.sha).toBe("94cf223f4c4d");
    // the spot, in the kite's 400-unit viewBox, and what each state shows there (rendered alone on the plain background)
    const spot = (await findSpot(out.library, "kite"))!;
    expect(spot).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
    const at = (v: number) => (Math.round(1080 * 0.86) * (v / 400) + (1080 - Math.round(1080 * 0.86)) / 2) / 1080;
    const [fx, fy] = [at(spot.x), at(spot.y)];
    const base = await px(await renderAlone(out.library, "kite", "16:9", canvas), fx, fy);
    const torn = await px(await renderAlone(out.library, "kite--torn", "16:9", canvas), fx, fy);
    const patched = await px(await renderAlone(out.library, "kite--patched", "16:9", canvas), fx, fy);
    const bg = [1, 3, 5].map((i) => parseInt(RECOGNIZE_BACKGROUND.slice(i, i + 2), 16));
    expect(base[0]).toBeGreaterThan(base[1] + 80); // the red sail
    expect(Math.max(...torn.map((v, i) => Math.abs(v - bg[i])))).toBeLessThan(12); // the background, through the hole
    expect(Math.min(...patched)).toBeGreaterThan(200); // white cloth
    // deterministic: the same base gives the same markup
    const again = await applyCastEdits(r4.bible.cast, r4.library, [{ prop: "kite", state: "torn", op: "tear" }, { prop: "kite", state: "patched", op: "patch" }]);
    expect(again.library).toBe(out.library);
  });

  it("single = one look: the state symbols are removed and the member has no states (bánh chưng round 4, #banh-chung 82007704a615)", async () => {
    const { applyCastEdits } = await import("@/lib/services/director/stateTransforms");
    const { castHashes } = await import("@/lib/services/director/series");
    const bc = JSON.parse(readFileSync("docs/hackathon/evidence/preview-2026-10-12-r4/v2-banh-chung-trace.json", "utf8")) as { bible: Plan; library: string };
    const out = await applyCastEdits(bc.bible.cast, bc.library, [{ prop: "banh-chung", op: "single" }]);
    expect(out.removed.sort()).toEqual(["banh-chung--cooked", "banh-chung--cooking", "banh-chung--wrapped"]);
    expect(out.cast.find((c) => c.id === "banh-chung")?.states).toBeUndefined();
    expect(castHashes(out.cast, out.library).find((h) => h.id === "banh-chung")?.sha).toBe("82007704a615");
    await expect(applyCastEdits(bc.bible.cast, bc.library, [{ prop: "banh-chung", state: "torn", op: "tear" }])).rejects.toThrow(/has no state "torn"/);
  });

  it("end to end: a cast-only preview on an approved cast with edits — the planner gets the edited cast, the edited states are checked again but never handed to the Cast", async () => {
    const { loadCastFromRun, editCastFromRun } = await import("@/lib/services/director/series");
    const preview = await castOnly(recognizingCrew(["a glass wind chime"], []));
    const calls: string[] = [];
    const base = recognizingCrew(["a glass wind chime"], []);
    const crew: MockHandler = (m, o, i) => {
      calls.push(m[0].content.match(/^ROLE: (\w+)/)?.[1] ?? "?");
      return base(m, o, i);
    };
    const { replaceSymbol } = await import("@/lib/services/director/recognize");
    // a solid body to patch (the scripted crew's fūrin is a thin flower: no spot fits on it)
    const solid = `<symbol id="furin" viewBox="0 0 400 400"><rect x="40" y="40" width="320" height="320" rx="30" fill="#4a90c2"/>${Array.from({ length: 11 }, (_, k) => `<circle cx="${70 + k * 25}" cy="330" r="6" fill="#ffffff"/>`).join("")}</symbol>`;
    const loaded = await loadCastFromRun(preview.runId);
    const castFrom = await editCastFromRun({ ...loaded, library: replaceSymbol(loaded.library, "furin", solid, new Map()) }, [{ prop: "furin", state: "ringing", op: "patch" }]);
    expect(castFrom.edits?.changed).toEqual(["furin--ringing"]);
    expect(castFrom.recognition.map((r) => r.symbol)).toEqual(["furin"]);
    const p = await prisma.project.create({ data: { name: "engine1012-edits" } });
    created.push(p.id);
    const d = { provider: new MockLlmProvider(crew), models: MOCK_MODELS, visionAvailable: true, modelNotes: [], tavily: null, ceiling: DEFAULT_BUDGET };
    const req = { projectId: p.id, story: "Yui hangs a wind chime. It rings. Grandma smiles. The summer ends.", language: "en", style: "storybook", critic: true, research: false, maxShots: 4, stopAfter: "cast" as const, castFrom };
    const { runId, budget } = await createRun(req, d);
    const ctrl = registerRun(runId);
    let summary;
    try {
      summary = await executeRun(runId, req, d, budget, () => {}, ctrl.signal);
    } finally {
      unregisterRun(runId);
    }
    expect(summary.status).toBe("done");
    expect(calls).not.toContain("CAST");
    const steps = await prisma.directorStep.findMany({ where: { runId }, orderBy: { seq: "asc" } });
    expect(steps.find((s) => s.action === "cast-edits")?.outputSummary).toMatch(/#furin--ringing = patch of #furin/);
    expect(steps.find((s) => s.action === "recognize:carried")?.outputSummary).toMatch(/#furin recognised/);
    // the edited state was looked at again (the viewer's words go to the checklist)
    expect(steps.some((s) => s.action === "recognize:verdict" && /#furin--ringing/.test(s.outputSummary ?? ""))).toBe(true);
    expect(summary.propRecognition?.map((r) => r.symbol)).toEqual(["furin", "furin--ringing"]);
  }, 180_000);

  it("the planner's own anatomy is dropped: only Ultra's ANATOMY call (or a reused approved cast) gives one (tegami preview: category \"prop\")", async () => {
    const log: string[] = [];
    const crew: MockHandler = (m, o, i) => {
      const role = m[0].content.match(/^ROLE: (\w+)/)?.[1];
      if (role === "DIRECTOR") {
        const p = furinPlan("Yui hangs a wind chime. It rings. Grandma smiles. The summer ends.");
        return { ...p, cast: p.cast.map((c) => (c.id === "furin" ? { ...c, anatomy: { category: ["prop"], parts: [{ part: "body", look: "a body" }, { part: "flap", look: "a flap" }, { part: "letter", look: "a letter" }], notLike: [], states: [] } } : c)) };
      }
      if (role === "ANATOMY") log.push("anatomy call");
      return anatomyCrew(["a glass wind chime"], [check({ category: true })], log)(m, o, i);
    };
    const { runId } = await castOnly(crew);
    expect(log).toContain("anatomy call");
    const run = await prisma.directorRun.findUniqueOrThrow({ where: { id: runId } });
    expect((JSON.parse(run.bible!) as Plan).cast.find((c) => c.id === "furin")?.anatomy?.category).toEqual(FURIN_ANATOMY.category);
  }, 120_000);
});

describe("D77 · the recognition gate is a model's judgement: owner + QC may approve past it by eye; measured gates stay", () => {
  it("recognition problems are no longer measured problems; the checklist carries the viewer's words and a Recognition override line that needs both names", async () => {
    const { checklistTemplate, recognitionOverride, recognitionProblems, measuredProblems: measured } = await import("@/lib/services/director/publishGate");
    const s = { rendered: 10, shots: 10, gateFailures: 0, durationSec: 60, propRecognition: [{ symbol: "banh-chung", prop: "banh-chung", state: null, ok: false, saw: "window", redraws: 4 }] };
    expect(measured("done", s)).toEqual([]);
    expect(recognitionProblems(s)).toEqual(['the key object #banh-chung is not recognised on its own (a viewer saw "window")']);
    const md = checklistTemplate({ slug: "v2-banh-chung", projectId: "p", runId: "r", commit: "abc1234", hero: "banh-chung", shots: [], recognition: ['#banh-chung: NOT recognised — the viewer said "window"'] });
    expect(md).toMatch(/## Key-object recognition \(a model's judgement, not a measured gate\)/);
    expect(md).toMatch(/- #banh-chung: NOT recognised — the viewer said "window"/);
    expect(recognitionOverride(md)).toBe(false);
    const sign = (line: string) => recognitionOverride(md.replace("Recognition override: none", `Recognition override: ${line}`));
    expect(sign("APPROVED by owner vansyson and QC lead")).toBe(true);
    expect(sign("APPROVED by owner vansyson")).toBe(false);
    expect(sign("APPROVED by owner <name> and QC <name>")).toBe(false);
    // a measured problem still blocks, whatever is signed
    expect(measured("done", { ...s, gateFailures: 1 })).toEqual(["1 shot(s) still fail a measured gate"]);
  });
});

/* ---------- D78 (owner + QC 2026-10-12 night): the starred kite, Shorts' length, tegami as the Japanese showcase ---------- */

describe("D78 · #kite--starred = the approved patched red kite + a big gold star (engine only, no model call)", () => {
  const r5 = JSON.parse(readFileSync("docs/hackathon/evidence/preview-2026-10-12-r5/v2-kite-trace.json", "utf8")) as { bible: Plan; library: string };

  it("star on #kite--patched: every other symbol keeps its approved hash, the star is gold on the patch, deterministic", async () => {
    const { applyCastEdits, findSpot } = await import("@/lib/services/director/stateTransforms");
    const { castHashes } = await import("@/lib/services/director/series");
    const { renderAlone } = await import("@/lib/services/director/recognize");
    const before = castHashes(r5.bible.cast, r5.library);
    expect(before.find((h) => h.id === "kite--patched")?.sha).toBe("c47c749f99e4");
    const out = await applyCastEdits(r5.bible.cast, r5.library, [{ prop: "kite", state: "starred", op: "star", on: "patched" }]);
    expect(() => sanitizeSvg(out.library, "defs")).not.toThrow();
    const after = castHashes(out.cast, out.library);
    for (const h of after) if (h.id !== "kite--starred") expect(h.sha, h.id).toBe(before.find((b) => b.id === h.id)?.sha);
    expect(out.library).toMatch(/<symbol id="kite--starred"[^>]*><use href="#kite--patched"/);
    expect(out.report[0]).toMatch(/#kite--starred = star of #kite on #kite--patched/);
    const spot = (await findSpot(out.library, "kite"))!;
    const at = (v: number) => (Math.round(1080 * 0.86) * (v / 400) + (1080 - Math.round(1080 * 0.86)) / 2) / 1080;
    const png = await renderAlone(out.library, "kite--starred", "16:9", canvas);
    const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const i = (Math.round(at(spot.y) * info.height) * info.width + Math.round(at(spot.x) * info.width)) * info.channels;
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    expect(r).toBeGreaterThan(200);
    expect(g).toBeGreaterThan(150);
    expect(b).toBeLessThan(110); // gold, at the centre of the patch
    expect((await applyCastEdits(r5.bible.cast, r5.library, [{ prop: "kite", state: "starred", op: "star", on: "patched" }])).library).toBe(out.library);
    await expect(applyCastEdits(r5.bible.cast, r5.library, [{ prop: "kite", state: "starred", op: "star", on: "mended" }])).rejects.toThrow(/no drawing #kite--mended/);
  });
});

describe("D78 · a 9:16 Short runs 30–60 s; a 16:9 showcase film 45–90 s", () => {
  it("tegami's 43.4 s passes as a Short and would fail as a showcase film; the edges hold", async () => {
    const { durationWindow, measuredProblems: measured } = await import("@/lib/services/director/publishGate");
    const ok = { rendered: 7, shots: 7, gateFailures: 0 };
    expect(durationWindow("9:16")).toMatchObject({ min: 30, max: 60 });
    expect(durationWindow("16:9")).toMatchObject({ min: 45, max: 90 });
    expect(measured("done", { ...ok, durationSec: 43.4 }, "9:16")).toEqual([]);
    expect(measured("done", { ...ok, durationSec: 43.4 })).toEqual(["film is 43.4 s (a showcase film runs 45–90 s)"]);
    expect(measured("done", { ...ok, durationSec: 29.9 }, "9:16")).toEqual(["film is 29.9 s (a 9:16 Short runs 30–60 s)"]);
    expect(measured("done", { ...ok, durationSec: 60.5 }, "9:16")).toEqual(["film is 60.5 s (a 9:16 Short runs 30–60 s)"]);
    expect(measured("done", { ...ok, durationSec: 60 }, "9:16")).toEqual([]);
  });

  it("the v2 showcase is kite, bánh chưng and tegami (fūrin dropped); tegami is a 9:16 Short from the owner's package", async () => {
    const { SHOWCASE_STORIES_V2 } = await import("../scripts/director/showcase");
    expect(SHOWCASE_STORIES_V2.map((s) => s.slug)).toEqual(["v2-kite", "v2-banh-chung", "v2-tegami"]);
    const t = SHOWCASE_STORIES_V2.find((s) => s.slug === "v2-tegami")!;
    expect(t).toMatchObject({ language: "ja", aspect: "9:16", figure: "adult", pilot: "PILOT01_tegami" });
    expect(t.narration).toHaveLength(8);
    expect(t.brief).toMatch(/喫茶ひだまり/);
    const bc = SHOWCASE_STORIES_V2.find((s) => s.slug === "v2-banh-chung")!;
    expect(bc.brief).toMatch(/LAST shot the bánh chưng sits on a small wooden table in the front room/);
  });
});

/* ---------- D79 (take day 2026-10-13): one time-of-day reading for the Artist and the critic; a film's floor ---------- */

describe("D79 · dawn is day and \"dark\" alone is not night (bánh chưng take 1, shots 10 and 11)", () => {
  const t1 = JSON.parse(readFileSync("docs/hackathon/evidence/takes/v2-banh-chung-cmv5xjlgc005t2aqt3v8r4bh8/trace.json", "utf8")) as { bible: Plan; summary: { castSetTimes: Record<string, string> } };
  it("shot 10 (\"at dawn\") gets the day-lit courtyard; shot 11 (\"dark corner folds\", dawn light) is day, not night", async () => {
    const { shotTime, setForShot, plannedBucket } = await import("@/lib/services/director/fidelity");
    const times = new Map(Object.entries(t1.summary.castSetTimes));
    const s10 = t1.bible.shots[9];
    const s11 = t1.bible.shots[10];
    expect(s10.description).toMatch(/at dawn/);
    expect(s11.description).toMatch(/dark corner folds/);
    expect(shotTime(s10)).toBe("day");
    expect(setForShot(s10, "courtyard", times)).toBe("courtyard--day");
    expect(shotTime(s11)).toBe("day");
    expect(plannedBucket(s11)).toBe("day");
    // night stays night
    expect(shotTime({ scene: "Đêm giao thừa", description: "Fireworks over the rooftops at midnight" })).toBe("night");
    expect(shotTime({ scene: "x", description: "the darkness of the night street" })).toBe("night");
  });
});

describe("D79 · a film under its format's floor holds every shot a little longer (bánh chưng take 1: 43.2 s < 45 s)", () => {
  it("padHolds spreads the missing seconds over every shot, ≤ 3 s each, and leaves a long enough film alone", async () => {
    const { padHolds, shotDuration } = await import("@/lib/services/director/artist");
    const p = planSchema.parse(demoPlan("One. Two. Three. Four. Five. Six. Seven. Eight. Nine. Ten. Eleven.", 11));
    const plan = { ...p, shots: p.shots.map((s) => ({ ...s, durationSec: 2 })) };
    const frames = plan.shots.map((_, i) => ({ index: i + 1, voiceDuration: 3.2, voiceOffset: 0.3 }));
    const total = (pl: typeof plan) => pl.shots.reduce((a, s, i) => a + shotDuration(s, frames[i]), 0);
    expect(total(plan)).toBeCloseTo(42.9, 1); // 11 × (0.3 + 3.2 + 0.4)
    const out = padHolds(plan, frames, 46);
    expect(out.before).toBeCloseTo(42.9, 1);
    expect(out.added).toBeGreaterThan(0.2);
    expect(out.added).toBeLessThanOrEqual(3);
    expect(total(out.plan)).toBeGreaterThanOrEqual(46);
    expect(padHolds(out.plan, frames, 46).added).toBe(0);
  });
});

/* ---------- D80 (take day 2026-10-13): the table under the bánh chưng is the engine's (owner + QC D78) ---------- */

describe("D80 · an object the shot says rests on a table gets the table, drawn by the engine (bánh chưng take 1, shot 11)", () => {
  const t1 = JSON.parse(readFileSync("docs/hackathon/evidence/takes/v2-banh-chung-cmv5xjlgc005t2aqt3v8r4bh8/trace.json", "utf8")) as {
    bible: Plan;
    library: string;
    steps: Array<{ action: string; shotIndex: number | null; output: string | null }>;
  };
  const shot = t1.bible.shots[10];
  const drawn = t1.steps.find((s) => s.shotIndex === 11 && s.action === "revise")!.output!;

  it("reads \"on the table\" in EN, VI and JA; an altar (bàn thờ), a beach or a street is not a table", async () => {
    const { restsOnTable } = await import("@/lib/services/director/restSurface");
    expect(shot.description).toMatch(/insert on the small wooden table/);
    expect(restsOnTable(shot.description)).toBe(true);
    expect(restsOnTable("The kite lies flat on the kitchen table")).toBe(true);
    expect(restsOnTable("Chiếc bánh chưng nằm trên bàn giữa phòng khách")).toBe(true);
    expect(restsOnTable("手紙はテーブルの上にある")).toBe(true);
    expect(restsOnTable("Trên bàn thờ là chiếc bánh chưng")).toBe(false);
    expect(restsOnTable("The kite lies on the sand of the beach")).toBe(false);
    expect(restsOnTable("Haru-san stands on the stone street")).toBe(false);
  });

  it("validateDrawing puts a wooden table under the parcel: behind it, wider than it, its top at the parcel's base; the parcel is untouched", async () => {
    const opts = {
      castDefs: t1.library,
      symbols: t1.bible.cast.map((c) => c.id),
      aspectRatio: "16:9",
      shot,
      index: 11,
      canvas,
      fps: 12,
      characters: t1.bible.cast.filter((c) => c.kind === "character").map((c) => c.id),
      sets: t1.bible.cast.filter((c) => c.kind === "set").map((c) => c.id),
      props: ["banh-chung"],
      strict: false,
    };
    const out = await validateDrawing(drawn, opts);
    sanitizeSvg(out.svg, "frame");
    expect(out.checks!.facts.join(" ")).toMatch(/#banh-chung rests on a table drawn by the engine/);
    expect(out.svg.indexOf('data-rest="table"')).toBeGreaterThan(-1);
    expect(out.svg.indexOf('data-rest="table"')).toBeLessThan(out.svg.indexOf('href="#banh-chung"'));
    // a revision of the frame (it carries the engine's table) gets one table, redrawn, never two
    const again = await validateDrawing("```svg\n" + out.svg + "\n```", opts);
    expect(again.svg.match(/data-rest=/g)).toHaveLength(1);
    // measured on the render: wood under the parcel's base on both sides, the parcel's own pixels unchanged
    const { tableUnder } = await import("@/lib/services/director/restSurface");
    const { visibleBody, withoutUses } = await import("@/lib/services/director/svgTools");
    const bare = out.svg.replace(/<g\b[^>]*data-rest[^>]*>[\s\S]*?<\/g>/, "");
    const before = await renderArtwork(t1.library, bare, "16:9", "1K");
    const { body } = await visibleBody(before, await renderArtwork(t1.library, withoutUses(bare, "banh-chung"), "16:9", "1K"));
    expect(tableUnder(bare, "banh-chung", body!, canvas)!.svg).toBe(out.svg);
    const a = await sharp(before).raw().toBuffer({ resolveWithObject: true });
    const b = await sharp(out.png).raw().toBuffer({ resolveWithObject: true });
    const px = (img: typeof a, x: number, y: number) => {
      const i = (Math.round(y * img.info.height) * img.info.width + Math.round(x * img.info.width)) * img.info.channels;
      return [img.data[i], img.data[i + 1], img.data[i + 2]];
    };
    const cx = (body!.x0 + body!.x1) / 2;
    const w = body!.x1 - body!.x0;
    for (const x of [cx - w * 0.65, cx + w * 0.65]) {
      const [r, g, bl] = px(b, x, body!.y1 + 0.025);
      expect(r).toBeGreaterThan(g); // warm wood, not the green-blue floor
      expect(g).toBeGreaterThan(bl);
      expect(px(b, x, body!.y1 + 0.025)).not.toEqual(px(a, x, body!.y1 + 0.025));
    }
    expect(px(b, cx, (body!.y0 + body!.y1) / 2)).toEqual(px(a, cx, (body!.y0 + body!.y1) / 2));
    expect(px(b, cx, 0.05)).toEqual(px(a, cx, 0.05));
  }, 60000);

  it("a shot with people in it, or a prop not said to be on a table, gets no table", async () => {
    const opts = { castDefs: t1.library, symbols: t1.bible.cast.map((c) => c.id), aspectRatio: "16:9", index: 11, canvas, fps: 12, characters: ["an", "grandma"], props: ["banh-chung"], strict: false };
    const plain = await validateDrawing(drawn, { ...opts, shot: { ...shot, description: "Close-up insert: the square wrapped parcel, dawn light." } });
    expect(plain.svg).not.toMatch(/data-rest/);
    const wide = await validateDrawing(drawn, { ...opts, shot: { ...shot, shotType: "Wide shot", cast: ["front-room", "an", "banh-chung"] } });
    expect(wide.svg).not.toMatch(/data-rest/);
  }, 60000);

  it("a parcel nested in a transformed group gets its table before that group (in frame coordinates)", async () => {
    const { tableUnder } = await import("@/lib/services/director/restSurface");
    const svg = '<rect width="1920" height="1080" fill="#334"/><g transform="translate(10 0)"><g><use href="#banh-chung" x="600" y="200" width="700" height="700"/></g></g>';
    const out = tableUnder(svg, "banh-chung", { x0: 0.32, y0: 0.18, x1: 0.68, y1: 0.83 }, canvas)!;
    expect(out.svg.indexOf("<g data-rest")).toBe(svg.indexOf('<g transform'));
    sanitizeSvg(out.svg, "frame");
  });
});

/* ---------- D81 (take day 2026-10-13): a zoom on a 9:16 canvas stays on the canvas (tegami take 1, shots 2–6) ---------- */

describe("D81 · every camera move keeps the painting on the canvas, whatever its aspect", () => {
  it("drift and dolly (zoom only) centre on the canvas's own centre; the painting covers the whole frame at every key time", async () => {
    const { buildShotMotion } = await import("@/lib/services/director/camera");
    const { motionSpecSchema } = await import("@/lib/validation/motionSchema");
    const { prepareMotion, evaluateMotionAt } = await import("@/lib/services/motion/evaluate");
    for (const cv of [{ w: 1080, h: 1920 }, { w: 1920, h: 1080 }, { w: 1080, h: 1080 }, { w: 1080, h: 1350 }]) {
      for (const [i, shotType] of [[2, "Medium shot"], [3, "Close-up"], [4, "Wide shot"], [5, "Wide shot"], [6, "Pan"], [7, "Tilt up"], [8, "Zoom out"]] as const) {
        const motion = motionSpecSchema.parse(buildShotMotion({ index: i, shotType, duration: 6, fps: 12, canvas: cv, background: "#efe2c6" }));
        const prep = prepareMotion(motion);
        for (const t of [0, motion.poster ?? 3, 6]) {
          const { place } = evaluateMotionAt(prep, t);
          const [x, y] = place.at;
          // the art rect (cv.w × cv.h, centred on place.at, scaled) covers [0, w] × [0, h]
          expect(x - (cv.w / 2) * place.scale, `${cv.w}×${cv.h} ${shotType} t=${t}`).toBeLessThanOrEqual(0.5);
          expect(x + (cv.w / 2) * place.scale).toBeGreaterThanOrEqual(cv.w - 0.5);
          expect(y - (cv.h / 2) * place.scale).toBeLessThanOrEqual(0.5);
          expect(y + (cv.h / 2) * place.scale).toBeGreaterThanOrEqual(cv.h - 0.5);
        }
      }
    }
  });
});

/* ---------- D82–D84 (owner + QC final decisions, 2026-10-13) ---------- */

describe("D82 · \"golden dusk\" on a golden-lit set is golden hour, the day bucket (kite take 1, shot 11)", () => {
  const t1 = JSON.parse(readFileSync("docs/hackathon/evidence/takes/v2-kite-cmv5x8pqj00012aqtw2ld6ad3/trace.json", "utf8")) as {
    bible: Plan;
    summary: { castSetTimes: Record<string, string> };
    steps: Array<{ action: string; shotIndex: number | null; output: string | null }>;
  };
  const times = new Map(Object.entries(t1.summary.castSetTimes));
  const s11 = t1.bible.shots[10];
  it("the plan and the render agree: the critic's \"day, not dusk\" is not off-plan; a night note, or a dusk-lit set, still is", async () => {
    const { goldenHour, plannedBucket, enforceFidelity, fidelityBrief } = await import("@/lib/services/director/fidelity");
    expect(s11.description).toMatch(/^Golden dusk glows over the sand/);
    expect(times.get("brighton-seafront")).toBe("golden");
    expect(goldenHour(s11, times)).toBe(true);
    expect(plannedBucket(s11, times)).toBe("day");
    expect(plannedBucket(s11)).toBe("dusk"); // without the set's light, the words alone stay dusk
    expect(fidelityBrief(t1.bible, s11, times)).toMatch(/DAY bucket[^.]*the set's golden light is golden hour/);
    // the take's own verdicts on shot 11: off-plan before, golden hour now
    const judged = t1.steps.filter((s) => s.action === "score" && s.shotIndex === 11).map((s) => critiqueSchema.parse(JSON.parse(s.output!)));
    expect(judged.length).toBeGreaterThan(0);
    const raw = { ...judged[0], fidelity: { time: "wrong" as const, place: "ok" as const, action: "ok" as const, note: "brightness indicates day, not dusk" } };
    expect(offPlanAxes(enforceFidelity(raw))).toEqual(["time"]);
    expect(offPlanAxes(enforceFidelity(raw, { goldenHour: true }))).toEqual([]);
    expect(enforceFidelity(raw, { goldenHour: true }).fidelity?.note).toMatch(/golden hour, the day bucket: not off-plan, D82/);
    // a night reading is still wrong, and so is a golden dusk on a set lit for dusk
    expect(offPlanAxes(enforceFidelity({ ...raw, fidelity: { ...raw.fidelity, note: "it looks like night, not dusk" } }, { goldenHour: true }))).toEqual(["time"]);
    expect(goldenHour(s11, new Map([["brighton-seafront", "dusk"]]))).toBe(false);
    expect(goldenHour({ ...s11, scene: "Homeward", description: "Dusk falls over the sand" }, times)).toBe(false);
  });
});

describe("D83 · a held prop over a face moves down to the chest (tegami take 2, shot 5)", () => {
  const t2 = JSON.parse(readFileSync("docs/hackathon/evidence/takes/v2-tegami-cmv5zd43a00012aqjvcwijeov/trace.json", "utf8")) as {
    bible: Plan;
    library: string;
    kits: string;
    steps: Array<{ action: string; role: string; shotIndex: number | null; output: string | null }>;
  };
  it("every drawing the take rejected for the covered face now passes, the envelope at the chest; the face shows", async () => {
    const { kitsFromJson } = await import("@/lib/services/director/series");
    const rejected = t2.steps.filter((s) => s.shotIndex === 5 && s.role === "artist" && s.output && /repair|revise/.test(s.action));
    expect(rejected.length).toBeGreaterThanOrEqual(4);
    const opts = {
      castDefs: t2.library,
      symbols: t2.bible.cast.map((c) => c.id),
      aspectRatio: "9:16",
      shot: t2.bible.shots[4],
      index: 5,
      canvas: { w: 1080, h: 1920 },
      fps: 12,
      characters: t2.bible.cast.filter((c) => c.kind === "character").map((c) => c.id),
      sets: t2.bible.cast.filter((c) => c.kind === "set").map((c) => c.id),
      props: t2.bible.cast.filter((c) => c.kind === "prop").map((c) => c.id),
      kits: kitsFromJson(t2.kits),
    };
    for (const r of rejected) {
      // strict, like every attempt but the last: it no longer throws for the covered face
      const d = await validateDrawing(r.output!, opts);
      expect(d.checks!.problems).toEqual([]);
      expect(d.checks!.facts.join(" ")).toMatch(/#envelope moved off #elderly-gentleman's face to the chest/);
    }
  }, 180_000);

  it("chestPlacement: only a prop over the head moves, to just under it, shrunk only to stay in frame", async () => {
    const { chestPlacement } = await import("@/lib/services/director/artist");
    const head = { x0: 300, x1: 700, y0: 600, bottom: 900 };
    const cv = { w: 1080, h: 1920 };
    expect(chestPlacement({ x: 400, y: 700, w: 300, h: 300 }, head, cv)).toEqual({ x: 400, y: 938, w: 300, h: 300 });
    expect(chestPlacement({ x: 800, y: 700, w: 200, h: 200 }, head, cv)).toBeNull(); // beside the head: stays
    expect(chestPlacement({ x: 400, y: 1100, w: 300, h: 300 }, head, cv)).toBeNull(); // already at the chest
    const low = chestPlacement({ x: 300, y: 1500, w: 400, h: 400 }, { ...head, y0: 1400, bottom: 1700 }, cv)!;
    expect(low.y + low.h).toBeLessThanOrEqual(cv.h);
    expect(low.w).toBe(low.h);
  });
});

describe("D84 · single-shot redo: only the named shots are redrawn, on the take's project, plan and cast", () => {
  it("shotPatterns groups each shot's camera patterns (nested patterns included)", async () => {
    const { shotPatterns } = await import("@/lib/services/director/redo");
    // the walk steps are `actN-<who>-sK` (acting.ts): a redo that missed them dropped every other shot's walker (bánh chưng redo, shot 10)
    const defs = '<symbol id="hero"/>\n<pattern id="art-f1" x="0"><rect/><pattern id="f1-dots"><circle/></pattern></pattern>\n<pattern id="act1-hero-s0"><g/></pattern>\n<pattern id="act1-hero-s1"><g/></pattern>\n<pattern id="art-f12"><rect/></pattern>\n<pattern id="act12-elderly-gentleman-s0"><g/></pattern>\n<pattern id="tile"><rect/></pattern>';
    const m = shotPatterns(defs);
    expect([...m.keys()]).toEqual([1, 12]);
    expect(m.get(1)).toBe('<pattern id="art-f1" x="0"><rect/><pattern id="f1-dots"><circle/></pattern></pattern>\n<pattern id="act1-hero-s0"><g/></pattern>\n<pattern id="act1-hero-s1"><g/></pattern>');
    expect(m.get(12)).toBe('<pattern id="art-f12"><rect/></pattern>\n<pattern id="act12-elderly-gentleman-s0"><g/></pattern>');
    // and the ids the engine really writes are matched (no drift between acting.ts and the redo): kite take 2 shot 9, Maya walking
    const { actingLayer } = await import("@/lib/services/director/acting");
    const { kitsFromJson } = await import("@/lib/services/director/series");
    const k2 = JSON.parse(readFileSync("docs/hackathon/evidence/takes/v2-kite-cmv6fvwbe00012ao49z3wfu27/trace.json", "utf8")) as { kits: string; steps: Array<{ role: string; shotIndex: number | null; output: string | null }> };
    const walkSvg = extractSvgFragment(k2.steps.filter((x) => x.shotIndex === 9 && x.role === "artist" && x.output).at(-1)!.output!);
    const a = actingLayer({ index: 9, svg: walkSvg, kits: kitsFromJson(k2.kits), duration: 4, fps: 12, canvas });
    const steps = a.walks.flatMap((w) => w.patterns);
    expect(steps.length).toBeGreaterThan(1);
    expect(shotPatterns(`<pattern id="art-f9"><rect/></pattern>\n${steps.join("\n")}`).get(9)).toBe(`<pattern id="art-f9"><rect/></pattern>\n${steps.join("\n")}`);
  });

  it("mergeRedo swaps the redone shots' results into the take's summary", async () => {
    const { mergeRedo } = await import("@/lib/services/director/redo");
    const base = { status: "done", shots: 7, rendered: 7, firstPassOk: 3, repairs: 9, criticBefore: 5, criticAfter: 6, revisions: 6, lintErrors: 0, lintWarnings: 0, durationSec: 46.8, wallMs: 1, tokens: 1, costUsd: 0.08, continuity: ["c"], textCritic: false };
    const take = { ...base, gateFailures: 1, gateFailShots: [5], offPlan: [5], setless: [], belowFloor: [3, 5], shotScores: { 1: 8, 2: 7, 3: 4, 4: 9, 5: 3, 6: 7, 7: 6 }, actionNotes: { 5: "envelope over the face" }, propRecognition: [{ symbol: "envelope", prop: "envelope", state: null, ok: false, saw: "tag", redraws: 0 }], castSetTimes: { kissaten: "day" } };
    const fresh = { ...base, repairs: 2, revisions: 1, costUsd: 0.01, continuity: [], gateFailures: 0, gateFailShots: [], offPlan: [], setless: [], belowFloor: [], shotScores: { 5: 7 }, actionNotes: {} };
    const m = mergeRedo(take, fresh, [5], "take1");
    expect(m.gateFailures).toBe(0);
    expect(m.gateFailShots).toEqual([]);
    expect(m.offPlan).toEqual([]);
    expect(m.belowFloor).toEqual([3]);
    expect(m.shotScores).toEqual({ 1: 8, 2: 7, 3: 4, 4: 9, 5: 7, 6: 7, 7: 6 });
    expect(m.actionNotes).toEqual({});
    expect(m.criticAfter).toBe(6.86);
    expect(m.repairs).toBe(11);
    expect(m.costUsd).toBe(0.01);
    expect(m.continuity).toEqual(["c"]);
    expect(m.propRecognition).toEqual(take.propRecognition);
    expect(m.castSetTimes).toEqual({ kissaten: "day" });
    expect(m.redoOf).toEqual({ sourceRunId: "take1", shots: [5] });
    // a take from before gateFailShots: its failure count is kept (a redo never clears a failure it can't see)
    const { gateFailShots: _g, ...old } = take;
    void _g;
    expect(mergeRedo(old, fresh, [5], "take1").gateFailures).toBe(1);
  });

  it("a redo on a finished take: no plan, cast, voice, recognition or editor call; the other shots and their camera patterns stay byte-identical", async () => {
    const { loadCastFromRun } = await import("@/lib/services/director/series");
    const { shotPatterns } = await import("@/lib/services/director/redo");
    const preview = await castOnly(recognizingCrew(["a glass wind chime"], []));
    const p = await prisma.project.create({ data: { name: "engine1012-redo" } });
    created.push(p.id);
    const take: MockHandler = (m, o, i) => (m[0].content.match(/^ROLE: (\w+)/)?.[1] === "DIRECTOR" ? furinPlan("Yui hangs a wind chime. It rings. Grandma smiles. The summer ends.") : recognizingCrew(["never asked"], [])(m, o, i));
    const d = { provider: new MockLlmProvider(take), models: MOCK_MODELS, visionAvailable: true, modelNotes: [], tavily: null, ceiling: DEFAULT_BUDGET, floorRedraw: { enabled: false, reason: "test" } };
    const run = async (req: Parameters<typeof createRun>[0], deps: typeof d) => {
      const { runId, budget } = await createRun(req, deps);
      const ctrl = registerRun(runId);
      try {
        return { runId, summary: await executeRun(runId, req, deps, budget, () => {}, ctrl.signal) };
      } finally {
        unregisterRun(runId);
      }
    };
    const story = "Yui hangs a wind chime. It rings. Grandma smiles. The summer ends.";
    const t = await run({ projectId: p.id, story, language: "en", style: "storybook", critic: true, research: false, maxShots: 4, castFrom: await loadCastFromRun(preview.runId) }, d);
    expect(t.summary.status).toBe("done");
    expect(t.summary.gateFailShots).toBeDefined();
    const before = await prisma.frame.findMany({ where: { projectId: p.id }, orderBy: { index: "asc" } });
    const defsBefore = shotPatterns((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).artworkDefs ?? "");
    expect([...defsBefore.keys()].sort()).toEqual([1, 2, 3, 4]);
    // the redo of shot 2, as the route builds it
    const takeRun = await prisma.directorRun.findUniqueOrThrow({ where: { id: t.runId } });
    const calls: string[] = [];
    const artistAsks: string[] = [];
    const redoCrew: MockHandler = (m, o, i) => {
      const role = m[0].content.match(/^ROLE: (\w+)/)?.[1] ?? "?";
      calls.push(role);
      if (role === "ARTIST") artistAsks.push(m[m.length - 1].content);
      return take(m, o, i);
    };
    const r = await run(
      {
        projectId: p.id,
        story,
        language: "en",
        style: "storybook",
        critic: true,
        research: false,
        maxShots: 1,
        castFrom: await loadCastFromRun(t.runId),
        redo: { sourceRunId: t.runId, shots: [2], plan: planSchema.parse(JSON.parse(takeRun.bible!)), summary: JSON.parse(takeRun.summary!), notes: { 2: "only the wind chime, nobody else in the shot" } },
      },
      { ...d, provider: new MockLlmProvider(redoCrew) },
    );
    expect(r.summary.status).toBe("done");
    expect(r.summary.redoOf).toEqual({ sourceRunId: t.runId, shots: [2] });
    // D86 (a): QC's by-eye note is the Artist's first issue
    expect(artistAsks.length).toBeGreaterThan(0);
    expect(artistAsks[0]).toMatch(/FIX THIS[\s\S]*QC \(by eye, owner \+ QC\) on the take's version of this shot — get this right first: only the wind chime, nobody else in the shot/);
    expect(new Set(calls)).not.toContain("DIRECTOR");
    expect(new Set(calls)).not.toContain("CAST");
    expect(new Set(calls)).not.toContain("NAME_OBJECT");
    expect(new Set(calls)).not.toContain("EDITOR");
    expect(calls.length).toBeGreaterThan(0);
    const after = await prisma.frame.findMany({ where: { projectId: p.id }, orderBy: { index: "asc" } });
    expect(after.map((f) => f.index)).toEqual(before.map((f) => f.index));
    for (const i of [0, 2, 3]) {
      expect(after[i].imagePath).toBe(before[i].imagePath);
      expect(after[i].artworkSvg).toBe(before[i].artworkSvg);
      expect(after[i].motionSpec).toBe(before[i].motionSpec);
    }
    // only shot 2 was drawn and rendered by the redo
    const redoSteps = await prisma.directorStep.findMany({ where: { runId: r.runId } });
    expect([...new Set(redoSteps.map((s) => s.shotIndex).filter((x) => x !== null))]).toEqual([2]);
    expect(redoSteps.some((s) => s.shotIndex === 2 && /^render-(clip|still)$/.test(s.action))).toBe(true);
    expect(redoSteps.find((s) => s.action === "redo")?.outputSummary).toMatch(/shot\(s\) 2 redrawn/);
    const defsAfter = shotPatterns((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).artworkDefs ?? "");
    for (const i of [1, 3, 4]) expect(defsAfter.get(i)).toBe(defsBefore.get(i));
    expect(defsAfter.has(2)).toBe(true);
    // the redo's run can itself be the source of a second redo (its plan, cast and summary are kept)
    const redoRun = await prisma.directorRun.findUniqueOrThrow({ where: { id: r.runId } });
    expect(redoRun.bible && redoRun.library && redoRun.summary).toBeTruthy();
    expect(Object.keys(r.summary.shotScores ?? {}).map(Number).sort()).toEqual([1, 2, 3, 4]);
    // D85: a redo with a floor above the cut film holds every shot longer — re-rendered, measured on the real timeline
    const floor = Math.round((r.summary.durationSec + 2) * 10) / 10;
    const redoRun2 = await prisma.directorRun.findUniqueOrThrow({ where: { id: r.runId } });
    const r2 = await run(
      { projectId: p.id, story, language: "en", style: "storybook", critic: true, research: false, maxShots: 1, minFilmSec: floor, castFrom: await loadCastFromRun(r.runId), redo: { sourceRunId: r.runId, shots: [3], plan: planSchema.parse(JSON.parse(redoRun2.bible!)), summary: JSON.parse(redoRun2.summary!) } },
      { ...d, provider: new MockLlmProvider(redoCrew) },
    );
    expect(r2.summary.durationSec).toBeGreaterThanOrEqual(floor);
    expect((await prisma.directorStep.findFirst({ where: { runId: r2.runId, action: "hold-to-floor" } }))?.outputSummary).toMatch(/every shot holds 0\.\d s longer \(\d clip\(s\) re-rendered/);
  }, 300_000);
});

describe("D85 · a film under its floor holds every shot longer, measured on the real timeline (bánh chưng take 2: 41.4 s)", () => {
  it("the fixture reproduces the take's length; the smallest extra hold per shot brings it to the 46 s floor", async () => {
    const { buildTimeline, timelineDuration, timelineInputOf, floorHold, MAX_FLOOR_HOLD } = await import("@/lib/services/timeline");
    const fx = JSON.parse(readFileSync("docs/hackathon/evidence/takes/v2-banh-chung-cmv6g4rbd005g2ao4tni0bq5r/timeline-frames.json", "utf8")) as { playbackSpeed: number; frames: Parameters<typeof timelineInputOf>[0][] };
    const take = JSON.parse(readFileSync("docs/hackathon/evidence/takes/v2-banh-chung-cmv6g4rbd005g2ao4tni0bq5r/trace.json", "utf8")) as { summary: { durationSec: number }; steps: Array<{ action: string; outputSummary?: string | null }> };
    const frames = fx.frames.map((f) => timelineInputOf(f));
    // the take: 41.4 s cut, though padHolds (D79) projected 45.5 s — the projection missed the dissolves' overlap
    expect(timelineDuration(buildTimeline(frames, fx.playbackSpeed))).toBeCloseTo(take.summary.durationSec, 3);
    expect(take.steps.find((s) => s.action === "pad-holds")?.outputSummary).toMatch(/45\.5s, under its 46s floor/);
    const fit = floorHold(frames, fx.playbackSpeed, 46)!;
    expect(fit.before).toBeCloseTo(41.42, 1);
    expect(fit.after).toBeGreaterThanOrEqual(46);
    expect(fit.extra).toBeLessThanOrEqual(MAX_FLOOR_HOLD);
    // the smallest such hold
    const lengthened = (extra: number) => timelineDuration(buildTimeline(frames.map((f) => (f.clip ? { ...f, clip: { ...f.clip, frameCount: f.clip.frameCount + Math.round(extra * f.clip.fps), duration: f.clip.duration + extra } } : f)), fx.playbackSpeed + extra));
    expect(lengthened(fit.extra - 0.1)).toBeLessThan(46);
    expect(lengthened(fit.extra)).toBe(fit.after);
    // long enough already → nothing to do
    expect(floorHold(frames, fx.playbackSpeed, 41)).toBeNull();
  });
});

/* ---------- D86 (owner + QC by-eye notes, 2026-10-13 evening) ---------- */

describe("D86 (c) · two figures overlapping read as one standing on or inside the other — a measured gate", () => {
  it("figureOverlaps: stacked figures fail; side by side, a hug/lap, or a true over-the-shoulder (cut by a side) pass", async () => {
    const { figureOverlaps } = await import("@/lib/services/director/frameGates");
    const a = { id: "haru", box: { x0: 0.15, y0: 0.2, x1: 0.85, y1: 0.95 } };
    const b = { id: "gent", box: { x0: 0.2, y0: 0.35, x1: 0.8, y1: 1 } };
    expect(figureOverlaps([a, b], "Medium shot two-shot at the counter")).toEqual([{ a: "haru", b: "gent", share: expect.any(Number) }]);
    expect(figureOverlaps([{ ...a, box: { x0: 0.05, y0: 0.2, x1: 0.45, y1: 0.95 } }, { ...b, box: { x0: 0.55, y0: 0.3, x1: 0.95, y1: 1 } }], "Medium shot")).toEqual([]);
    expect(figureOverlaps([a, b], "An's head rests on Grandma's lap")).toEqual([]);
    expect(figureOverlaps([a, b], "Over-the-shoulder from behind Haru-san")).toHaveLength(1); // two whole figures stacked
    expect(figureOverlaps([{ ...a, box: { ...a.box, x0: 0 } }, b], "Over-the-shoulder from behind Haru-san")).toEqual([]); // the foreground figure cut by the frame
  });

  it("tegami take 3 shot 5: the drawing that stacked the gentleman and Haru now fails with a hint to spread them", async () => {
    const t3 = JSON.parse(readFileSync("docs/hackathon/evidence/takes/v2-tegami-cmv6gh0pd00a52ao42yvsog59/trace.json", "utf8")) as { bible: Plan; library: string; kits: string; steps: Array<{ action: string; role: string; shotIndex: number | null; output: string | null }> };
    const { kitsFromJson } = await import("@/lib/services/director/series");
    const stacked = t3.steps.filter((s) => s.shotIndex === 5 && s.role === "artist" && s.output).map((s) => s.output!).find((o) => /elderly-gentleman--hold-sad" x="156" y="100"/.test(o))!;
    expect(stacked).toBeTruthy();
    const d = await validateDrawing(stacked, {
      castDefs: t3.library,
      symbols: t3.bible.cast.map((c) => c.id),
      aspectRatio: "9:16",
      shot: t3.bible.shots[4],
      index: 5,
      canvas: { w: 1080, h: 1920 },
      fps: 12,
      characters: t3.bible.cast.filter((c) => c.kind === "character").map((c) => c.id),
      props: t3.bible.cast.filter((c) => c.kind === "prop").map((c) => c.id),
      kits: kitsFromJson(t3.kits),
      strict: false,
    });
    expect(d.checks!.problems.join(" ")).toMatch(/#elderly-gentleman and #haru overlap \(\d+% of the smaller one's box\).*spread them left and right/);
  }, 60_000);
});

describe("D86 (b) · a kite up in the sky with nobody holding it: the flyer holds the string (kite take 2, shot 9)", () => {
  const k2 = JSON.parse(readFileSync("docs/hackathon/evidence/takes/v2-kite-cmv6fvwbe00012ao49z3wfu27/trace.json", "utf8")) as { bible: Plan; library: string; kits: string; steps: Array<{ action: string; role: string; shotIndex: number | null; output: string | null }> };
  it("Maya, planned to walk, is posed hold; a shot with a holder or without the kite up is left alone; the string is drawn from her hand and the kite stays in the sky", async () => {
    const { kitsFromJson } = await import("@/lib/services/director/series");
    const { holdAirborne, airborneProps, flyingIn, variantDefs } = await import("@/lib/services/director/acting");
    const kits = kitsFromJson(k2.kits);
    const air = airborneProps(k2.bible.cast);
    expect(air).toEqual(["kite"]);
    const s9 = k2.bible.shots[8];
    expect(s9.acting).toEqual([{ who: "maya", pose: "walk", expression: "laugh" }]);
    expect(flyingIn(s9, air)).toEqual(["kite"]);
    const { plan, posed } = holdAirborne(k2.bible, kits, air);
    expect(posed).toContainEqual({ shot: 9, who: "maya", was: "walk" });
    expect(plan.shots[8].acting).toEqual([{ who: "maya", pose: "hold", expression: "laugh" }]);
    // shot 2 (the kite alone slams into the railings) has nobody to pose
    expect(posed.map((p) => p.shot)).not.toContain(2);
    expect(holdAirborne(plan, kits, air).posed).toEqual([]); // idempotent
    // the take's shot-9 drawing with Maya in the hold pose: a string from her hand, the kite NOT pulled into her hands
    const defs = `${k2.library}\n${variantDefs(plan, kits, k2.library)}`;
    const drawn = k2.steps.filter((s) => s.shotIndex === 9 && s.role === "artist" && s.output).at(-1)!.output!.replace("#maya--walk_a-laugh", "#maya--hold-laugh");
    const d = await validateDrawing(drawn, {
      castDefs: defs,
      symbols: k2.bible.cast.map((c) => c.id),
      aspectRatio: "16:9",
      shot: plan.shots[8],
      index: 9,
      canvas,
      fps: 12,
      characters: ["maya", "grandfather"],
      props: ["kite"],
      kits,
      airborne: air,
      strict: false,
    });
    expect(d.svg).toMatch(/data-tether="kite"/);
    expect(d.checks!.facts.join(" ")).toMatch(/string drawn from #maya's hand to #kite/);
    expect(d.checks!.facts.join(" ")).not.toMatch(/put in #maya's hands/);
    expect(d.svg).toMatch(/<use href="#kite--starred" x="800" y="150"/);
  }, 60_000);
});

describe("D88 · a walker the shot says carries a prop holds it (tegami shot 7: \"envelope in hand\")", () => {
  it("the gentleman walking with the envelope in hand is posed hold; kites, walkers with nothing to carry, and held props elsewhere are untouched", async () => {
    const t = JSON.parse(readFileSync("docs/hackathon/evidence/takes/v2-tegami-cmv6up56t000r2ao031ikajcv/trace.json", "utf8")) as { bible: Plan; kits: string };
    const { kitsFromJson } = await import("@/lib/services/director/series");
    const { holdCarried, airborneProps } = await import("@/lib/services/director/acting");
    const kits = kitsFromJson(t.kits);
    expect(t.bible.shots[6].description).toMatch(/walks away from us, envelope in hand/);
    const { plan, posed } = holdCarried(t.bible, kits, airborneProps(t.bible.cast));
    expect(posed).toContainEqual({ shot: 7, who: "elderly-gentleman" });
    expect(plan.shots[6].acting).toEqual([{ who: "elderly-gentleman", pose: "hold", expression: "smile" }]);
    expect(holdCarried(plan, kits, airborneProps(t.bible.cast)).posed).toEqual([]); // idempotent
    // the kite (airborne) is never "carried" into the hands by this rule
    const k2 = JSON.parse(readFileSync("docs/hackathon/evidence/takes/v2-kite-cmv6fvwbe00012ao49z3wfu27/trace.json", "utf8")) as { bible: Plan; kits: string };
    const kiteShots = holdCarried(k2.bible, kitsFromJson(k2.kits), airborneProps(k2.bible.cast)).posed;
    expect(kiteShots).toEqual([]);
  });
});

/* ---------- D89 (owner + QC 2026-10-13 night) ---------- */

describe("D89 · a day shot on the approved golden-lit set is golden hour; off-plan re-judged from stored verdicts, no model call (kite shot 2)", () => {
  type T = { id: string; bible: Plan; summary: { offPlan: number[]; castSetTimes: Record<string, string>; castFromRun?: string }; steps: Array<{ runId: string; role: string; action: string; shotIndex: number | null; output: string | null }> };
  const kite = JSON.parse(readFileSync("docs/hackathon/evidence/takes/v2-kite-cmv6tvm43003b2as8x7pl74px/trace.json", "utf8")) as T;
  const times = new Map(Object.entries(kite.summary.castSetTimes));
  const s2 = kite.bible.shots[1];
  it("shot 2 (\"Morning on the pier\", golden beach) is golden hour only on the approved set", async () => {
    const { goldenHour, fidelityBrief } = await import("@/lib/services/director/fidelity");
    expect(s2.scene).toBe("Morning on the pier");
    expect(times.get("brighton-seafront")).toBe("golden");
    expect(typeof kite.summary.castFromRun).toBe("string");
    expect(goldenHour(s2, times, { approvedSet: true })).toBe(true);
    expect(goldenHour(s2, times)).toBe(false); // a set nobody approved: D82 alone (golden dusk words) decides
    expect(goldenHour(s2, new Map([["brighton-seafront", "day"]]), { approvedSet: true })).toBe(false); // not golden-lit
    expect(goldenHour({ ...s2, scene: "Night on the pier" }, times, { approvedSet: true })).toBe(false); // not a day shot
    expect(fidelityBrief(kite.bible, s2, times, { approvedSet: true })).toMatch(/DAY bucket[^.]*the set's golden light is golden hour/);
  });

  it("the take's stored verdicts on shot 2 clear under D89; a night reading, or no approval, stays off-plan", async () => {
    const { rejudgeOffPlan, storedVerdicts } = await import("@/lib/services/director/fidelity");
    expect(kite.summary.offPlan).toEqual([2]);
    const verdicts = storedVerdicts(kite.steps);
    // the redo drew shot 2 last: only its own two verdicts count, not the take's
    expect(verdicts.get(2)?.length).toBe(kite.steps.filter((s) => s.runId === kite.id && s.shotIndex === 2 && /^(re-)?critique$/.test(s.action)).length);
    expect(verdicts.get(2)!.every((c) => c.fidelity?.time === "wrong")).toBe(true);
    const base = { offPlan: kite.summary.offPlan, shots: kite.bible.shots, setTimes: times, verdicts };
    const r = rejudgeOffPlan({ ...base, approvedSet: true });
    expect(r.offPlan).toEqual([]);
    expect(r.cleared.map((c) => c.shot)).toEqual([2]);
    expect(r.cleared[0].note).toMatch(/no model call.*golden hour, the day bucket: not off-plan, D82\/D89/);
    expect(rejudgeOffPlan({ ...base, approvedSet: false }).offPlan).toEqual([2]);
    const night = new Map([[2, verdicts.get(2)!.map((c) => ({ ...c, fidelity: { ...c.fidelity!, note: "it is night with a moon" } }))]]);
    expect(rejudgeOffPlan({ ...base, approvedSet: true, verdicts: night }).offPlan).toEqual([2]);
    expect(rejudgeOffPlan({ ...base, approvedSet: true, verdicts: new Map() }).offPlan).toEqual([2]); // no stored verdict: never cleared
  });

  it("tegami's shot 7 (dusk planned, read as night, no golden set) stays off-plan", async () => {
    const { rejudgeOffPlan, storedVerdicts } = await import("@/lib/services/director/fidelity");
    const tg = JSON.parse(readFileSync("docs/hackathon/evidence/takes/v2-tegami-cmv6vdhnn00002an4cl8du3do/trace.json", "utf8")) as T;
    expect(tg.summary.offPlan).toEqual([7]);
    const r = rejudgeOffPlan({ offPlan: tg.summary.offPlan, shots: tg.bible.shots, setTimes: new Map(Object.entries(tg.summary.castSetTimes ?? {})), approvedSet: true, verdicts: storedVerdicts(tg.steps) });
    expect(r.offPlan).toEqual([7]);
  });
});
