// Render 96 frames animation (12s @ 8fps) — camera dolly-in overview → hero.
// Chạy: npx tsx scripts/plaza-render-batch.mjs [from] [to]
import { mkdirSync, writeFileSync } from "node:fs";
import { plazaSpec } from "./plaza-scene.mjs";

const { compileConstruction } = await import("../src/lib/services/construct/compile.ts");
const { constructSpecSchema } = await import("../src/lib/validation/constructSchema.ts");
const { renderArtwork } = await import("../src/lib/services/svgRenderer.ts");

const FROM = Number(process.argv[2] ?? "0");
const TO = Number(process.argv[3] ?? "95");
const DIR = "storage/plaza-frames";
mkdirSync(DIR, { recursive: true });

const easeInOut = (u) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);

let maxMs = 0;
let maxSplits = 0;
const t0 = performance.now();
for (let t = FROM; t <= TO; t++) {
  const e = easeInOut(t / 95);
  const spec = plazaSpec({
    frame: t,
    orbit: { azimuth: -30 + 9 * e, elevation: 22 - 6 * e },
    scale: 0.68 + 0.38 * e,
    at: [980 - 75 * e, 615 + 40 * e],
  });
  const { svg, stats } = compileConstruction(constructSpecSchema.parse(spec));
  maxMs = Math.max(maxMs, stats.compileMs);
  maxSplits = Math.max(maxSplits, stats.depthSplits);
  const png = await renderArtwork(null, `<rect width="1920" height="1080" fill="#0a0e24"/>${svg}`, "16:9", "1K");
  writeFileSync(`${DIR}/f${String(t).padStart(3, "0")}.png`, png);
  if (t % 12 === 0) console.log(`f${t} compileMs=${stats.compileMs.toFixed(0)} splits=${stats.depthSplits}`);
}
console.log(
  `DONE f${FROM}..${TO} in ${((performance.now() - t0) / 1000).toFixed(1)}s — maxCompileMs=${maxMs.toFixed(0)} maxSplits=${maxSplits}`,
);
