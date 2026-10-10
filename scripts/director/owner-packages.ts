/**
 * Write the owner's narration packages (owner decision 2026-10-10, section B):
 * docs/hackathon/pilot/<slug>/{production.json, reading_check.txt, director.json}
 * for the 3 Hidamari pilot episodes (9:16 Shorts, ≤ 60 s) and the fūrin
 * showcase film (16:9, 11 lines). The owner's AivisSpeech pipeline reads
 * production.json + reading_check.txt and returns audio/<line>.wav +
 * audio/timings.json into the same folder (git-ignored: the recordings are the
 * owner's).
 *
 *   npx tsx scripts/director/owner-packages.ts        # needs python3 + pyopenjtalk
 *
 * production.json holds only the owner's schema; what the Director needs on
 * top (setting per shot, aspect ratio, title) goes to director.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { buildProduction, estimateSeconds, readingCheck, type SourceScene } from "@/lib/services/director/ownerPackage";
import { SHOWCASE_V2 } from "./showcaseStories";

interface Film {
  readonly slug: string;
  readonly title: string;
  readonly language: string;
  readonly style: string;
  readonly aspectRatio: "9:16" | "16:9";
  readonly maxSeconds: number | null;
  readonly scenes: readonly SourceScene[];
}

/** Katakana readings from pyopenjtalk, one per text (argv array, texts on stdin: never a shell). */
function kana(texts: readonly string[]): string[] {
  const py = "import sys, json, pyopenjtalk\nprint(json.dumps([pyopenjtalk.g2p(t, kana=True) for t in json.load(sys.stdin)], ensure_ascii=False))";
  const r = spawnSync("python3", ["-c", py], { input: JSON.stringify(texts), encoding: "utf8", maxBuffer: 16 << 20 });
  if (r.status !== 0) throw new Error(`pyopenjtalk failed (pip install pyopenjtalk): ${r.stderr.slice(0, 400)}`);
  return JSON.parse(r.stdout) as string[];
}

function films(): Film[] {
  const pilot = JSON.parse(readFileSync("docs/hackathon/eval/pilot-prompts.json", "utf8")) as Array<{ slug: string; title: string; language: string; style: string; aspectRatio: "9:16"; scenes: SourceScene[] }>;
  const furin = SHOWCASE_V2.find((s) => s.slug === "v2-furin")!;
  return [
    ...pilot.map((p) => ({ ...p, maxSeconds: 60 })),
    { slug: "SHOWCASE_furin", title: "風鈴のおくりもの", language: furin.language, style: furin.style, aspectRatio: "16:9", maxSeconds: 90, scenes: furin.lines.map((text) => ({ lines: [{ text }] })) },
  ];
}

function main() {
  for (const f of films()) {
    const production = buildProduction(f.scenes, { pageChars: f.aspectRatio === "9:16" ? 14 : 22 });
    const lines = production.scenes.flatMap((s) => s.lines);
    const readings = kana(lines.map((l) => l.tts_text));
    const est = lines.reduce((t, l, i) => t + estimateSeconds(readings[i], l.tts_text, l.pause_after), 0) + production.scenes.length * 0.3 + 0.4;
    if (f.maxSeconds && est > f.maxSeconds * 0.95) throw new Error(`${f.slug}: about ${est.toFixed(1)} s of narration, over the ${f.maxSeconds} s format`);
    const dir = `docs/hackathon/pilot/${f.slug}`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/production.json`, JSON.stringify(production, null, 2) + "\n");
    writeFileSync(`${dir}/reading_check.txt`, readingCheck(`${f.slug} ${f.title}`, lines.map((l, i) => ({ id: l.id, text: l.text, kana: readings[i] }))));
    writeFileSync(
      `${dir}/director.json`,
      JSON.stringify({ slug: f.slug, title: f.title, language: f.language, style: f.style, aspectRatio: f.aspectRatio, maxSeconds: f.maxSeconds, estimatedSeconds: Math.round(est * 10) / 10, shots: production.scenes.map((s, i) => ({ scene: s.id, setting: f.scenes[i].setting ?? null, lines: s.lines.map((l) => l.id) })) }, null, 2) + "\n",
    );
    console.log(`${dir}: ${production.scenes.length} shots, ${lines.length} lines, about ${est.toFixed(1)} s`);
  }
}

main();
