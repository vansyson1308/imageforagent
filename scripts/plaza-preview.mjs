// Preview 1 frame plaza: node --import tsx scripts/plaza-preview.mjs [frame] [out] [--2k]
import { writeFileSync } from "node:fs";
import { plazaSpec } from "./plaza-scene.mjs";

const frame = Number(process.argv[2] ?? "-1");
const out = process.argv[3] ?? "storage/plaza-preview.png";
const res = process.argv.includes("--2k") ? "2K" : "1K";

const { compileConstruction } = await import("../src/lib/services/construct/compile.ts");
const { constructSpecSchema } = await import("../src/lib/validation/constructSchema.ts");
const { renderArtwork } = await import("../src/lib/services/svgRenderer.ts");

const overrides = {};
if (process.env.ORBIT) {
  const [az, el] = process.env.ORBIT.split(",").map(Number);
  overrides.orbit = { azimuth: az, elevation: el };
}
if (process.env.PLACE) {
  const [x, y, s] = process.env.PLACE.split(",").map(Number);
  overrides.at = [x, y];
  overrides.scale = s;
}

const spec = plazaSpec({ frame, ...overrides });
const t0 = performance.now();
const { svg, stats, warnings } = compileConstruction(constructSpecSchema.parse(spec));
console.log(
  `compileMs=${stats.compileMs} faces=${stats.facesGenerated} emitted=${stats.facesEmitted}`,
  `splits=${stats.depthSplits} effects=${stats.effectPaths} filters=${stats.filters} bytes=${stats.bytes}`,
);
for (const w of warnings) console.log("WARN:", w);
const png = await renderArtwork(null, `<rect width="1920" height="1080" fill="#0a0e24"/>${svg}`, "16:9", res);
writeFileSync(out, png);
console.log("saved", out, `${(performance.now() - t0).toFixed(0)}ms total`);
