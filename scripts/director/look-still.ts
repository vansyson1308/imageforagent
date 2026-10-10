/**
 * The Hidamari look still for the owner's approval (owner decision C,
 * 2026-10-10): Haru-san from the kit (adult proportions, mustard cardigan,
 * navy apron, beige long skirt, round tortoiseshell glasses, silver low bun)
 * in the kissaten 「ひだまり」 at 16:9 and 9:16, the back veranda at night, and
 * a pose sheet. Engine only, no model call.
 *
 *   npx tsx scripts/director/look-still.ts [outDir]   # default docs/hackathon/evidence/look
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { buildDoll, dollSchema, variantId, type DrawPose, type Expression } from "@/lib/services/director/dollKit";
import { buildSet, setSchema } from "@/lib/services/director/setKit";
import { LOGICAL_CANVAS, renderArtwork } from "@/lib/services/svgRenderer";

/** Haru-san as a kit spec (the channel's haru_sheet_prompt, summarised by the owner). */
export const HARU = dollSchema.parse({
  age: "elder",
  build: "round",
  figure: "adult",
  skin: "#f1d2b6",
  hairStyle: "low-bun",
  hairColor: "#c9c6c2",
  top: "cardigan",
  topColor: "#d9a63a",
  innerColor: "#f8f5ee",
  bottom: "long-skirt",
  bottomColor: "#d8c7a6",
  accent: "#2f3d5c",
  apronColor: "#2f3d5c",
  shoeColor: "#7a4f2e",
  accessories: ["round-glasses", "apron"],
});

/** The kissaten 「ひだまり」 in the afternoon, and its back veranda (縁側) at night: warm amber, cream, muted sage. */
export const KISSATEN = setSchema.parse({ place: "kissaten", time: "golden", main: "#efe2c6", accent: "#b0773a", props: [] });
export const VERANDA = setSchema.parse({ place: "veranda", time: "night", main: "#8fa58a", accent: "#b0773a", props: [] });

async function main() {
  const dir = process.argv[2] ?? "docs/hackathon/evidence/look";
  mkdirSync(dir, { recursive: true });
  const variants = (list: ReadonlyArray<[DrawPose, Expression]>) => list.map(([p, e]) => buildDoll("haru", HARU, { pose: p, expression: e, withGradient: false })).join("\n");
  for (const ar of ["16:9", "9:16"] as const) {
    const c = LOGICAL_CANVAS[ar];
    const defs = buildSet("hidamari", KISSATEN, c) + buildDoll("haru", HARU) + variants([["hold", "smile"]]);
    const h = ar === "16:9" ? c.h * 0.72 : c.h * 0.5;
    const x = Math.round(c.w * (ar === "16:9" ? 0.42 : 0.38));
    const body = `<use href="#hidamari" x="0" y="0" width="${c.w}" height="${c.h}"/><use href="#${variantId("haru", "hold", "smile")}" x="${x}" y="${Math.round(c.h * 0.97 - h)}" width="${Math.round((h * 2) / 3)}" height="${Math.round(h)}"/>`;
    writeFileSync(`${dir}/hidamari-kissaten-${ar.replace(":", "x")}.png`, await renderArtwork(defs, body, ar, "1K"));
  }
  const c = LOGICAL_CANVAS["16:9"];
  writeFileSync(`${dir}/hidamari-veranda-night-16x9.png`, await renderArtwork(buildSet("veranda", VERANDA, c) + buildDoll("haru", HARU), `<use href="#veranda" x="0" y="0" width="${c.w}" height="${c.h}"/><use href="#haru" x="760" y="330" width="480" height="720"/>`, "16:9", "1K"));
  const poses: Array<[DrawPose, Expression]> = [["stand", "smile"], ["hold", "smile"], ["bow", "smile"], ["look-right", "neutral"], ["sit", "smile"]];
  const sheet = poses.map(([p, e], i) => `<use href="#${variantId("haru", p, e)}" x="${10 + i * 330}" y="170" width="520" height="780"/>`).join("");
  writeFileSync(`${dir}/hidamari-haru-poses.png`, await renderArtwork(buildDoll("haru", HARU) + variants(poses), `<rect width="1920" height="1080" fill="#f3e6cf"/>${sheet}`, "16:9", "1K"));
  console.log(`look stills written to ${dir}/`);
}

if (process.argv[1]?.endsWith("look-still.ts")) main();
