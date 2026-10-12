import { describe, expect, it } from "vitest";
import { validateDrawing } from "@/lib/services/director/artist";
import type { KitSpec } from "@/lib/services/director/cast";
import { HERO_PROP_SHAPES, symbolProblems } from "@/lib/services/director/cast";
import { demoPlan, DEMO_LIBRARY } from "@/lib/services/director/demoCrew";
import { buildDoll, dollSchema } from "@/lib/services/director/dollKit";
import { actionNote, enforceFidelity, offPlanAxes } from "@/lib/services/director/fidelity";
import { castUser, criticSystem } from "@/lib/services/director/prompts";
import { planSchema, type Critique } from "@/lib/services/director/schemas";
import { INSERT_PROP_AREA, INSERT_PROP_MIN_AREA, INSERT_PROP_SPAN_H, INSERT_PROP_SPAN_W } from "@/lib/services/director/svgTools";

/** Owner decisions 2026-10-11: the revised gate, the camera-move rule, readable hero props, a readable kneel. */
const critique = (fidelity: Critique["fidelity"], score = 8): Critique => ({ score, verdict: "accept", issues: [], fixes: [], fidelity });

describe("only a wrong time of day or place is off-plan; the action verdict is a checklist note", () => {
  it("a wrong action keeps the score and the verdict, and is passed on as the first issue", () => {
    const c = enforceFidelity(critique({ time: "ok", place: "ok", action: "wrong", note: "tanzaku too small" }));
    expect(c.score).toBe(8);
    expect(c.verdict).toBe("accept");
    expect(c.issues[0]).toBe("Key action: tanzaku too small");
    expect(offPlanAxes(c)).toEqual([]);
    expect(actionNote(c)).toBe("tanzaku too small");
  });

  it("a wrong time or place still caps the score at 6 and forces a revision", () => {
    for (const f of [{ time: "wrong", place: "ok" }, { time: "ok", place: "wrong" }] as const) {
      const c = enforceFidelity(critique({ ...f, action: "ok", note: "night vs day" }, 9));
      expect(c.score).toBe(6);
      expect(c.verdict).toBe("revise");
      expect(offPlanAxes(c).length).toBe(1);
    }
  });

  it("the critic is told camera moves can't be seen in a still", () => {
    for (const mode of ["vision", "text"] as const) {
      const s = criticSystem(mode);
      expect(s).toMatch(/pan, dolly, tilt, zoom/);
      expect(s).toMatch(/Never mark a shot "wrong" or lower its score because a camera move is not visible/);
      expect(s).toMatch(/A "wrong" time or place means the frame is off-plan/);
    }
  });
});

describe("hero props read (owner 2026-10-11: run 4's fūrin was a plain orange block)", () => {
  const canvas = { w: 1920, h: 1080 };
  const block = `<symbol id="furin" viewBox="0 0 200 300"><rect x="50" y="50" width="100" height="150" fill="#e07a3c"/><rect x="95" y="0" width="10" height="50" fill="#333"/><rect x="60" y="200" width="80" height="80" fill="#fff"/><circle cx="100" cy="120" r="10" fill="#c00"/><rect x="0" y="0" width="1" height="1" fill="none"/></symbol>`;
  const member = { id: "furin", name: "wind chime", kind: "prop" as const, look: "a glass wind chime", colors: ["#e07a3c"] };

  it("the hero prop needs 12+ shapes; another prop still needs 5", async () => {
    expect(HERO_PROP_SHAPES).toBe(12);
    const hero = await symbolProblems(member, block, new Map(), canvas, "16:9", new Set(), true);
    expect(hero.join()).toMatch(/draw at least 12 \(it is the story's hero object/);
    expect(await symbolProblems(member, block, new Map(), canvas, "16:9", new Set(), false)).toEqual([]);
  });

  it("the Cast is told which member is the hero object", () => {
    const plan = planSchema.parse(demoPlan("One. Two.", 2));
    const p = { ...plan, cast: [...plan.cast, { ...member }] };
    expect(castUser(p, undefined, "furin")).toMatch(/furin \(prop, "wind chime"\).*THE HERO OBJECT: seen close up/);
    expect(castUser(p, undefined, null)).not.toMatch(/HERO OBJECT/);
  });

  const spec = dollSchema.parse({ age: "child", skin: "#f1c9a5", hairStyle: "bob", hairColor: "#2b1d16", top: "tshirt", topColor: "#e8b04a", bottom: "shorts", bottomColor: "#5b6b3a", accent: "#d9483b", accessories: [] });
  const kits: ReadonlyMap<string, KitSpec> = new Map([["kid", { kind: "doll", spec }]]);
  const KITE = `<symbol id="kite" viewBox="0 0 400 400"><path d="M200 20 L380 200 L200 380 L20 200 Z" fill="#d9603b"/><path d="M200 20 L200 380 M20 200 L380 200" stroke="#7a2a12" stroke-width="10"/><circle cx="200" cy="200" r="20" fill="#f4b23c"/><path d="M200 380 Q230 395 210 400" stroke="#7a2a12" stroke-width="6" fill="none"/><circle cx="380" cy="200" r="8" fill="#7a2a12"/></symbol>`;
  const defs = DEMO_LIBRARY + buildDoll("kid", spec) + KITE;
  const base = planSchema.parse(demoPlan("One. Two.", 2));
  const opts = (shotType: string, cast: string[]) => ({ castDefs: defs, symbols: ["hero", "home", "kid", "kite"], aspectRatio: "16:9", shot: { ...base.shots[0], shotType, cast, mode: "still" as const }, index: 1, canvas, fps: 12, characters: ["kid"], sets: ["home"], props: ["kite"], kits });
  const bg = '<use href="#home" x="0" y="0" width="1920" height="1080"/>';

  // a fūrin: hook + string, a glass dome, a clapper, a long paper strip (slender: little area even when tall)
  const FURIN = `<symbol id="furin" viewBox="0 0 300 700"><rect x="146" y="0" width="8" height="120" fill="#5a4630"/><path d="M60 230 Q60 110 150 110 Q240 110 240 230 Z" fill="#7fc4d8"/><path d="M80 220 Q85 140 150 128" stroke="#e8f6fb" stroke-width="10" fill="none"/><rect x="60" y="222" width="180" height="12" fill="#3f7f95"/><rect x="147" y="234" width="6" height="140" fill="#5a4630"/><circle cx="150" cy="250" r="12" fill="#c9a23c"/><rect x="105" y="370" width="90" height="320" rx="4" fill="#f2e3b0"/><path d="M120 420 L180 420 M120 470 L170 470 M120 520 L176 520" stroke="#3a2a1a" stroke-width="5"/></symbol>`;
  const fopts = (shotType: string, cast: string[]) => ({ ...opts(shotType, cast), castDefs: defs + FURIN, symbols: ["hero", "home", "kid", "kite", "furin"], props: ["kite", "furin"] });
  const furin = (h: number) => `<use href="#furin" x="${Math.round(960 - (h * 300) / 1400)}" y="${Math.round(540 - h / 2)}" width="${Math.round((h * 300) / 700)}" height="${h}"/>`;

  // inside a transformed group: the gate's verdict as the Artist would get it (the engine can't rescale a grouped prop)
  const grouped = (use: string) => `<g transform="translate(0 0)">${use}</g>`;

  it("QC of #30 + E (owner 2026-10-12): a slender hanging prop reads when its MAIN BODY spans the frame, not its hook or string", async () => {
    expect([INSERT_PROP_AREA, INSERT_PROP_SPAN_H, INSERT_PROP_SPAN_W, INSERT_PROP_MIN_AREA]).toEqual([0.25, 0.6, 0.45, 0.02]);
    // 700 px: the whole fūrin spans 64%, but its hook is 16% of it: the body (dome to the end of the strip) spans 54% → fails now
    await expect(validateDrawing(`\`\`\`svg\n${bg}${grouped(furin(700))}\n\`\`\``, fopts("Close-up", ["furin", "home"]))).rejects.toThrow(
      /is about #furin, but its main body spans only 5\d% of the frame height .*whole object spans 6\d% × \d+%; only the main body counts\): make the object's body span about 65% of the frame height \(height ≈ 702\), centred, not cropped by any frame edge/,
    );
    // 800 px: the body spans 61% → reads
    const tall = await validateDrawing(`\`\`\`svg\n${bg}${grouped(furin(800))}\n\`\`\``, fopts("Close-up", ["furin", "home"]));
    expect(tall.checks?.problems).toEqual([]);
    expect(tall.checks?.facts.join(" ")).toMatch(/#furin carries this "Close-up": its main body spans 6\d% of the frame height/);
    await expect(validateDrawing(`\`\`\`svg\n${bg}${grouped(furin(500))}\n\`\`\``, fopts("Close-up", ["furin", "home"]))).rejects.toThrow(/is about #furin, but its main body spans only [34]\d% of the frame height/);
  });

  // fūrin take 2, shot 10: a long stick with a small bell on its end spanned 57% of the height at 1.04% of the frame
  const STICK_BELL = `<symbol id="chime" viewBox="0 0 300 700"><rect x="146" y="0" width="8" height="610" fill="#5a4630"/><path d="M110 690 Q110 610 150 610 Q190 610 190 690 Z" fill="#7fc4d8"/><circle cx="150" cy="694" r="6" fill="#c9a23c"/></symbol>`;
  it("E, fūrin take 2 shot 10's case: a long stick with a tiny bell does not carry an insert, and the engine can't scale it into one", async () => {
    const o = { ...fopts("Close-up", ["chime", "home"]), castDefs: defs + STICK_BELL, symbols: ["hero", "home", "kid", "kite", "chime"], props: ["chime"] };
    const use = `<use href="#chime" x="827" y="230" width="266" height="620"/>`;
    // 620 px tall (57% of the frame) — the stick spans it, the bell's body is a few percent
    await expect(validateDrawing(`\`\`\`svg\n${bg}${use}\n\`\`\``, o)).rejects.toThrow(/is about #chime, but its main body spans only \d% of the frame height .*whole object spans 5\d% × \d+%; only the main body counts/);
  });

  it("D: the engine scales a plainly placed object of an insert until its body spans the frame (centred), before any repair turn", async () => {
    const d = await validateDrawing(`\`\`\`svg\n${bg}${furin(700)}\n\`\`\``, fopts("Close-up", ["furin", "home"]));
    expect(d.checks?.problems).toEqual([]);
    expect(d.checks?.facts.join(" ")).toMatch(/fixed by the engine: #furin scaled 1\.\d+× about its centre: 300×700 → \d+×\d+/);
  });

  it("a compact object passes on area alone (≥ 25%), and too small fails, in an insert", async () => {
    const small = `\`\`\`svg\n${bg}${grouped('<use href="#kite" x="780" y="360" width="360" height="360"/>')}\n\`\`\``;
    await expect(validateDrawing(small, opts("Insert", ["kite", "home"]))).rejects.toThrow(/is about #kite, but its main body spans only/);
    const big = `\`\`\`svg\n${bg}<use href="#kite" x="360" y="-180" width="1200" height="1200"/>\n\`\`\``;
    expect((await validateDrawing(big, opts("Insert", ["kite", "home"]))).checks?.problems).toEqual([]);
  });

  it("the other props of an about-the-object shot still need medium-shot size (≥ 0.40%)", async () => {
    const tinyKite = grouped('<use href="#kite" x="100" y="100" width="40" height="40"/>');
    await expect(validateDrawing(`\`\`\`svg\n${bg}${furin(800)}${tinyKite}\n\`\`\``, fopts("Insert", ["furin", "kite", "home"]))).rejects.toThrow(/#kite \(a key prop\) shows only [\d.]+% of the frame; it needs at least 0\.40% beside #furin/);
    const okKite = '<use href="#kite" x="100" y="100" width="220" height="220"/>';
    expect((await validateDrawing(`\`\`\`svg\n${bg}${furin(800)}${okKite}\n\`\`\``, fopts("Insert", ["furin", "kite", "home"]))).checks?.problems).toEqual([]);
  });

  it("a close-up of a character holding the prop keeps the close-up prop size (not 25%)", async () => {
    const svg = `\`\`\`svg\n${bg}<use href="#kid" x="560" y="40" width="800" height="1200"/><use href="#kite" x="1300" y="560" width="300" height="300"/>\n\`\`\``;
    const d = await validateDrawing(svg, { ...opts("Close-up", ["kid", "kite", "home"]), strict: false });
    expect(d.checks?.problems.join()).not.toMatch(/is about #kite/);
  });
});

describe("a readable kneel (owner 2026-10-11: run 4 shot 9's legs were a blob)", () => {
  it("draws the soles behind, two shaded thighs, knee caps and a centre crease; a kimono also gets its hem and overlap", () => {
    const kimono = dollSchema.parse({ age: "child", skin: "#f6dcc4", hairStyle: "bob", hairColor: "#1f1a1e", top: "kimono", topColor: "#e8a87c", bottom: "none", accent: "#c8643c" });
    const pants = dollSchema.parse({ age: "child", skin: "#f6dcc4", hairStyle: "bob", hairColor: "#1f1a1e", top: "shirt", topColor: "#7aa0c8", bottom: "pants", bottomColor: "#40506a", accent: "#c8643c" });
    const k = buildDoll("yui", kimono, { pose: "kneel", symbolId: "yui-k" });
    const p = buildDoll("ken", pants, { pose: "kneel", symbolId: "ken-k" });
    // white tabi soles under a kimono, shoes under trousers
    expect(k).toContain('fill="#f4f1ea"');
    expect(p).not.toContain('fill="#f4f1ea"');
    for (const d of [k, p]) expect((d.match(/fill-opacity="0.55"/g) ?? []).length).toBe(2);
    expect((k.match(/stroke-width="3"/g) ?? []).length).toBeGreaterThan((p.match(/stroke-width="3"/g) ?? []).length);
  });
});
