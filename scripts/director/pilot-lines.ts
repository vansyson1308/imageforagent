/**
 * Hidamari narration line list (owner QC 2026-10-10): the owner renders the
 * narration WAVs in his own pipeline (never the non-commercial JA Piper voice
 * for anything published). Narration = the story's sentences (朗読), one per
 * shot. Reads docs/hackathon/eval/pilot-prompts.json (the approved stories)
 * and writes docs/hackathon/eval/pilot-lines.{json,md}: per episode, line id
 * (= the WAV file name the pilot expects), text, target duration.
 *
 *   npx tsx scripts/director/pilot-lines.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { NARRATION_CHARS_PER_SEC, narrationLines, targetSeconds } from "@/lib/services/director/pilotPolicy";

interface Story {
  readonly id: string;
  readonly story: string;
}

const stories = JSON.parse(readFileSync("docs/hackathon/eval/pilot-prompts.json", "utf8")) as Story[];
const episodes = stories.map((s, e) => {
  const lines = narrationLines(s.story).map((text, i) => ({ id: `ep${e + 1}-L${String(i + 1).padStart(2, "0")}`, wav: `ep${e + 1}-L${String(i + 1).padStart(2, "0")}.wav`, text, targetSec: targetSeconds(text) }));
  return { episode: e + 1, story: s.id, shots: lines.length, totalTargetSec: Math.round(lines.reduce((t, l) => t + l.targetSec, 0) * 10) / 10, lines };
});
const note = `Narration = the story's sentences, one per shot. Target duration = ${NARRATION_CHARS_PER_SEC} characters a second (300 a minute) + 0.3 s per 、 + 0.5 s at the end: a guide, not a limit; each shot is timed to the real WAV. WAV: mono or stereo, any sample rate, one file per line, named exactly as below.`;
writeFileSync("docs/hackathon/eval/pilot-lines.json", JSON.stringify({ note, episodes }, null, 2) + "\n");
const md = [
  "# Hidamari narration lines (for the owner's WAV pipeline)",
  "",
  note,
  "",
  "Licence rule: never the non-commercial JA Piper voice for anything published (PILOT.md).",
  "",
  ...episodes.flatMap((ep) => [
    `## Episode ${ep.episode}: ${ep.story} (${ep.shots} lines, about ${ep.totalTargetSec} s)`,
    "",
    "| Line id / WAV | Text | Target s |",
    "|---|---|---|",
    ...ep.lines.map((l) => `| \`${l.wav}\` | ${l.text} | ${l.targetSec} |`),
    "",
  ]),
].join("\n");
writeFileSync("docs/hackathon/eval/pilot-lines.md", md);
for (const ep of episodes) console.log(`ep${ep.episode} ${ep.story}: ${ep.shots} lines, ${ep.totalTargetSec} s`);
