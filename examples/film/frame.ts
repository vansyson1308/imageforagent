/** Render one frame of a shot: npx tsx examples/film/frame.ts <shotId> <seconds> */
import { writeFileSync } from "node:fs";
import { motionSpecSchema } from "@/lib/validation/motionSchema";
import { composeMotionFrame, createMotionCompiler } from "@/lib/services/motion/compileMotion";
import { LOGICAL_CANVAS, renderArtwork } from "@/lib/services/svgRenderer";
import { buildShot } from "./shots";
import { SHOTS } from "./screenplay";
async function main() {
  const [id, tArg] = process.argv.slice(2);
  const def = SHOTS.find((s) => s.id === id)!;
  const motion = motionSpecSchema.parse(buildShot(def).json);
  const c = createMotionCompiler(motion, {}, { canvas: LOGICAL_CANVAS["1.85:1"] });
  const i = Math.min(c.frameCount - 1, Math.round(Number(tArg ?? 0) * motion.fps));
  const png = await renderArtwork(null, composeMotionFrame(motion, c.compileFrame(i).svg, LOGICAL_CANVAS["1.85:1"]), "1.85:1", "1K");
  writeFileSync(`/tmp/claude-0/film/frame-${id}.png`, png);
  console.log(c.summary().warnings.filter((w) => !w.startsWith("Effects")).join("\n"));
}
main();
