import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { coverageProblems, ensureSets, heroProp, MAX_CAST, misplacedShots, scenePlace } from "@/lib/services/director/plan";
import { retimeSets, setForShot, setTimeVariant, shotTime, timedSetId } from "@/lib/services/director/fidelity";
import { planSchema, type Plan } from "@/lib/services/director/schemas";
import { buildSet, setSchema } from "@/lib/services/director/setKit";
import { buildDoll, dollSchema, normalizeDollSpec } from "@/lib/services/director/dollKit";
import { sanitizeSvg } from "@/lib/services/svgRenderer";

/** The plans of the 2026-10-11 re-shoot runs (docs/hackathon/evidence/reshoot-2026-10-11/). */
const planOf = (slug: string): Plan => {
  const t = JSON.parse(readFileSync(`docs/hackathon/evidence/reshoot-2026-10-11/v2-${slug}-trace.json`, "utf8")) as { bible: string | Plan };
  const b = typeof t.bible === "string" ? (JSON.parse(t.bible) as Plan & { references?: unknown }) : t.bible;
  const { references: _r, ...plan } = b as Plan & { references?: unknown };
  void _r;
  return planSchema.parse(plan);
};

describe("a plan with no set gets sets (re-shoot 2026-10-11, bánh chưng: 8 props, 0 sets → 10 set-less shots)", () => {
  it("names the place of a scene heading", () => {
    expect(scenePlace("Chiều Ba Mươi - Sân nhà")).toBe("Sân nhà");
    expect(scenePlace("夏の昼・町家")).toBe("町家");
    expect(scenePlace("Kitchen")).toBe("Kitchen");
  });

  it("the coverage check asks Ultra for sets first", () => {
    expect(coverageProblems(planOf("banh-chung")).some((p) => p.startsWith("the cast has no set"))).toBe(true);
    expect(coverageProblems(planOf("furin")).some((p) => p.startsWith("the cast has no set"))).toBe(false);
  });

  it("the engine adds one set per place (most-used first, at most 2), makes room by dropping the least-used props, never the key prop", () => {
    const plan = planOf("banh-chung");
    expect(plan.cast).toHaveLength(MAX_CAST);
    const hero = heroProp(plan);
    const r = ensureSets(plan);
    expect(planSchema.safeParse(r.plan).success).toBe(true);
    expect(r.plan.cast.length).toBeLessThanOrEqual(MAX_CAST);
    expect(r.added).toEqual(["#set-1 (Sân nhà)", "#set-2 (Phố cổ)"].slice(0, r.added.length));
    expect(r.added.length).toBe(2);
    expect(r.dropped).toHaveLength(2);
    expect(r.dropped).not.toContain(hero);
    const sets = new Set(r.plan.cast.filter((c) => c.kind === "set").map((c) => c.id));
    // every shot stands in a set; the dropped props are gone from every shot
    for (const s of r.plan.shots) {
      expect(s.cast.some((id) => sets.has(id)), s.scene).toBe(true);
      for (const d of r.dropped) expect(s.cast).not.toContain(d);
    }
    // a courtyard shot stands in the courtyard
    expect(r.plan.shots[0].cast).toContain("set-1");
  });

  it("leaves a plan that has a set alone", () => {
    const plan = planOf("furin");
    expect(ensureSets(plan).plan).toBe(plan);
  });
});

describe("a set used by day and by night is lit for each shot's time (re-shoot 2026-10-11, fūrin: daytime shots 1-3 came out at night)", () => {
  const plan = planOf("furin");
  const veranda = plan.cast.find((c) => c.kind === "set" && plan.shots.slice(0, 3).every((s) => s.cast.includes(c.id)))!.id;

  it("the night-lit veranda needs a day variant, for exactly its daytime shots", () => {
    expect(shotTime(plan.shots[0])).toBe("day");
    expect(setTimeVariant(plan, veranda, "night")).toBe("day");
    expect(setTimeVariant(plan, veranda, "day")).toBe("night");
    const times = new Map([[veranda, "night"], [timedSetId(veranda, "day"), "day"]]);
    const placed = plan.shots.map((s) => (s.cast.includes(veranda) ? setForShot(s, veranda, times) : null));
    expect(placed.slice(0, 3)).toEqual([`${veranda}--day`, `${veranda}--day`, `${veranda}--day`]);
    for (const [i, s] of plan.shots.entries()) if (s.cast.includes(veranda) && shotTime(s) === "night") expect(placed[i]).toBe(veranda);
  });

  it("swaps exact set references only (not the set's dressing ids), and only when the variant exists", () => {
    const shot = plan.shots[0];
    const svg = `<use href="#${veranda}" x="0" y="0" width="1920" height="1080"/><use href="#${veranda}-d1" x="5"/><use xlink:href='#${veranda}'/>`;
    const times = new Map([[veranda, "night"], [timedSetId(veranda, "day"), "day"]]);
    const out = retimeSets(svg, shot, times);
    expect(out).toContain(`href="#${veranda}--day"`);
    expect(out).toContain(`xlink:href='#${veranda}--day'`);
    expect(out).toContain(`href="#${veranda}-d1"`);
    expect(retimeSets(svg, shot, new Map([[veranda, "night"]]))).toBe(svg);
    // a night shot keeps the night set
    const night = plan.shots.find((s) => s.cast.includes(veranda) && shotTime(s) === "night")!;
    expect(retimeSets(svg, night, times)).toBe(svg);
  });

  it("the variant is a real kit set: its own symbol id, the other light, sanitizer-clean", () => {
    const spec = setSchema.parse({ place: "veranda", time: "night", main: "#6f8f5a", accent: "#c9a36b" });
    const day = buildSet(timedSetId("house-veranda", "day"), { ...spec, time: "day" });
    expect(day).toContain('id="house-veranda--day"');
    expect(() => sanitizeSvg(day, "defs")).not.toThrow();
    expect(day).not.toBe(buildSet("house-veranda", spec).replaceAll("house-veranda", "house-veranda--day"));
  });
});

describe("a shot given the wrong set goes back to Ultra (re-shoot 2026-10-11, kite: beach shots 8-11 were given #kitchen)", () => {
  it("flags the kite plan's beach shots, each with the reason", () => {
    const m = misplacedShots(planOf("kite"));
    expect(m.map((x) => x.shot)).toEqual([8, 9, 10, 11]);
    expect(m.every((x) => x.set === "kitchen")).toBe(true);
    expect(m[0].why).toBe("it describes #brighton-pier");
    expect(m[2].why).toContain("outdoor place");
    expect(coverageProblems(planOf("kite")).some((p) => p.startsWith("wrong set: shot 8 is in #kitchen"))).toBe(true);
  });

  it("does not flag plans whose sets fit (the other re-shoot plans and every published plan)", () => {
    expect(misplacedShots(planOf("furin"))).toEqual([]);
    expect(misplacedShots(ensureSets(planOf("banh-chung")).plan)).toEqual([]);
    for (const f of ["v2-kite", "v2-banh-chung", "v2-furin", "tea-house", "den-long", "kitsune"]) {
      const t = JSON.parse(readFileSync(`public/showcase/${f}/trace.json`, "utf8")) as { bible: string | Plan };
      const plan = typeof t.bible === "string" ? (JSON.parse(t.bible) as Plan) : t.bible;
      expect(misplacedShots(plan), f).toEqual([]);
    }
  });
});

describe("a doll spec with colour names or missing colours still builds from the kit (re-shoot 2026-10-11, fūrin run 3: both dolls rejected → freehand blobs)", () => {
  it("maps names and #rgb to #rrggbb, drops an unusable optional colour, fills a missing accent from the top", () => {
    const r = normalizeDollSpec({ age: "child", skin: "#f1c9a5", hairStyle: "bob", hairColor: "black", top: "yukata", topColor: "#A9C8E6", innerColor: "white", apronColor: "none", shoeColor: "#333" });
    const ok = dollSchema.safeParse(r.spec);
    expect(ok.success).toBe(true);
    expect(r.spec).toMatchObject({ hairColor: "#2b2530", innerColor: "#f6f2ea", shoeColor: "#333333", accent: "#a9c8e6", top: "kimono" });
    expect(r.spec).not.toHaveProperty("apronColor");
    expect(r.notes).toContain('apronColor "none" is not a colour: kit default');
    expect(r.notes.some((n) => n.startsWith('topColor'))).toBe(false); // a change of case is not a change
    if (ok.success) expect(buildDoll("yui", ok.data)).toContain('id="yui"');
  });
  it("still rejects a spec whose required colours are unusable (the Cast is asked again)", () => {
    expect(dollSchema.safeParse(normalizeDollSpec({ age: "adult", skin: "#f1c9a5", hairStyle: "bob", hairColor: "#222222", top: "shirt", topColor: "sparkly" }).spec).success).toBe(false);
  });
});
