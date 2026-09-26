/**
 * Re-render a finished Director film at a higher frame rate for the demo video.
 * Motion is a pure function of time (ADR-014), so the same spec sampled at
 * 30 fps gives the exact same film with smooth camera moves, no interpolation.
 * Uses the engine's own write path (writeFrameMotion) and film assembler.
 *
 *   npx tsx demo/video/smooth-film.ts --project <id> [--fps 30] [--out demo/video/_work/film.mp4]
 * (run with the same DATABASE_URL / STORAGE_ROOT as the server that made the film)
 */
import "../../scripts/director/env";
import { copyFileSync } from "node:fs";
import { prisma } from "@/lib/db";
import { writeFrameMotion } from "@/lib/services/frameWrites";
import { assembleFilm } from "@/lib/services/filmAssembler";
import { resolveStoragePath } from "@/lib/services/storage";
import { MOTION_LIMITS } from "@/lib/config/limits";

const argv = process.argv.slice(2);
const arg = (k: string, d = "") => {
  const i = argv.indexOf(k);
  return i >= 0 ? (argv[i + 1] ?? d) : d;
};

async function main() {
  const projectId = arg("--project");
  const fps = Math.min(MOTION_LIMITS.maxFps, Number(arg("--fps", "30")));
  const out = arg("--out", "demo/video/_work/film.mp4");
  if (!projectId) throw new Error("--project <id> is required");
  const frames = await prisma.frame.findMany({ where: { projectId }, orderBy: { index: "asc" } });
  for (const f of frames) {
    if (!f.motionSpec) continue;
    const motion = JSON.parse(f.motionSpec) as { fps: number; duration: number; holdFrames?: number };
    const max = Math.floor(MOTION_LIMITS.maxFrames / motion.duration);
    const next = { ...motion, fps: Math.min(fps, max), holdFrames: 1 };
    const t0 = Date.now();
    const r = await writeFrameMotion(f.id, next);
    console.log(`F${String(f.index).padStart(2, "0")}: ${motion.fps} → ${next.fps} fps, ${r.frame.clipFrameCount} frames (${Date.now() - t0} ms)`);
  }
  const film = await assembleFilm(projectId, fps);
  copyFileSync(resolveStoragePath(film.path), out);
  console.log(`film @ ${fps} fps → ${out}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
