import { describe, expect, it } from "vitest";
import { buildSet, EXTERIOR_PLACES, INTERIOR_PLACES, setSchema, SET_PROPS } from "@/lib/services/director/setKit";
import { symbolProblems } from "@/lib/services/director/cast";
import { splitLibrary } from "@/lib/services/director/svgTools";
import { sanitizeSvg } from "@/lib/services/svgRenderer";
import { naturalHair } from "@/lib/services/director/dollKit";
import type { CastMember } from "@/lib/services/director/schemas";

/**
 * D41: the set kit. Every place, by day and by night, with props, must pass
 * the same gates a hand-drawn set must pass at cast time (viewBox, ≥ 15
 * shapes, no transparency, no flat blocks, resolvable paints), so a kit set
 * can never be the cause of a failed shot (hosted runs 1–3).
 */
const canvas = { w: 1920, h: 1080 };
const PROPS_IN = ["table", "chair", "lamp", "plant", "clock", "shelf"] as const;
const PROPS_OUT = ["tree", "bench", "house", "streetlamp", "fence", "flowers"] as const;

describe("set kit (D41)", () => {
  for (const place of [...INTERIOR_PLACES, ...EXTERIOR_PLACES]) {
    it(`${place}: day and night pass the cast-time set gates`, async () => {
      for (const time of ["day", "night"] as const) {
        const props = (INTERIOR_PLACES as readonly string[]).includes(place) ? PROPS_IN : PROPS_OUT;
        const spec = setSchema.parse({ place, time, main: "#d9c7a0", accent: "#c0392b", props });
        const markup = buildSet(place, spec, canvas);
        expect(() => sanitizeSvg(markup, "defs")).not.toThrow();
        const { symbols, extras } = splitLibrary(markup);
        const member: CastMember = { id: place, name: place, kind: "set", look: `a ${place}`, colors: ["#d9c7a0"] };
        expect(await symbolProblems(member, symbols.get(place), extras, canvas, "16:9", new Set([place])), `${place} ${time}`).toEqual([]);
      }
    }, 60_000);
  }

  it("is deterministic and draws every prop of the vocabulary without breaking the gates", async () => {
    const spec = setSchema.parse({ place: "market", time: "golden", weather: "rain", main: "#c9b48a", accent: "#2b5f8a", props: SET_PROPS.slice(0, 6) });
    expect(buildSet("m", spec, canvas)).toBe(buildSet("m", spec, canvas));
    for (let i = 0; i < SET_PROPS.length; i += 6) {
      const inner = setSchema.parse({ place: "living-room", time: "dusk", main: "#e8dcc4", accent: "#8a5a7a", props: SET_PROPS.slice(i, i + 6) });
      const outer = setSchema.parse({ place: "park", time: "day", weather: "snow", main: "#8fbf72", accent: "#e2571b", props: SET_PROPS.slice(i, i + 6) });
      for (const [k, spec2] of [["room", inner], ["park", outer]] as const) {
        const markup = buildSet(k, spec2, canvas);
        const { symbols, extras } = splitLibrary(markup);
        const member: CastMember = { id: k, name: k, kind: "set", look: k, colors: ["#888888"] };
        expect(await symbolProblems(member, symbols.get(k), extras, canvas, "16:9", new Set([k])), `${k} props ${SET_PROPS.slice(i, i + 6).join(",")}`).toEqual([]);
      }
    }
  }, 120_000);

  it("hair: natural colours are kept, a tinted grey (hosted run 3's blue beard) becomes neutral grey", () => {
    for (const h of ["#1d1a26", "#5a3b22", "#e0c070", "#b5502a", "#d8d4cc", "#ffffff", "#8a8a8a"]) expect(naturalHair(h), h).toEqual({ hair: h, corrected: false });
    const blue = naturalHair("#a8bce0");
    expect(blue.corrected).toBe(true);
    expect(blue.hair).toMatch(/^#([0-9a-f]{2})\1\1$/);
    expect(naturalHair("#3355ff").corrected).toBe(true);
  });
});

describe("set spec normalisation (showcase v2-banh-chung)", () => {
  it("maps the Cast's words to the kit's and moves props the kit doesn't draw to the set dressing, instead of rejecting the set", async () => {
    const { normalizeSetSpec } = await import("@/lib/services/director/setKit");
    // the real failure: a kitchen whose props 3–5 were outside the list → the whole spec was rejected, the Cast hand-drew a flat set
    const raw = { place: "Kitchen", time: "evening", weather: "sunny", main: "#c9a27a", accent: "#7a4a2a", props: ["stove", "table", "shelf", "altar", "cooking pot", "banana leaves", "bamboo basket", "stove"] };
    expect(setSchema.safeParse(raw).success).toBe(false);
    const n = normalizeSetSpec(raw);
    const r = setSchema.safeParse(n.spec);
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ place: "kitchen", time: "dusk", weather: "clear", props: ["stove", "table", "shelf"] });
    // never dropped silently (owner QC 2026-10-10): the Cast draws them as set dressing
    expect(r.data?.dressing).toEqual(["banana leaves", "bamboo basket"]);
    expect(n.notes.join(" ")).toMatch(/go to the set dressing \(the Cast draws them\): banana leaves, bamboo basket/);
    // place synonyms land on a kit place; the result still passes the cast-time gates
    const yard = normalizeSetSpec({ place: "courtyard", main: "#8fb08a", accent: "#c97d60", props: ["lanterns", "sakura"] });
    const y = setSchema.parse(yard.spec);
    expect(y).toMatchObject({ place: "garden", props: ["lantern", "cherry-tree"] });
    const markup = buildSet("yard", y, { w: 1920, h: 1080 });
    expect(() => sanitizeSvg(markup, "defs")).not.toThrow();
  });

  it("leaves a valid spec untouched and an unmappable place invalid (the Cast then draws it by hand)", async () => {
    const { normalizeSetSpec } = await import("@/lib/services/director/setKit");
    const ok = { place: "tea-room", time: "night", weather: "clear", main: "#d8c8a8", accent: "#7a5a3a", props: ["shoji", "teapot"] };
    expect(normalizeSetSpec(ok)).toEqual({ spec: ok, notes: [] });
    expect(setSchema.safeParse(normalizeSetSpec({ ...ok, place: "spaceship" }).spec).success).toBe(false);
  });
});

describe("set dressing (owner QC 2026-10-10: culturally specific elements, never dropped)", () => {
  it("places each drawn item in the set by kind: sky items high, hanging items under the ceiling, the rest on the ground", async () => {
    const { buildSet, dressingSpot } = await import("@/lib/services/director/setKit");
    expect(["kite on a string in the sky", "fūrin wind chime", "ancestor altar with incense", "stone well", "đèn lồng", "凧"].map(dressingSpot)).toEqual(["sky", "hanging", "ground", "ground", "hanging", "sky"]);
    const spec = setSchema.parse({ place: "kitchen", main: "#c9a27a", accent: "#7a4a2a", dressing: ["ancestor altar", "fūrin"] });
    const markup = buildSet("kitchen", spec, { w: 1920, h: 1080 }, [{ id: "kitchen-d1", name: "ancestor altar" }, { id: "kitchen-d2", name: "fūrin" }]);
    const uses = [...markup.matchAll(/<use href="#(kitchen-d\d)" x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)"/g)].map((m) => ({ id: m[1], y: Number(m[3]), size: Number(m[4]) }));
    expect(uses.map((u) => u.id)).toEqual(["kitchen-d1", "kitchen-d2"]);
    // the altar stands on the floor line (bottom at 70% + 30 px), the fūrin hangs under the ceiling beam
    expect(uses[0].y + uses[0].size).toBeCloseTo(1080 * 0.7 + 30, 0);
    expect(uses[1].y).toBe(40);
    // the dressing is part of the set: inside its symbol, before the light of the hour
    expect(markup.indexOf("kitchen-d1")).toBeLessThan(markup.indexOf("</symbol>"));
    expect(() => sanitizeSvg(markup, "defs")).not.toThrow();
  });
});
