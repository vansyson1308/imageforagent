/**
 * Cut a ~1-minute trailer + a poster from the finished film, at exact shot
 * times read from the export's storyboard.json timeline:
 *   npx tsx examples/film/trailer.ts <export-dir> <out-dir>
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { SHOTS } from "./screenplay";

const PICKS = ["1.00", "1.01", "1.07", "1.14a", "2.05", "2.08", "3.01", "3.10", "3.11", "4.03", "4.12", "5.02", "5.06", "6.02", "6.10", "7.02", "7.06"];

const [exportDir, outDir] = process.argv.slice(2);
const sb = JSON.parse(readFileSync(path.join(exportDir, "storyboard.json"), "utf8")) as { frames: { index: number; startSec: number; durationSec: number }[] };
const at = (id: string) => {
  const f = sb.frames.find((x) => x.index === SHOTS.findIndex((s) => s.id === id) + 1)!;
  return { start: f.startSec + Math.min(2, f.durationSec * 0.3), len: 3.5 };
};
const film = path.join(exportDir, "film.mp4");
const inputs = PICKS.flatMap((id) => ["-ss", at(id).start.toFixed(3), "-t", String(at(id).len), "-i", film]);
const n = PICKS.length;
const graph =
  PICKS.map((_, i) => `[${i}:v]scale=1280:-2,fps=24,settb=1/24,format=yuv420p[v${i}];[${i}:a]aresample=48000,asetpts=PTS-STARTPTS[a${i}]`).join(";") +
  ";" +
  PICKS.map((_, i) => `[v${i}][a${i}]`).join("") +
  `concat=n=${n}:v=1:a=1[v][a];[a]afade=t=in:d=0.5,afade=t=out:st=${(n * 3.5 - 1.5).toFixed(1)}:d=1.5[af]`;
const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...inputs, "-filter_complex", graph, "-map", "[v]", "-map", "[af]", "-c:v", "libx264", "-crf", "24", "-preset", "slow", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", path.join(outDir, "den-ong-sao-trailer.mp4")], { stdio: "inherit" });
if (r.status !== 0) process.exit(1);
const hero = at("5.06");
spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", (hero.start + 4).toFixed(3), "-i", film, "-frames:v", "1", "-vf", "scale=1280:-2", "-q:v", "3", path.join(outDir, "den-ong-sao-poster.jpg")], { stdio: "inherit" });
console.log("trailer + poster →", outDir);
