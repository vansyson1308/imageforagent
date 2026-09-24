/**
 * Score check: renders every mood (15 s each), writes a 16-bit WAV and prints
 * duration, peak, integrated loudness, render time, per-mood levels and a
 * determinism check (two renders, sample hash compared). `--full` also times
 * a realistic ~1250 s film cue sheet.
 *
 *   npx tsx examples/film/score-check.ts [--full] [--out /path/file.wav]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { renderScore, type Cue, type Mood } from "./score";
import { encodeWav, type AudioBuffer } from "@/lib/services/audio/wav";
import { measureLoudness } from "@/lib/services/audio/loudness";

const MOODS: Mood[] = [
  "prologue", "dawn", "day", "playful", "tender", "wind", "sad", "night",
  "mystery", "wonder", "tension", "triumph", "festival", "lullaby", "credits",
];

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const out = outIdx >= 0 ? args[outIdx + 1] : "/tmp/claude-0/film/score-test.wav";

function hashAudio(a: AudioBuffer): string {
  const h = createHash("sha256");
  for (const ch of a.channels) h.update(Buffer.from(ch.buffer, ch.byteOffset, ch.byteLength));
  return h.digest("hex").slice(0, 16);
}

function stats(a: AudioBuffer) {
  let peak = 0, sum = 0, nan = 0, jump = 0;
  for (const ch of a.channels) {
    for (let i = 0; i < ch.length; i++) {
      const v = ch[i];
      if (!Number.isFinite(v)) nan++;
      const x = Math.abs(v);
      if (x > peak) peak = x;
      sum += v;
      if (i > 0) jump = Math.max(jump, Math.abs(v - ch[i - 1]));
    }
  }
  const n = a.channels[0].length * a.channels.length;
  return { peakDb: 20 * Math.log10(Math.max(peak, 1e-12)), dc: sum / n, nan, jump };
}

function segment(a: AudioBuffer, t0: number, t1: number): AudioBuffer {
  const i0 = Math.round(t0 * a.sampleRate), i1 = Math.round(t1 * a.sampleRate);
  return { sampleRate: a.sampleRate, channels: a.channels.map((c) => c.subarray(i0, i1)) };
}

function timed<T>(f: () => T): [T, number] {
  const t = performance.now();
  const r = f();
  return [r, (performance.now() - t) / 1000];
}

let ok = true;
const fail = (m: string) => {
  ok = false;
  console.log(`FAIL: ${m}`);
};

// --- every mood, 15 s each -------------------------------------------------
const SEG = 15;
const cues: Cue[] = MOODS.map((mood, i) => ({ start: i * SEG, end: (i + 1) * SEG, mood }));
const total = MOODS.length * SEG;
const [a, secs] = timed(() => renderScore(cues, total));
const [b] = timed(() => renderScore(cues, total));
const lu = measureLoudness(a);
const st = stats(a);
const h1 = hashAudio(a), h2 = hashAudio(b);
console.log(`duration      ${(a.channels[0].length / a.sampleRate).toFixed(2)} s @ ${a.sampleRate} Hz, ${a.channels.length} ch`);
console.log(`peak          ${st.peakDb.toFixed(2)} dBFS (meter: ${lu.samplePeak.toFixed(2)})`);
console.log(`integrated    ${lu.integrated.toFixed(2)} LUFS`);
console.log(`dc offset     ${st.dc.toExponential(2)}   max |Δsample| ${st.jump.toFixed(3)}   NaN ${st.nan}`);
console.log(`render time   ${secs.toFixed(2)} s (${(total / secs).toFixed(1)}× realtime)`);
console.log(`determinism   ${h1} vs ${h2} → ${h1 === h2 ? "identical" : "DIFFERENT"}`);
console.log("per mood (inner 11 s of each cue):");
for (let i = 0; i < MOODS.length; i++) {
  const s = segment(a, i * SEG + 2, (i + 1) * SEG - 2);
  const m = measureLoudness(s);
  console.log(`  ${MOODS[i].padEnd(9)} ${m.integrated.toFixed(1).padStart(6)} LUFS  peak ${m.samplePeak.toFixed(1).padStart(6)} dBFS`);
}
if (st.peakDb > -1) fail(`peak ${st.peakDb.toFixed(2)} dBFS > -1`);
if (Math.abs(lu.integrated + 20) > 1.5) fail(`integrated ${lu.integrated.toFixed(2)} LUFS not ≈ -20`);
if (h1 !== h2) fail("renders differ");
if (st.nan) fail("non-finite samples");
if (Math.abs(st.dc) > 1e-3) fail("DC offset");

mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, encodeWav(a, 16));
console.log(`wrote         ${out}`);

// --- full film timing ------------------------------------------------------
if (args.includes("--full")) {
  const sheet: [Mood, number][] = [
    ["prologue", 40], ["dawn", 90], ["day", 100], ["playful", 60], ["tender", 80], ["wind", 60], ["sad", 90], ["night", 100],
    ["mystery", 80], ["wonder", 90], ["tension", 60], ["triumph", 70], ["festival", 150], ["lullaby", 90], ["credits", 90],
  ];
  const fc: Cue[] = [];
  let t = 0;
  for (const [mood, d] of sheet) {
    fc.push({ start: t, end: t + d, mood });
    t += d;
  }
  const mem0 = process.memoryUsage().rss;
  const [f, fs] = timed(() => renderScore(fc, t));
  const fl = measureLoudness(f);
  const fst = stats(f);
  console.log(`full film     ${t} s rendered in ${fs.toFixed(1)} s (${(t / fs).toFixed(1)}× realtime), rss +${((process.memoryUsage().rss - mem0) / 1e6).toFixed(0)} MB`);
  console.log(`full film     peak ${fst.peakDb.toFixed(2)} dBFS, ${fl.integrated.toFixed(2)} LUFS, NaN ${fst.nan}`);
  if (fst.peakDb > -1) fail("full film peak > -1 dBFS");
  if (args.includes("--write-full")) writeFileSync(out.replace(/\.wav$/, "-full.wav"), encodeWav(f, 16));
}

console.log(ok ? "OK" : "CHECK FAILED");
if (!ok) process.exitCode = 1;
