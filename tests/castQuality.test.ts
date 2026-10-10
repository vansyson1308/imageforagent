import { describe, expect, it } from "vitest";
import { naturalSkin, SKIN_TONES } from "@/lib/services/director/dollKit";
import { symbolProblems } from "@/lib/services/director/cast";
import { GATE, measureFrame, readableSetProblem, withoutInherited } from "@/lib/services/director/frameGates";
import { errorKind } from "@/lib/services/director/artist";
import { renderArtwork } from "@/lib/services/svgRenderer";
import type { CastMember } from "@/lib/services/director/schemas";

/**
 * Root causes found in the first hosted v2 run (evidence/hosted-run-v2-2026-10-10-en-kite.json):
 * the Cast gave the grandfather the palette's green as skin, and the kitchen
 * set symbol was made of flat blocks, so every shot using it failed the
 * readable-set gate and the Artist (which can't edit the set) burned 45 repairs.
 */
const canvas = { w: 1920, h: 1080 };
// the hosted run's kitchen: wall + floor + a 700×190 flat block (the failing one, #6b8e5c at 610,210) + two flat side panels
const flatKitchen = `<symbol id="kitchen" viewBox="0 0 1920 1080"><rect width="1920" height="1080" fill="#e9d8b4"/><rect y="820" width="1920" height="260" fill="#f0a868"/><rect x="610" y="210" width="700" height="190" fill="#6b8e5c"/><rect x="160" y="200" width="300" height="600" fill="#6b8e5c"/><rect x="1460" y="200" width="300" height="600" fill="#6b8e5c"/>${Array.from({ length: 12 }, (_, i) => `<circle cx="${100 + i * 150}" cy="900" r="6" fill="#d98c50"/>`).join("")}</symbol>`;
const kitchen: CastMember = { id: "kitchen", name: "Kitchen", kind: "set", look: "a cosy kitchen", colors: ["#e9d8b4"] };

describe("cast quality (hosted run root causes)", () => {
  it("skin: a palette green or a grey becomes the natural tone of the same lightness; real skin tones are kept", () => {
    expect(naturalSkin("#3A5A40")).toEqual({ skin: "#6b3e28", corrected: true });
    expect(naturalSkin("#9aa0a6").corrected).toBe(true);
    expect(naturalSkin("#4a6cf0").corrected).toBe(true);
    for (const t of [...SKIN_TONES, "#F4A261", "#ffe0c7", "#eeb48f"]) expect(naturalSkin(t), t).toEqual({ skin: t, corrected: false });
  });

  it("a set made of flat blocks fails at cast time with a measured hint (fixed once, at the source)", async () => {
    const problems = await symbolProblems(kitchen, flatKitchen, new Map(), canvas, "16:9", new Set(["kitchen"]));
    expect(problems.join(" ")).toMatch(/^#kitchen \(the set itself\): \d+% of the frame is plain flat rectangles/);
  }, 30_000);

  it("a shot is not charged for blocks it inherits from the set symbol, only for its own", async () => {
    const defs = flatKitchen;
    const setOnly = await measureFrame(await renderArtwork(defs, `<use href="#kitchen" x="0" y="0" width="1920" height="1080"/>`, "16:9", "1K"));
    expect(setOnly.blockShare).toBeGreaterThan(GATE.maxBlockShare);
    // the shot = the set + a small prop: all the flat blocks are inherited
    const shot = await measureFrame(await renderArtwork(defs, `<use href="#kitchen" x="0" y="0" width="1920" height="1080"/><circle cx="960" cy="700" r="40" fill="#c0392b"/>`, "16:9", "1K"));
    const own = withoutInherited(shot, setOnly);
    expect(readableSetProblem(own, canvas)).toBeNull();
    expect(own.inheritedShare).toBeGreaterThan(GATE.maxBlockShare);
    // the shot adds its OWN big flat block: that one still counts
    const worse = await measureFrame(await renderArtwork(defs, `<use href="#kitchen" x="0" y="0" width="1920" height="1080"/><rect x="900" y="480" width="560" height="300" fill="#3355aa"/>`, "16:9", "1K"));
    expect(readableSetProblem(withoutInherited(worse, setOnly), canvas)).toMatch(/flat rectangles/);
  }, 30_000);

  it("stop-loss: two rejections of the same kind (numbers aside) count as the same failure", () => {
    const a = "Framing/lighting check failed: 11% of the frame is plain flat rectangles that read as nothing (#6b8e5c 700×190 at (610,210)).";
    const b = "Framing/lighting check failed: 13% of the frame is plain flat rectangles that read as nothing (#819e6f 700×190 at (610,212)).";
    expect(errorKind(a)).toBe(errorKind(b));
    expect(errorKind(a)).not.toBe(errorKind("Framing/lighting check failed: the main character is only 20% of the frame height as rendered"));
  });
});
