/**
 * Public stills for the showcase replay (SPEC v2 WP1.4): one JPEG per shot,
 * cut from each film's own film.mp4 at the middle of the shot, so the 10×
 * "Replay the real run" view shows real frames without the demo-gated
 * /api/files snapshots. Shot timing comes from the trace's render steps
 * (frames @ fps per shot, scaled to the film's real duration since
 * transitions overlap). Writes public/showcase/<slug>/shots/FNN.jpg and adds
 * `stills` to index.json. Deterministic, no network, no model calls.
 *
 *   npx tsx scripts/director/showcase-assets.ts [--only <slug>] [--force]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

interface Step {
  shotIndex: number | null;
  action: string;
  outputSummary: string | null;
  seq: number;
}

const argv = process.argv.slice(2);
const only = argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : null;
const force = argv.includes("--force");
const root = path.join(process.cwd(), "public", "showcase");
const indexPath = path.join(root, "index.json");
const index = JSON.parse(readFileSync(indexPath, "utf8")) as { films: Array<{ slug: string; stills?: Record<string, string> }> };

/** Per-shot duration (s) from the LAST render step of each shot. */
export function shotDurations(steps: Step[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const s of [...steps].sort((a, b) => a.seq - b.seq)) {
    if (!s.shotIndex || (s.action !== "render-clip" && s.action !== "render-still")) continue;
    const m = s.outputSummary?.match(/Clip (\d+) frames @ (\d+) fps/);
    out.set(s.shotIndex, m ? Number(m[1]) / Number(m[2]) : 3);
  }
  return out;
}

for (const film of index.films) {
  if (only && film.slug !== only) continue;
  const dir = path.join(root, film.slug);
  const mp4 = path.join(dir, "film.mp4");
  const trace = JSON.parse(readFileSync(path.join(dir, "trace.json"), "utf8")) as { steps: Step[] };
  if (!existsSync(mp4)) {
    console.warn(`${film.slug}: no film.mp4, skipped`);
    continue;
  }
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp4], { encoding: "utf8" });
  const total = Number(probe.stdout.trim());
  const durs = shotDurations(trace.steps);
  const indices = [...durs.keys()].sort((a, b) => a - b);
  const sum = indices.reduce((n, i) => n + durs.get(i)!, 0);
  const scale = sum > 0 ? total / sum : 1;
  mkdirSync(path.join(dir, "shots"), { recursive: true });
  const stills: Record<string, string> = {};
  let start = 0;
  for (const i of indices) {
    const d = durs.get(i)! * scale;
    const t = Math.min(total - 0.05, start + d * 0.55);
    start += d;
    const name = `F${String(i).padStart(2, "0")}.jpg`;
    const out = path.join(dir, "shots", name);
    if (force || !existsSync(out)) {
      const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-ss", t.toFixed(3), "-i", mp4, "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "4", out], { encoding: "utf8" });
      if (r.status !== 0) throw new Error(`${film.slug} ${name}: ${r.stderr}`);
    }
    stills[String(i)] = `/showcase/${film.slug}/shots/${name}`;
  }
  film.stills = stills;
  console.log(`${film.slug}: ${indices.length} stills (film ${total.toFixed(1)} s)`);
}
writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n");
