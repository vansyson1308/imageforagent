import { describe, expect, it } from "vitest";
import { buildDoll, dollSchema } from "@/lib/services/director/dollKit";
import { GATE } from "@/lib/services/director/frameGates";
import { coveredShare, upToUse, withoutUses } from "@/lib/services/director/svgTools";
import { renderArtwork } from "@/lib/services/svgRenderer";

/**
 * "A face hidden by what is drawn after it" (D42). Hosted run 4 shot 7: the
 * Artist put the kite symbol over the grandfather's face and the critic scored
 * it 9. The gate measures cover on the head against cover on the body, so a
 * tint over the whole frame or a figure standing behind another is not a
 * hidden face.
 */
const doll = buildDoll("gramps", dollSchema.parse({ age: "elder", skin: "#e9c09c", hairStyle: "short", hairColor: "#d8d4cc", top: "shirt", topColor: "#3b6ea5", bottom: "pants", bottomColor: "#2f3442", accent: "#e0b84a", accessories: ["glasses"] }));
const kite = `<symbol id="kite" viewBox="0 0 100 100"><path d="M50 0 L100 50 L50 100 L0 50 Z" fill="#d9603b"/></symbol>`;
const defs = doll + kite;
const SET = `<rect width="1920" height="1080" fill="#e9d8b8"/><rect y="760" width="1920" height="320" fill="#8fb08a"/>`;
const GRAMPS = `<use href="#gramps" x="200" y="240" width="504" height="756"/>`;

async function cover(svg: string) {
  const up = upToUse(svg, "gramps");
  if (!up) throw new Error("not placed");
  const full = await renderArtwork(defs, svg, "16:9", "1K");
  return coveredShare(full, await renderArtwork(defs, up, "16:9", "1K"), await renderArtwork(defs, withoutUses(up, "gramps"), "16:9", "1K"));
}
const hidden = (c: { head: number; rest: number } | null) => !!c && c.head >= GATE.maxFaceCover && c.head - c.rest >= 0.15;

describe("upToUse", () => {
  it("cuts after the character and closes what is still open", () => {
    const svg = `<rect width="10" height="10"/><g transform="translate(5 0) scale(-1 1)"><use href="#gramps--hold-laugh" x="0" y="0" width="4" height="6"/><circle r="1"/></g><use href="#kite"/>`;
    expect(upToUse(svg, "gramps")).toBe(`<rect width="10" height="10"/><g transform="translate(5 0) scale(-1 1)"><use href="#gramps--hold-laugh" x="0" y="0" width="4" height="6"/></g>`);
    expect(upToUse(svg, "maya")).toBeNull();
    // closed groups before the character stay closed; a `<use></use>` pair is one element
    expect(upToUse(`<g><rect/></g><use href="#gramps"></use><use href="#kite"/>`, "gramps")).toBe(`<g><rect/></g><use href="#gramps"></use>`);
  });
});

describe("face-cover gate (D42)", () => {
  it("flags a prop drawn over the face (hosted run 4, shot 7)", async () => {
    const c = await cover(`${SET}${GRAMPS}<use href="#kite" x="300" y="200" width="300" height="300"/>`);
    expect(c!.head).toBeGreaterThan(0.5);
    expect(hidden(c)).toBe(true);
  });

  it("passes the same prop held at chest height, over the body", async () => {
    const c = await cover(`${SET}${GRAMPS}<use href="#kite" x="340" y="560" width="220" height="220"/>`);
    expect(c!.rest).toBeGreaterThan(0.05);
    expect(hidden(c)).toBe(false);
  });

  it("passes a tint over the whole frame (head and body covered alike)", async () => {
    const c = await cover(`${SET}${GRAMPS}<rect width="1920" height="1080" fill="#0b1330" fill-opacity="0.45"/>`);
    expect(c!.head).toBeGreaterThan(0.5);
    expect(hidden(c)).toBe(false);
  });

  it("passes a figure in front covering the body more than the face (staging)", async () => {
    const c = await cover(`${SET}${GRAMPS}<rect x="230" y="560" width="420" height="440" fill="#7a4a2a"/>`);
    expect(hidden(c)).toBe(false);
  });

  it("passes when nothing is drawn after the character", async () => {
    const svg = `${SET}${GRAMPS}`;
    expect(upToUse(svg, "gramps")).toBe(svg);
    expect(hidden(await cover(svg))).toBe(false);
  });
});
