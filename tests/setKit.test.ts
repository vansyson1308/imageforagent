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
