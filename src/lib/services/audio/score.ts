/**
 * Film score — a deterministic, pure-TypeScript synthesizer for the original
 * score of "Đèn Ông Sao" (The Star Lantern).
 *
 * Design:
 *  - A cue list (start/end/mood) is rendered cue by cue. Each cue is laid out
 *    on its own bar grid (tempo nudged ≤12% so a whole number of bars fits),
 *    arranged into timed events (pad chords, đàn tranh plucks, sáo phrases,
 *    bass, bells, percussion, crickets, wind), synthesized into a cue-local
 *    stereo bus + reverb send, faded (equal-power), passed through a small
 *    Freeverb-style room, loudness-trimmed to the mood's level and summed into
 *    the film-length stereo output. Cues touching at a boundary crossfade
 *    across it: a cue starts `fadeIn/2` before its `start` and ends
 *    `fadeOut/2` after its `end`.
 *  - Vietnamese colour: major/minor pentatonic melodies, a Karplus–Strong
 *    zither with "nhấn" (upward press-glides) and "rung" (post-pluck vibrato),
 *    a breathy bamboo flute with delayed vibrato and scoops, sus/quartal pads.
 *  - ONE 8-bar main theme (THEME) is quoted in prologue, tender, triumph,
 *    festival and credits (and hinted in wonder) so the score has identity.
 *  - Everything is seeded (mulberry32 / xorshift from string hashes) — no
 *    Math.random, no clock: same cues + seed → byte-identical samples.
 *  - Master: DC block → normalize to −20 LUFS integrated (repo's BS.1770
 *    meter) → look-ahead peak limiter at −1.3 dBFS → edge fades.
 */
import type { AudioBuffer } from "@/lib/services/audio/wav";
import { measureLoudness } from "@/lib/services/audio/loudness";

export type Mood =
  | "prologue" | "dawn" | "day" | "playful" | "tender" | "wind" | "sad" | "night"
  | "mystery" | "wonder" | "tension" | "triumph" | "festival" | "lullaby" | "credits";

export interface Cue {
  start: number;
  end: number;
  mood: Mood;
  /** optional crossfade seconds into this cue, default 3 */
  fadeIn?: number;
  fadeOut?: number;
}

export interface ScoreOptions {
  sampleRate?: number /* default 24000 */;
  seed?: string /* default "den-ong-sao" */;
}

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** mulberry32 on a string seed — musical decisions. */
class Rng {
  private s: number;
  constructor(seed: string) {
    this.s = hash32(seed);
  }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(xs: readonly T[]): T {
    return xs[this.int(xs.length)];
  }
  weighted<T>(xs: readonly T[], w: readonly number[]): T {
    let sum = 0;
    for (const x of w) sum += x;
    let u = this.next() * sum;
    for (let i = 0; i < xs.length; i++) {
      u -= w[i];
      if (u < 0) return xs[i];
    }
    return xs[xs.length - 1];
  }
  seed32(): number {
    return ((this.next() * 4294967296) >>> 0) || 1;
  }
}

/** xorshift32 white noise in [-1, 1) — audio-rate. */
class Noise {
  private x: number;
  constructor(seed: number) {
    this.x = seed >>> 0 || 0x9e3779b9;
  }
  next(): number {
    let x = this.x;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.x = x >>> 0;
    return this.x / 2147483648 - 1;
  }
}

// ---------------------------------------------------------------------------
// Small math helpers
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;
const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const mod = (x: number, m: number) => ((x % m) + m) % m;
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
function smooth(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
function panGains(p: number): [number, number] {
  const a = ((clamp(p, -1, 1) + 1) * Math.PI) / 4;
  return [Math.cos(a), Math.sin(a)];
}
/** PolyBLEP residual for a band-limited saw. */
function blep(t: number, dt: number): number {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Music theory
// ---------------------------------------------------------------------------

const MAJ_PENT = [0, 2, 4, 7, 9];
const MIN_PENT = [0, 3, 5, 7, 10];

/** Chords as semitones above the key tonic (major names for major keys, lower-case i… for minor). */
const CHORDS: Record<string, number[]> = {
  I: [0, 4, 7], Iadd9: [0, 4, 7, 14], I6: [0, 4, 7, 9], Imaj7: [0, 4, 7, 11],
  ii7: [2, 5, 9, 12], iii7: [4, 7, 11, 14],
  IV: [5, 9, 12], IVadd9: [5, 9, 12, 19], IVmaj7: [5, 9, 12, 16],
  V: [7, 11, 14], Vsus: [7, 12, 14], vi: [9, 12, 16], vi7: [9, 12, 16, 19],
  i: [0, 3, 7], i7: [0, 3, 7, 10], isus2: [0, 2, 7], isus4: [0, 5, 7], iv7: [5, 8, 12, 15],
  VI: [8, 12, 15], VImaj7: [8, 12, 15, 19], III: [3, 7, 10], VII: [10, 14, 17], VIIsus2: [10, 12, 17],
};

/**
 * Main theme "Đèn Ông Sao" — 8 bars of 4/4 in major pentatonic, as
 * [semitones above tonic | null = rest, beats]. Rises like a lantern being
 * lifted (A–C–D), half-cadences on the 2nd in bar 4, climbs to the octave in
 * bar 5 and settles home on the tonic.
 */
const THEME: [number | null, number][][] = [
  [[4, 1], [7, 1], [9, 2]],
  [[7, 1.5], [4, 0.5], [2, 1], [0, 1]],
  [[-3, 1], [0, 1], [2, 1.5], [4, 0.5]],
  [[2, 3], [null, 1]],
  [[4, 1], [7, 1], [9, 1], [12, 1]],
  [[9, 1.5], [7, 0.5], [4, 1], [7, 1]],
  [[2, 1], [4, 0.5], [2, 0.5], [0, 1], [-3, 1]],
  [[0, 4]],
];
const THEME_PROG: string[][] = [["I"], ["vi"], ["IV"], ["V"], ["I"], ["vi"], ["ii7", "Vsus"], ["I"]];
/** Theme ornaments (bar, note index) — fixed so every quote sounds like the same tune. */
const THEME_ORN: Record<string, Orn> = { "0:2": "scoop", "4:3": "scoop", "5:0": "mord", "7:0": "scoop" };

/** Which theme bars to play when only `n` bars are available (always ends home). */
function themeFit(n: number): number[] {
  if (n >= 8) return [0, 1, 2, 3, 4, 5, 6, 7];
  if (n >= 4) return [0, 1, 2, 7];
  if (n >= 2) return [0, 7];
  return [7];
}

const CELLS = {
  slow: [[4], [2, 2], [3, 1], [2, 1, 1], [1, 1, 2], [1.5, 0.5, 2]],
  slowEnd: [[4], [2, 2], [1, 3]],
  med: [[1, 1, 2], [1, 1, 1, 1], [1.5, 0.5, 1, 1], [2, 1, 1], [0.5, 0.5, 1, 2], [1, 0.5, 0.5, 2]],
  medEnd: [[1, 1, 2], [2, 2], [1, 3]],
  fast: [[0.5, 0.5, 1, 0.5, 0.5, 1], [1, 0.5, 0.5, 1, 1], [0.5, 0.5, 0.5, 0.5, 1, 1], [1, 1, 0.5, 0.5, 1], [0.5, 1, 0.5, 1, 1]],
  fastEnd: [[0.5, 0.5, 1, 2], [1, 1, 2], [0.5, 0.5, 0.5, 0.5, 2]],
  waltz: [[3], [2, 1], [1, 1, 1], [1.5, 0.5, 1]],
  waltzEnd: [[3], [1, 2]],
};

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

type Orn = "scoop" | "mord";
/** Melody note in beats relative to a phrase start. */
interface MNote { beat: number; beats: number; midi: number; orn?: Orn }
interface FNote { t: number; dur: number; midi: number; orn?: Orn; depth: number }

interface PadEv { k: "pad"; t: number; dur: number; midi: number; lvl: number; cutoff: number; atk: number; rel: number; bright: number; trem: number }
interface PluckEv { k: "pluck"; t: number; dur: number; midi: number; vel: number; pan: number; bend: number; vib: number }
interface FluteEv { k: "flute"; notes: FNote[]; lvl: number; pan: number; hum: boolean }
interface BassEv { k: "bass"; t: number; dur: number; midi: number; lvl: number; atk: number; rel: number }
interface BellEv { k: "bell"; t: number; midi: number; vel: number; ratio: number; index: number; decay: number; pan: number }
interface WoodEv { k: "wood"; t: number; vel: number; freq: number; pan: number }
interface DrumEv { k: "drum"; t: number; vel: number; f0: number; f1: number }
interface CymEv { k: "cym"; t: number; vel: number; decay: number }
interface CricketEv { k: "cricket"; t: number; vel: number; freq: number; pulses: number; pan: number }
interface WindEv { k: "wind"; t: number; dur: number; lvl: number }
type Ev = PadEv | PluckEv | FluteEv | BassEv | BellEv | WoodEv | DrumEv | CymEv | CricketEv | WindEv;

/** Reverb send per instrument. */
const SEND: Record<Ev["k"], number> = {
  pad: 0.55, pluck: 0.75, flute: 0.8, bass: 0.1, bell: 0.9, wood: 0.35, drum: 0.2, cym: 0.3, cricket: 0.6, wind: 0.35,
};

// ---------------------------------------------------------------------------
// Mood table
// ---------------------------------------------------------------------------

interface MoodCfg {
  bpm: number;
  bpb: number;
  /** Tonic as a MIDI note (octave 3/4). */
  key: number;
  minor: boolean;
  /** Pre-master loudness of the cue (LUFS) — sets the film's dynamic arc. */
  target: number;
  rev: { size: number; damp: number; wet: number };
}

const MOODS: Record<Mood, MoodCfg> = {
  prologue: { bpm: 60, bpb: 4, key: 65, minor: false, target: -23, rev: { size: 0.85, damp: 0.35, wet: 0.34 } },
  dawn: { bpm: 72, bpb: 4, key: 65, minor: false, target: -22, rev: { size: 0.82, damp: 0.3, wet: 0.3 } },
  day: { bpm: 96, bpb: 4, key: 60, minor: false, target: -20, rev: { size: 0.75, damp: 0.35, wet: 0.22 } },
  playful: { bpm: 112, bpb: 4, key: 60, minor: false, target: -19.5, rev: { size: 0.7, damp: 0.4, wet: 0.18 } },
  tender: { bpm: 66, bpb: 4, key: 65, minor: false, target: -22, rev: { size: 0.83, damp: 0.35, wet: 0.3 } },
  wind: { bpm: 66, bpb: 4, key: 62, minor: true, target: -23, rev: { size: 0.86, damp: 0.3, wet: 0.32 } },
  sad: { bpm: 56, bpb: 4, key: 62, minor: true, target: -22.5, rev: { size: 0.85, damp: 0.35, wet: 0.32 } },
  night: { bpm: 60, bpb: 4, key: 57, minor: true, target: -26, rev: { size: 0.87, damp: 0.3, wet: 0.36 } },
  mystery: { bpm: 52, bpb: 4, key: 62, minor: true, target: -24.5, rev: { size: 0.88, damp: 0.3, wet: 0.4 } },
  wonder: { bpm: 80, bpb: 4, key: 65, minor: false, target: -21.5, rev: { size: 0.87, damp: 0.25, wet: 0.38 } },
  tension: { bpm: 92, bpb: 4, key: 62, minor: true, target: -23.5, rev: { size: 0.78, damp: 0.4, wet: 0.22 } },
  triumph: { bpm: 84, bpb: 4, key: 65, minor: false, target: -19, rev: { size: 0.8, damp: 0.3, wet: 0.26 } },
  festival: { bpm: 120, bpb: 4, key: 67, minor: false, target: -18, rev: { size: 0.72, damp: 0.4, wet: 0.18 } },
  lullaby: { bpm: 54, bpb: 3, key: 60, minor: false, target: -24.5, rev: { size: 0.84, damp: 0.4, wet: 0.3 } },
  credits: { bpm: 76, bpb: 4, key: 65, minor: false, target: -20.5, rev: { size: 0.82, damp: 0.3, wet: 0.28 } },
};

// ---------------------------------------------------------------------------
// Arrangement context + helpers
// ---------------------------------------------------------------------------

interface Ctx {
  mood: Mood;
  rng: Rng;
  key: number;
  minor: boolean;
  scale: number[];
  bpb: number;
  beat: number;
  bar: number;
  bars: number;
  /** Cue start inside the cue buffer (s) — bar 0 downbeat. */
  t0: number;
  /** End of sources inside the cue buffer (s). */
  endT: number;
  /** Per bar: chord segments (each a list of semitones above tonic). */
  prog: number[][][];
  ev: Ev[];
}

const barT = (c: Ctx, b: number, beat = 0) => c.t0 + b * c.bar + beat * c.beat;
const pcOf = (c: Ctx, m: number) => mod(m - c.key, 12);
const progress = (c: Ctx, b: number) => (c.bars <= 1 ? 1 : b / (c.bars - 1));

function chordAt(c: Ctx, b: number, beat: number): number[] {
  const segs = c.prog[clamp(b, 0, c.bars - 1)];
  const k = Math.min(segs.length - 1, Math.floor(beat / (c.bpb / segs.length) + 1e-9));
  return segs[k];
}
function inChord(c: Ctx, m: number, ch: number[]): boolean {
  const p = pcOf(c, m);
  return ch.some((s) => mod(s, 12) === p);
}
function scaleNotes(c: Ctx, lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let m = lo; m <= hi; m++) if (c.scale.includes(pcOf(c, m))) out.push(m);
  return out;
}
function lowerStep(c: Ctx, m: number): number {
  for (let d = 1; d <= 4; d++) if (c.scale.includes(pcOf(c, m - d))) return d;
  return 2;
}
function upperStep(c: Ctx, m: number): number {
  for (let d = 1; d <= 4; d++) if (c.scale.includes(pcOf(c, m + d))) return d;
  return 2;
}
function nearestIdx(xs: number[], m: number): number {
  let best = 0;
  for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - m) < Math.abs(xs[best] - m)) best = i;
  return best;
}
/** The tonic in the octave nearest `target`. */
const tonicNear = (c: Ctx, target: number) => c.key + 12 * Math.round((target - c.key) / 12);

function buildProg(c: Ctx, loop: string[][], final?: string): void {
  c.prog = [];
  for (let b = 0; b < c.bars; b++) c.prog.push(loop[b % loop.length].map((n) => CHORDS[n]));
  c.prog[c.bars - 1] = [CHORDS[final ?? (c.minor ? "i" : "I")]];
}
function applyThemeProg(c: Ctx, bar0: number, bars: number[]): void {
  bars.forEach((tb, j) => {
    if (bar0 + j >= 0 && bar0 + j < c.bars) c.prog[bar0 + j] = THEME_PROG[tb].map((n) => CHORDS[n]);
  });
}
function themeNotes(bars: number[], tonic: number): MNote[] {
  const out: MNote[] = [];
  bars.forEach((tb, j) => {
    let beat = j * 4;
    THEME[tb].forEach(([s, d], k) => {
      if (s !== null) out.push({ beat, beats: d, midi: tonic + s, orn: THEME_ORN[`${tb}:${k}`] });
      beat += d;
    });
  });
  return out;
}

interface PhraseOpts {
  lo: number;
  hi: number;
  cells: number[][];
  endCells: number[][];
  restP: number;
  end: "tonic" | "half";
  start?: number;
}

/**
 * Seeded pentatonic phrase: stepwise motion preferred, arch contour, strong
 * beats snapped to chord tones, leaps recovered, final note on a stable
 * degree (tonic, or a chord tone for a half cadence).
 */
function genPhrase(c: Ctx, bar0: number, nBars: number, o: PhraseOpts): MNote[] {
  const S = scaleNotes(c, o.lo, o.hi);
  const r = c.rng;
  let idx = nearestIdx(S, o.start ?? (o.lo + o.hi) / 2);
  let dir = r.chance(0.5) ? 1 : -1;
  let lastStep = 0;
  const out: MNote[] = [];
  for (let bar = 0; bar < nBars; bar++) {
    const lastBar = bar === nBars - 1;
    const cell = r.pick(lastBar ? o.endCells : o.cells);
    let pos = 0;
    for (let k = 0; k < cell.length; k++) {
      const d = cell[k];
      const absBeat = bar * c.bpb + pos;
      const ch = chordAt(c, bar0 + bar, pos);
      const final = lastBar && k === cell.length - 1;
      const strong = pos === 0 || (c.bpb === 4 && pos === 2);
      if (final) {
        const want = (m: number) =>
          o.end === "tonic" ? pcOf(c, m) === 0 : inChord(c, m, ch) && pcOf(c, m) !== 0;
        let best = -1;
        for (let i = 0; i < S.length; i++) {
          if (!want(S[i])) continue;
          if (best < 0 || Math.abs(i - idx) < Math.abs(best - idx)) best = i;
        }
        if (best < 0) for (let i = 0; i < S.length; i++) if (pcOf(c, S[i]) === 0 && (best < 0 || Math.abs(i - idx) < Math.abs(best - idx))) best = i;
        if (best >= 0) idx = best;
      } else if (out.length > 0 || bar > 0 || k > 0) {
        const p = absBeat / (nBars * c.bpb);
        const upP = p < 0.45 ? 0.64 : 0.36;
        if (Math.abs(lastStep) >= 2 && r.chance(0.7)) dir = -Math.sign(lastStep);
        else dir = r.chance(upP) ? 1 : -1;
        const step = r.weighted([0, 1, 2, 3], [0.08, 0.6, 0.25, 0.07]);
        let ni = idx + dir * step;
        if (ni < 0) ni = Math.min(S.length - 1, -ni);
        if (ni >= S.length) ni = Math.max(0, 2 * (S.length - 1) - ni);
        if (strong && !inChord(c, S[ni], ch)) {
          const a = ni + dir, b = ni - dir;
          if (a >= 0 && a < S.length && inChord(c, S[a], ch)) ni = a;
          else if (b >= 0 && b < S.length && inChord(c, S[b], ch)) ni = b;
        }
        lastStep = ni - idx;
        idx = ni;
      } else {
        // phrase opening: land on a chord tone near the start pitch
        for (const dd of [0, 1, -1, 2, -2]) {
          const i = idx + dd;
          if (i >= 0 && i < S.length && inChord(c, S[i], ch)) {
            idx = i;
            break;
          }
        }
      }
      const rest = !final && !strong && out.length > 0 && r.chance(o.restP);
      if (!rest) out.push({ beat: absBeat, beats: d, midi: S[idx] });
      pos += d;
    }
  }
  return out;
}

/** Response to a call: same rhythm, shifted by a scale step, resolving home. */
function respond(c: Ctx, call: MNote[], shiftBeats: number, lo: number, hi: number): MNote[] {
  const S = scaleNotes(c, lo, hi);
  const delta = c.rng.pick([-1, 1, 2]);
  return call.map((n, i) => {
    let idx = clamp(nearestIdx(S, n.midi) + delta, 0, S.length - 1);
    if (i === call.length - 1) {
      let best = idx;
      for (let j = 0; j < S.length; j++) if (pcOf(c, S[j]) === 0 && (pcOf(c, S[best]) !== 0 || Math.abs(j - idx) < Math.abs(best - idx))) best = j;
      idx = best;
    }
    return { beat: n.beat + shiftBeats, beats: n.beats, midi: S[idx] };
  });
}

// --- placement -------------------------------------------------------------

interface FluteOpts { lvl: number; pan?: number; jitter?: number; ornP?: number; hum?: boolean; detach?: number }
function placeFlute(c: Ctx, bar0: number, notes: MNote[], o: FluteOpts): void {
  if (!notes.length) return;
  const base = barT(c, bar0);
  const fn: FNote[] = notes.map((n) => {
    let t = base + n.beat * c.beat;
    if (o.jitter) t += c.rng.range(-o.jitter, o.jitter);
    let orn = n.orn;
    if (!orn && o.ornP && n.beats >= 1.5 && c.rng.chance(o.ornP)) orn = "scoop";
    const depth = orn === "mord" ? upperStep(c, n.midi) : lowerStep(c, n.midi);
    return { t: Math.max(0.01, t), dur: n.beats * c.beat, midi: n.midi, orn, depth };
  });
  for (let i = 0; i < fn.length; i++) {
    const n = notes[i];
    const nx = notes[i + 1];
    if (o.detach) fn[i].dur *= o.detach;
    else if (nx && Math.abs(n.beat + n.beats - nx.beat) < 1e-6) fn[i].dur = fn[i + 1].t - fn[i].t; // legato
    else fn[i].dur = n.beats * c.beat * 0.92; // breathe before a rest
    if (nx) fn[i].dur = Math.min(fn[i].dur, fn[i + 1].t - fn[i].t);
    fn[i].dur = Math.max(0.08, fn[i].dur);
  }
  c.ev.push({ k: "flute", notes: fn, lvl: o.lvl, pan: o.pan ?? 0.25, hum: !!o.hum });
}

interface ZitherOpts { vel: number; pan?: number; ring?: number; stacc?: number; bendP?: number }
function placeZither(c: Ctx, bar0: number, notes: MNote[], o: ZitherOpts): void {
  const base = barT(c, bar0);
  for (const n of notes) {
    const t = base + n.beat * c.beat + c.rng.range(-0.006, 0.006);
    const accent = n.beat % c.bpb === 0 ? 1 : 0.85;
    const bend = n.orn === "scoop" || (o.bendP && n.beats >= 1 && c.rng.chance(o.bendP)) ? -lowerStep(c, n.midi) : 0;
    c.ev.push({
      k: "pluck", t: Math.max(0, t),
      dur: o.stacc ? Math.min(o.stacc, n.beats * c.beat) : n.beats * c.beat + (o.ring ?? 0.6),
      midi: n.midi, vel: o.vel * accent * c.rng.range(0.9, 1.05), pan: (o.pan ?? -0.3) + c.rng.range(-0.05, 0.05),
      bend, vib: !o.stacc && n.beats >= 2 ? 0.2 : 0,
    });
  }
}

function pluck(c: Ctx, t: number, midi: number, vel: number, dur: number, pan = -0.3, bend = 0, vib = 0): void {
  c.ev.push({ k: "pluck", t: Math.max(0, t), dur, midi, vel, pan, bend, vib });
}

/** Rolled tonic chord on the last bar — a ringing, stable ending. */
function finalRoll(c: Ctx, vel: number, lo = 53): void {
  const b = c.bars - 1;
  const ch = c.prog[b][0];
  const pcs = ch.map((s) => mod(c.key + s, 12));
  let m = lo;
  while (mod(m, 12) !== pcs[0]) m++;
  const ms: number[] = [];
  for (; m < lo + 26 && ms.length < 5; m++) if (pcs.includes(mod(m, 12))) ms.push(m);
  ms.forEach((mm, i) => pluck(c, barT(c, b) + i * 0.075, mm, vel * (1 - i * 0.06), 4, -0.35 + i * 0.12, 0, i === ms.length - 1 ? 0.15 : 0));
}

// --- beds --------------------------------------------------------------------

type Num = number | ((p: number) => number);
const val = (x: Num, p: number) => (typeof x === "number" ? x : x(p));

/** Close voicing in [lo, hi] nearest to the previous voicing (smooth voice-leading). */
function voice(c: Ctx, ch: number[], lo: number, hi: number, prev: number[] | null): number[] {
  const pcs: number[] = [];
  for (const s of ch) {
    const p = mod(c.key + s, 12);
    if (!pcs.includes(p)) pcs.push(p);
  }
  const cands: number[][] = [];
  for (let r = 0; r < pcs.length; r++) {
    for (let base = lo; base <= hi; base++) {
      if (mod(base, 12) !== pcs[r]) continue;
      const v = [base];
      for (let k = 1; k < pcs.length; k++) {
        let m = v[v.length - 1] + 1;
        while (mod(m, 12) !== pcs[(r + k) % pcs.length]) m++;
        v.push(m);
      }
      if (pcs.length === 3) v.push(v[0] + 12);
      if (v[v.length - 1] <= hi) cands.push(v);
    }
  }
  if (!cands.length) {
    const v: number[] = [];
    let m = lo;
    for (const p of pcs) {
      while (mod(m, 12) !== p) m++;
      v.push(m);
    }
    return v;
  }
  let best = cands[0];
  let bestCost = Infinity;
  for (const v of cands) {
    let cost = 0;
    if (prev) {
      for (const x of v) cost += Math.min(...prev.map((y) => Math.abs(x - y)));
      for (const y of prev) cost += Math.min(...v.map((x) => Math.abs(x - y)));
    } else {
      cost = Math.abs(v.reduce((a, b) => a + b, 0) / v.length - (lo + hi) / 2);
    }
    if (cost < bestCost - 1e-9) {
      bestCost = cost;
      best = v;
    }
  }
  return best;
}

interface PadOpts { lvl: number; cutoff: Num; atk: number; rel: number; bright: Num; lo?: number; hi?: number; trem?: number; from?: number }
/** Sustained pad following the progression; common tones are held, not re-struck. */
function padLine(c: Ctx, o: PadOpts): void {
  const lo = o.lo ?? 52, hi = o.hi ?? 72, from = o.from ?? 0;
  const segs: { a: number; b: number; ch: number[] }[] = [];
  for (let b = from; b < c.bars; b++) {
    const s = c.prog[b];
    for (let k = 0; k < s.length; k++) {
      const a = barT(c, b, (k * c.bpb) / s.length);
      const last = segs[segs.length - 1];
      if (last && last.ch.join() === s[k].join()) continue;
      if (last) last.b = a;
      segs.push({ a, b: 0, ch: s[k] });
    }
  }
  if (!segs.length) return;
  if (from === 0) segs[0].a = 0;
  segs[segs.length - 1].b = c.endT;
  let prev: number[] | null = null;
  let active = new Map<number, PadEv>();
  for (const seg of segs) {
    const p = clamp((seg.a - c.t0) / Math.max(1e-6, c.bars * c.bar), 0, 1);
    const v = voice(c, seg.ch, lo, hi, prev);
    const next = new Map<number, PadEv>();
    for (const m of v) {
      const cur = active.get(m);
      if (cur) {
        cur.dur = seg.b - cur.t;
        next.set(m, cur);
      } else {
        const t = Math.max(0, seg.a - Math.min(0.25, o.atk * 0.2));
        const e: PadEv = { k: "pad", t, dur: seg.b - t, midi: m, lvl: o.lvl, cutoff: val(o.cutoff, p), atk: o.atk, rel: o.rel, bright: val(o.bright, p), trem: o.trem ?? 0 };
        c.ev.push(e);
        next.set(m, e);
      }
    }
    active = next;
    prev = v;
  }
}

type BassStyle = "whole" | "half" | "rootfifth" | "pulse" | "drone";
function bassLine(c: Ctx, style: BassStyle, lvl: Num, from = 0): void {
  const low = (s: number) => 36 + mod(c.key + s - 36, 12);
  if (style === "drone") {
    const t = from === 0 ? 0 : barT(c, from);
    c.ev.push({ k: "bass", t, dur: c.endT - t, midi: low(0), lvl: val(lvl, 0), atk: 3, rel: 2 });
    return;
  }
  let held: BassEv | null = null;
  for (let b = from; b < c.bars; b++) {
    const p = progress(c, b);
    const L = val(lvl, p);
    const segs = c.prog[b];
    const segBeats = c.bpb / segs.length;
    for (let k = 0; k < segs.length; k++) {
      const root = low(segs[k][0]);
      const a = barT(c, b, k * segBeats);
      if (style === "whole") {
        if (held && held.midi === root) {
          held.dur = a + segBeats * c.beat - held.t;
          continue;
        }
        held = { k: "bass", t: a, dur: segBeats * c.beat + 0.05, midi: root, lvl: L, atk: 0.15, rel: 0.6 };
        c.ev.push(held);
      } else if (style === "half") {
        for (let x = 0; x < segBeats; x += 2) {
          const m = x > 0 && c.rng.chance(0.35) ? (root + 7 <= 50 ? root + 7 : root - 5) : root;
          c.ev.push({ k: "bass", t: a + x * c.beat, dur: Math.min(2, segBeats - x) * c.beat * 0.95, midi: m, lvl: L, atk: 0.06, rel: 0.4 });
        }
      } else if (style === "rootfifth") {
        for (let x = 0; x < segBeats; x++) {
          const m = x % 2 === 0 ? root : root + 7 <= 50 ? root + 7 : root - 5;
          c.ev.push({ k: "bass", t: a + x * c.beat, dur: c.beat * 0.55, midi: m, lvl: L * (x % 2 === 0 ? 1 : 0.8), atk: 0.012, rel: 0.12 });
        }
      } else {
        for (let x = 0; x < segBeats * 2; x++) {
          const acc = x % 4 === 0 ? 1 : 0.62;
          c.ev.push({ k: "bass", t: a + x * 0.5 * c.beat, dur: 0.14, midi: root, lvl: L * acc, atk: 0.01, rel: 0.07 });
        }
      }
    }
  }
  if (held) held.dur = c.endT - held.t;
}

interface ArpOpts {
  from: number; to: number; lo: Num; span: number; sub: number; pattern: "up" | "updown" | "broken";
  vel: Num; ring: number; pan: number; density?: Num; bell?: { ratio: number; index: number; decay: number };
}
/** Broken-chord figures on the zither (or FM bells). `lo`/`vel`/`density` may follow cue progress. */
function arp(c: Ctx, o: ArpOpts): void {
  const BROKEN = [0, 2, 1, 3, 2, 4, 1, 3];
  for (let b = o.from; b < Math.min(o.to, c.bars); b++) {
    const p = progress(c, b);
    const lo = Math.round(val(o.lo, p));
    const segs = c.prog[b];
    const segBeats = c.bpb / segs.length;
    segs.forEach((ch, k) => {
      const pool: number[] = [];
      for (let m = lo; m <= lo + o.span && pool.length < 6; m++) if (inChord(c, m, ch)) pool.push(m);
      if (!pool.length) return;
      const L = pool.length;
      const steps = Math.round(segBeats * o.sub);
      for (let j = 0; j < steps; j++) {
        if (o.density !== undefined && !c.rng.chance(val(o.density, p))) continue;
        let ix: number;
        if (o.pattern === "up") ix = j % L;
        else if (o.pattern === "updown") {
          const per = Math.max(1, 2 * L - 2);
          const q = j % per;
          ix = q < L ? q : per - q;
        } else ix = Math.min(L - 1, BROKEN[j % BROKEN.length]);
        const t = barT(c, b, k * segBeats + j / o.sub) + c.rng.range(-0.005, 0.005);
        const v = val(o.vel, p) * (j % o.sub === 0 ? 1 : 0.78) * c.rng.range(0.9, 1.08);
        const pan = o.pan + c.rng.range(-0.12, 0.12);
        if (o.bell) c.ev.push({ k: "bell", t, midi: pool[ix], vel: v, ratio: o.bell.ratio, index: o.bell.index, decay: o.bell.decay, pan });
        else pluck(c, t, pool[ix], v, o.ring, pan);
      }
    });
  }
}

interface FormOpts {
  inst: "zither" | "flute" | "hum" | "alt";
  lo: number; hi: number; cells: number[][]; endCells: number[][]; restP: number;
  form: string; vel: number; pan?: number; ornP?: number; bendP?: number;
}
/** 4-bar phrases in a form (A = repeated phrase, other letters fresh), alternating half/full cadences. */
function melodyForm(c: Ctx, from: number, to: number, o: FormOpts): void {
  let A: MNote[] | null = null;
  let Aend: MNote[] = [];
  let last: number | undefined;
  const base = { lo: o.lo, hi: o.hi, cells: o.cells, endCells: o.endCells, restP: o.restP };
  for (let g = from, gi = 0; g < to; g += 4, gi++) {
    const n = Math.min(4, to - g);
    const tonicEnd = g + n >= to || gi % 2 === 1;
    const letter = o.form[gi % o.form.length];
    let notes: MNote[];
    if (n < 4) notes = genPhrase(c, g, n, { ...base, end: "tonic", start: last });
    else if (letter === "A") {
      if (!A) {
        A = genPhrase(c, g, 4, { ...base, end: "half", start: last });
        const head = A.filter((x) => x.beat < 3 * c.bpb);
        const tail = genPhrase(c, g + 3, 1, { ...base, end: "tonic", start: head[head.length - 1]?.midi }).map((x) => ({ ...x, beat: x.beat + 3 * c.bpb }));
        Aend = [...head, ...tail];
      }
      notes = tonicEnd ? Aend : A;
    } else notes = genPhrase(c, g, 4, { ...base, lo: o.lo + 2, hi: o.hi + 2, end: tonicEnd ? "tonic" : "half", start: last });
    last = notes[notes.length - 1]?.midi;
    const alt = o.inst === "alt";
    const inst = alt ? (gi % 2 === 0 ? "zither" : "flute") : o.inst;
    if (inst === "zither") placeZither(c, g, notes, { vel: o.vel, pan: alt ? -0.28 : (o.pan ?? -0.28), bendP: o.bendP ?? 0.25 });
    else placeFlute(c, g, notes, { lvl: o.vel, pan: alt ? 0.25 : (o.pan ?? 0.25), ornP: o.ornP ?? 0.3, hum: inst === "hum" });
  }
}

const wood = (c: Ctx, t: number, vel: number, freq: number, pan = 0.05) => c.ev.push({ k: "wood", t, vel, freq, pan });
const drum = (c: Ctx, t: number, vel: number, f0 = 130, f1 = 55) => c.ev.push({ k: "drum", t, vel, f0, f1 });
const cym = (c: Ctx, t: number, vel: number, decay: number) => c.ev.push({ k: "cym", t, vel, decay });

// ---------------------------------------------------------------------------
// Mood arrangements
// ---------------------------------------------------------------------------

function prologue(c: Ctx): void {
  const B = c.bars;
  const intro = B >= 6 ? 1 : 0;
  const th = themeFit(B - intro);
  buildProg(c, [["I"], ["IVadd9"]]);
  applyThemeProg(c, intro, th);
  padLine(c, { lvl: 0.5, cutoff: 750, atk: 2.8, rel: 3, bright: 0.25 });
  bassLine(c, "drone", 0.4);
  if (intro) {
    // open quartal "rung" to set the scene: F3 C4 G4
    [c.key - 12, c.key - 5, c.key + 2].forEach((m, i) => pluck(c, barT(c, 0, 0.5) + i * 0.09, m, 0.3, 4.5, -0.35 + i * 0.1, 0, i === 2 ? 0.2 : 0));
  }
  placeFlute(c, intro, themeNotes(th, tonicNear(c, 77)), { lvl: 0.8, jitter: 0.035, pan: 0.22 });
  const outro = B - intro - th.length;
  if (outro >= 2) {
    // zither echoes the opening motif an octave below, slowly
    const t = c.key;
    placeZither(c, intro + th.length, [{ beat: 0, beats: 1.5, midi: t + 4 }, { beat: 1.5, beats: 1.5, midi: t + 7 }, { beat: 3, beats: 3, midi: t + 9, orn: "scoop" }], { vel: 0.4, ring: 1.5, pan: -0.3 });
  }
  finalRoll(c, 0.3);
}

function dawn(c: Ctx): void {
  const B = c.bars;
  buildProg(c, [["I"], ["vi7"], ["IVmaj7"], ["Vsus"], ["I"], ["ii7"], ["IVadd9"], ["Vsus"]]);
  padLine(c, { lvl: 0.5, cutoff: (p) => 550 + 1300 * p, atk: 2.2, rel: 2.5, bright: (p) => 0.25 + 0.3 * p });
  bassLine(c, "whole", 0.35);
  arp(c, { from: 0, to: B, lo: (p) => 55 + 7 * p, span: 19, sub: 2, pattern: "up", vel: (p) => 0.28 + 0.2 * p, ring: 1.6, pan: -0.3, density: (p) => (p < 0.1 ? 0.6 : 0.95) });
  const fs = Math.floor(B / 2);
  let last: number | undefined;
  for (let g = fs; g < B && B - fs >= 2; g += 4) {
    const n = Math.min(4, B - g);
    const notes = genPhrase(c, g, n, { lo: 72, hi: 88, cells: CELLS.slow, endCells: CELLS.slowEnd, restP: 0.2, end: g + n >= B ? "tonic" : "half", start: last });
    last = notes[notes.length - 1]?.midi;
    placeFlute(c, g, notes, { lvl: 0.55, ornP: 0.3 });
  }
  finalRoll(c, 0.35);
}

function day(c: Ctx): void {
  const B = c.bars;
  buildProg(c, [["I"], ["vi"], ["IV"], ["Vsus"], ["I"], ["IV"], ["ii7", "Vsus"], ["I"]]);
  padLine(c, { lvl: 0.32, cutoff: 1400, atk: 0.9, rel: 1.4, bright: 0.4 });
  bassLine(c, "half", 0.35);
  arp(c, { from: 0, to: B, lo: 48, span: 16, sub: 1, pattern: "broken", vel: 0.24, ring: 0.9, pan: -0.15 });
  melodyForm(c, 0, B, { inst: "zither", lo: 67, hi: 86, cells: CELLS.med, endCells: CELLS.medEnd, restP: 0.12, form: "AABA", vel: 0.62, pan: -0.25 });
  for (let b = 0; b < B - 1; b++) {
    wood(c, barT(c, b, 1), 0.22, 820);
    wood(c, barT(c, b, 3), 0.26, 820);
    if (b % 2 === 1) wood(c, barT(c, b, 3.5), 0.13, 1150);
  }
  finalRoll(c, 0.4);
}

function playful(c: Ctx): void {
  const B = c.bars;
  buildProg(c, [["I"], ["IV"], ["Vsus"], ["I"], ["vi"], ["ii7"], ["Vsus"], ["I"]]);
  padLine(c, { lvl: 0.22, cutoff: 1600, atk: 0.4, rel: 0.8, bright: 0.45 });
  bassLine(c, "rootfifth", 0.4);
  for (let g = 0, gi = 0; g < B; g += 4, gi++) {
    const n = Math.min(4, B - g);
    if (n >= 2) {
      const cb = n >= 4 ? 2 : 1;
      const call = genPhrase(c, g, cb, { lo: 69, hi: 86, cells: CELLS.fast, endCells: CELLS.fastEnd, restP: 0.15, end: "half" });
      placeZither(c, g, call, { vel: 0.6, stacc: 0.16, pan: -0.3 });
      const resp = respond(c, call, cb * c.bpb, 69, 88);
      if (gi % 2 === 0) placeFlute(c, g, resp, { lvl: 0.6, pan: 0.3, detach: 0.72 });
      else placeZither(c, g, resp.map((x) => ({ ...x, midi: x.midi + 12 > 91 ? x.midi : x.midi + 12 })), { vel: 0.5, stacc: 0.14, pan: 0.1 });
    } else {
      placeZither(c, g, genPhrase(c, g, n, { lo: 69, hi: 86, cells: CELLS.fast, endCells: CELLS.fastEnd, restP: 0.1, end: "tonic" }), { vel: 0.55, stacc: 0.2 });
    }
  }
  const pat: [number, number, number][] = [[0, 0.34, 620], [1.5, 0.22, 950], [2, 0.26, 620], [3, 0.26, 950], [3.5, 0.15, 950]];
  for (let b = 0; b < B - 1; b++) for (const [bt, v, f] of pat) wood(c, barT(c, b, bt), v, f, f > 700 ? 0.15 : -0.05);
  finalRoll(c, 0.4);
}

function tender(c: Ctx): void {
  const B = c.bars;
  const th = themeFit(B);
  buildProg(c, [["I"], ["vi7"], ["IVmaj7"], ["Vsus"], ["I"], ["iii7"], ["ii7"], ["Vsus"]]);
  applyThemeProg(c, 0, th);
  const rem = B - th.length;
  const reprise = rem >= 8 ? 4 : 0;
  if (reprise) applyThemeProg(c, B - 4, [4, 5, 6, 7]);
  padLine(c, { lvl: 0.5, cutoff: 950, atk: 1.8, rel: 2.2, bright: 0.3 });
  bassLine(c, "whole", 0.35);
  arp(c, { from: 0, to: B, lo: 53, span: 17, sub: 1, pattern: "up", vel: 0.22, ring: 1.8, pan: -0.35 });
  placeFlute(c, 0, themeNotes(th, tonicNear(c, 77)), { lvl: 0.75, jitter: 0.02, pan: 0.22 });
  if (rem > 0) melodyForm(c, th.length, B - reprise, { inst: "zither", lo: 65, hi: 84, cells: CELLS.slow, endCells: CELLS.slowEnd, restP: 0.1, form: "AB", vel: 0.55, bendP: 0.35 });
  if (reprise) placeFlute(c, B - 4, themeNotes([4, 5, 6, 7], tonicNear(c, 77)), { lvl: 0.75, jitter: 0.02, pan: 0.22 });
  finalRoll(c, 0.3);
}

function wind(c: Ctx): void {
  const B = c.bars;
  buildProg(c, [["isus4"], ["isus4"], ["VIIsus2"], ["VIIsus2"], ["VImaj7"], ["VImaj7"], ["isus2"], ["isus2"]], "isus2");
  c.ev.push({ k: "wind", t: 0, dur: c.endT, lvl: 1 });
  padLine(c, { lvl: 0.42, cutoff: 800, atk: 2.5, rel: 3, bright: 0.35, lo: 50, hi: 70 });
  bassLine(c, "drone", 0.3);
  for (let b = 0; b < B; b++) {
    if (c.rng.chance(0.5)) {
      const ch = chordAt(c, b, 0);
      const pool = scaleNotes(c, 62, 81).filter((m) => inChord(c, m, ch));
      if (pool.length) {
        const m = c.rng.pick(pool);
        pluck(c, barT(c, b, c.rng.pick([0.5, 1, 1.5, 2.5, 3])), m, c.rng.range(0.3, 0.45), 2.5, c.rng.range(-0.5, 0.1), c.rng.chance(0.6) ? -lowerStep(c, m) : 0, 0.2);
      }
    }
    if (b % 4 === 2 && b + 1 < B && c.rng.chance(0.65)) {
      const S = scaleNotes(c, 72, 84);
      const i = 1 + c.rng.int(S.length - 1);
      placeFlute(c, b, [{ beat: 0, beats: 1.5, midi: S[i], orn: "scoop" }, { beat: 1.5, beats: 2.5, midi: S[i - 1] }], { lvl: 0.45, pan: 0.3 });
    }
  }
}

function sad(c: Ctx): void {
  const B = c.bars;
  buildProg(c, [["i"], ["VImaj7"], ["III"], ["VII"], ["iv7"], ["i"], ["VI"], ["VIIsus2"]], "i");
  padLine(c, { lvl: 0.5, cutoff: 650, atk: 2.2, rel: 2.6, bright: 0.25, lo: 48, hi: 67 });
  bassLine(c, "whole", 0.4);
  melodyForm(c, 0, B, { inst: "flute", lo: 69, hi: 86, cells: CELLS.slow, endCells: CELLS.slowEnd, restP: 0.08, form: "ABAC", vel: 0.75, ornP: 0.5, pan: 0.2 });
  for (let g = 0; g < B; g += 4) {
    const lb = Math.min(B - 1, g + 3);
    if (lb === B - 1) break;
    const ch = chordAt(c, lb, 2);
    const pool = scaleNotes(c, 57, 69).filter((m) => inChord(c, m, ch));
    if (pool.length >= 2) {
      const i = 1 + c.rng.int(pool.length - 1);
      pluck(c, barT(c, lb, 2), pool[i], 0.3, 2.5, -0.35, 0, 0.25);
      pluck(c, barT(c, lb, 3), pool[i - 1], 0.26, 2.5, -0.35, 0, 0.25);
    }
  }
  finalRoll(c, 0.25, 50);
}

function night(c: Ctx): void {
  const B = c.bars;
  buildProg(c, [["i7"], ["i7"], ["VImaj7"], ["VImaj7"], ["iv7"], ["iv7"], ["i7"], ["i7"]], "i7");
  padLine(c, { lvl: 0.38, cutoff: 550, atk: 3, rel: 3.5, bright: 0.2, lo: 52, hi: 71 });
  bassLine(c, "drone", 0.22);
  // sparse high zither "harmonics" — a slow random walk on the scale
  const S = scaleNotes(c, 79, 91);
  let ix = c.rng.int(S.length);
  for (let b = 0; b < B; b++) {
    for (let bt = 0; bt < c.bpb; bt++) {
      if (!c.rng.chance(0.26)) continue;
      ix = clamp(ix + c.rng.pick([-2, -1, -1, 1, 1, 2]), 0, S.length - 1);
      pluck(c, barT(c, b, bt + c.rng.pick([0, 0.5])), S[ix], c.rng.range(0.14, 0.26), 2.8, c.rng.range(-0.6, 0.6));
    }
  }
  // crickets: a few individuals, each with its own pitch and period
  for (let k = 0; k < 3; k++) {
    const freq = 4100 + 900 * c.rng.next();
    const period = 0.75 + 0.9 * c.rng.next();
    const pulses = 2 + c.rng.int(3);
    const pan = c.rng.range(-0.8, 0.8);
    const vel = 0.03 + 0.02 * c.rng.next();
    for (let t = 0.5 + c.rng.next() * period; t < c.endT - 0.5; t += period * c.rng.range(0.9, 1.1)) {
      if (c.rng.chance(0.08)) t += 3 * period;
      if (!c.rng.chance(0.18)) c.ev.push({ k: "cricket", t: t + c.rng.range(-0.03, 0.03), vel, freq, pulses, pan });
    }
  }
}

function mystery(c: Ctx): void {
  const B = c.bars;
  buildProg(c, [["isus2"], ["isus2"], ["VImaj7"], ["VImaj7"], ["iv7"], ["iv7"], ["isus4"], ["isus2"]], "isus2");
  bassLine(c, "drone", 0.45);
  c.ev.push({ k: "bass", t: 0, dur: c.endT, midi: 36 + mod(c.key - 36, 12) + 7, lvl: 0.2, atk: 5, rel: 2 });
  padLine(c, { lvl: 0.38, cutoff: 450, atk: 3, rel: 3, bright: 0.35, lo: 50, hi: 69 });
  const bells = scaleNotes(c, 74, 88);
  for (let b = 0; b < B; b++) {
    if (!c.rng.chance(0.6)) continue;
    const n = c.rng.chance(0.3) ? 2 : 1;
    for (let j = 0; j < n; j++) {
      c.ev.push({ k: "bell", t: barT(c, b, c.rng.pick([0, 1, 1.5, 2, 3])), midi: c.rng.pick(bells), vel: 0.35, ratio: 1.41, index: 1.1, decay: 2.6, pan: c.rng.range(-0.6, 0.6) });
    }
  }
  // curious three-note figure (question, later answered downward)
  const S = scaleNotes(c, 57, 72);
  for (let b = 1; b < B - 1; b += 4) {
    const up = (b - 1) % 8 === 0;
    const i = up ? c.rng.int(Math.max(1, S.length - 3)) : 2 + c.rng.int(Math.max(1, S.length - 2));
    const seq = up ? [S[i], S[i + 1], S[i + 2]] : [S[i], S[i - 1], S[i - 2]];
    seq.forEach((m, j) => pluck(c, barT(c, b, 1 + j * 0.5), m, 0.25, j === 2 ? 2.5 : 0.9, -0.3, j === 2 && up ? -lowerStep(c, m) : 0, j === 2 ? 0.2 : 0));
  }
}

function wonder(c: Ctx): void {
  const B = c.bars;
  buildProg(c, [["Imaj7"], ["vi7"], ["IVmaj7"], ["Vsus"], ["Imaj7"], ["iii7"], ["IVadd9"], ["Vsus"]], "Iadd9");
  const mid = Math.floor(B / 2);
  if (B >= 6) applyThemeProg(c, mid, [0, 1]);
  padLine(c, { lvl: 0.5, cutoff: (p) => 600 + 1600 * p, atk: 2, rel: 2.5, bright: (p) => 0.3 + 0.25 * p });
  bassLine(c, "whole", 0.32);
  // shimmering celesta (harmonic FM) — fireflies lighting up one by one
  arp(c, { from: 0, to: B, lo: 76, span: 14, sub: 4, pattern: "updown", vel: (p) => 0.16 + 0.1 * p, ring: 1, pan: 0.35, density: (p) => (p < 0.25 ? 0.45 : 0.85), bell: { ratio: 2, index: 0.9, decay: 1.1 } });
  arp(c, { from: 0, to: B, lo: 60, span: 17, sub: 2, pattern: "up", vel: 0.2, ring: 1.6, pan: -0.35 });
  if (B >= 6) placeFlute(c, mid, themeNotes([0, 1], tonicNear(c, 77)), { lvl: 0.5, pan: 0.2 });
  finalRoll(c, 0.3);
}

function tension(c: Ctx): void {
  const B = c.bars;
  buildProg(c, [["i"], ["i"], ["VI"], ["VII"]], "i");
  bassLine(c, "pulse", (p) => 0.35 + 0.2 * p);
  padLine(c, { lvl: 0.32, cutoff: 520, atk: 1.5, rel: 2, bright: 0.4, trem: 0.55, lo: 50, hi: 67 });
  for (let b = 0; b < B; b++) {
    drum(c, barT(c, b, 0), 0.28, 95, 45);
    drum(c, barT(c, b, 0.5), 0.17, 95, 45);
    if (b % 2 === 1) {
      // đàn tranh tremolo ("vê") on a chord tone, swelling
      const ch = chordAt(c, b, 0);
      const pool = scaleNotes(c, 64, 76).filter((m) => inChord(c, m, ch));
      const m = pool.length ? c.rng.pick(pool) : c.key + 7;
      const n = c.bpb * 6;
      for (let j = 0; j < n; j++) {
        const x = j / n;
        pluck(c, barT(c, b, j / 6), m, (0.08 + 0.14 * x) * (x > 0.9 ? 0.6 : 1), 0.3, -0.25);
      }
    }
  }
}

function triumph(c: Ctx): void {
  const B = c.bars;
  buildProg(c, [["I"], ["IV"], ["vi"], ["Vsus"], ["I"], ["IV"], ["ii7", "Vsus"], ["I"]]);
  const full = themeFit(8);
  let arpFrom = 0;
  if (B >= 16) {
    applyThemeProg(c, 0, full);
    applyThemeProg(c, 8, full);
    // the theme climbs: zither states it, then the flute an octave higher
    placeZither(c, 0, themeNotes(full, tonicNear(c, 65)), { vel: 0.62, pan: -0.25, ring: 0.5 });
    placeFlute(c, 8, themeNotes(full, tonicNear(c, 77)), { lvl: 0.85, pan: 0.22 });
    arpFrom = 8;
    if (B > 16) melodyForm(c, 16, B, { inst: "flute", lo: 77, hi: 91, cells: CELLS.med, endCells: CELLS.slowEnd, restP: 0.05, form: "AB", vel: 0.8, ornP: 0.25 });
  } else if (B >= 8) {
    applyThemeProg(c, 0, full);
    placeFlute(c, 0, themeNotes(full, tonicNear(c, 77)), { lvl: 0.85, pan: 0.22 });
    placeZither(c, 0, themeNotes(full, tonicNear(c, 65)), { vel: 0.4, pan: -0.3, ring: 0.3 });
    if (B > 8) melodyForm(c, 8, B, { inst: "zither", lo: 67, hi: 88, cells: CELLS.med, endCells: CELLS.medEnd, restP: 0.08, form: "AB", vel: 0.6 });
  } else {
    const th = themeFit(B);
    applyThemeProg(c, 0, th);
    placeFlute(c, 0, themeNotes(th, tonicNear(c, 77)), { lvl: 0.85, pan: 0.22 });
  }
  padLine(c, { lvl: 0.62, cutoff: 1800, atk: 0.8, rel: 1.5, bright: 0.55 });
  bassLine(c, "half", 0.45);
  arp(c, { from: arpFrom, to: B, lo: 60, span: 17, sub: 2, pattern: "updown", vel: 0.24, ring: 1, pan: -0.4 });
  for (let b = 0; b < B - 1; b++) {
    drum(c, barT(c, b, 0), 0.4, 120, 55);
    drum(c, barT(c, b, 2), 0.28, 120, 55);
    if (b % 4 === 0) cym(c, barT(c, b, 0), 0.16, 0.9);
  }
  drum(c, barT(c, B - 1, 0), 0.5, 120, 50);
  cym(c, barT(c, B - 1, 0), 0.2, 1.2);
  finalRoll(c, 0.45);
}

function festival(c: Ctx): void {
  const B = c.bars;
  const intro = B >= 12 ? 2 : 0;
  buildProg(c, [["I"], ["IV"], ["Vsus"], ["I"], ["vi"], ["IV"], ["Vsus"], ["I"]]);
  const th = themeFit(B - intro);
  applyThemeProg(c, intro, th);
  placeFlute(c, intro, themeNotes(th, tonicNear(c, 79)), { lvl: 0.85, pan: 0.2 });
  placeZither(c, intro, themeNotes(th, tonicNear(c, 67)), { vel: 0.42, pan: -0.3, ring: 0.3 });
  const cur = intro + th.length;
  const reprise = B - cur >= 12 ? 8 : 0;
  if (B - reprise > cur) melodyForm(c, cur, B - reprise, { inst: "alt", lo: 67, hi: 88, cells: CELLS.fast, endCells: CELLS.fastEnd, restP: 0.08, form: "ABAC", vel: 0.6, bendP: 0.15 });
  if (reprise) {
    applyThemeProg(c, B - 8, themeFit(8));
    placeFlute(c, B - 8, themeNotes(themeFit(8), tonicNear(c, 79)), { lvl: 0.85, pan: 0.2 });
    placeZither(c, B - 8, themeNotes(themeFit(8), tonicNear(c, 67)), { vel: 0.42, pan: -0.3, ring: 0.3 });
  }
  padLine(c, { lvl: 0.38, cutoff: 1500, atk: 0.5, rel: 1, bright: 0.5, from: intro });
  bassLine(c, "rootfifth", 0.45, intro);
  // trống lân (lion-dance drum): strong 1, syncopated pushes, rim "cắc", chập chả
  const DR: [number, number][] = [[0, 1], [1.5, 0.7], [2, 0.85], [3, 0.6], [3.5, 0.5]];
  for (let b = 0; b < B - 1; b++) {
    const fill = b % 4 === 3 || b === intro - 1;
    if (fill) {
      for (let e = 0; e < 8; e++) drum(c, barT(c, b, e * 0.5), 0.45 + (0.5 * e) / 7, 140, 60);
      drum(c, barT(c, b, 3.25), 0.5, 150, 65);
      drum(c, barT(c, b, 3.75), 0.6, 150, 65);
    } else {
      for (const [bt, v] of DR) drum(c, barT(c, b, bt), v * 0.9, 130, 55);
      wood(c, barT(c, b, 1), 0.2, 1500, 0.1);
      wood(c, barT(c, b, 3), 0.2, 1500, 0.1);
      cym(c, barT(c, b, 1), 0.14, 0.12);
      cym(c, barT(c, b, 3), 0.14, 0.12);
    }
    if (b % 4 === 0) cym(c, barT(c, b, 0), 0.24, 0.6);
  }
  drum(c, barT(c, B - 1, 0), 1, 140, 50);
  cym(c, barT(c, B - 1, 0), 0.28, 1.2);
  finalRoll(c, 0.45, 55);
}

function lullaby(c: Ctx): void {
  const B = c.bars;
  buildProg(c, [["I"], ["vi"], ["IV"], ["Vsus"], ["I"], ["IV"], ["Vsus"], ["I"]]);
  padLine(c, { lvl: 0.32, cutoff: 600, atk: 2.5, rel: 3, bright: 0.2, lo: 52, hi: 70 });
  bassLine(c, "whole", 0.28);
  arp(c, { from: 0, to: B, lo: 52, span: 16, sub: 1, pattern: "broken", vel: 0.22, ring: 2.4, pan: -0.3 });
  melodyForm(c, 0, B, { inst: "hum", lo: 62, hi: 76, cells: CELLS.waltz, endCells: CELLS.waltzEnd, restP: 0.1, form: "AABA", vel: 0.6, pan: 0.15, ornP: 0.15 });
  finalRoll(c, 0.25);
}

function credits(c: Ctx): void {
  const B = c.bars;
  buildProg(c, [["I"], ["IV"], ["vi"], ["Vsus"]]);
  const passes = Math.floor(B / 8);
  const intro = B - passes * 8;
  const full = themeFit(8);
  if (passes === 0) {
    const th = themeFit(B);
    applyThemeProg(c, 0, th);
    placeZither(c, 0, themeNotes(th, tonicNear(c, 65)), { vel: 0.6, pan: -0.25, ring: 0.6 });
  } else {
    if (intro >= 2) melodyForm(c, 0, intro, { inst: "zither", lo: 65, hi: 84, cells: CELLS.slow, endCells: CELLS.slowEnd, restP: 0.1, form: "AB", vel: 0.5 });
    for (let p = 0; p < passes; p++) {
      const b0 = intro + p * 8;
      applyThemeProg(c, b0, full);
      const kind = p % 3;
      if (kind === 0) placeZither(c, b0, themeNotes(full, tonicNear(c, 65)), { vel: 0.6, pan: -0.25, ring: 0.6 });
      else {
        placeFlute(c, b0, themeNotes(full, tonicNear(c, 77)), { lvl: 0.8, pan: 0.22, jitter: 0.015 });
        if (kind === 2) placeZither(c, b0, themeNotes(full, tonicNear(c, 65)), { vel: 0.38, pan: -0.3, ring: 0.4 });
        else arp(c, { from: b0, to: b0 + 8, lo: 57, span: 17, sub: 2, pattern: "up", vel: 0.22, ring: 1.4, pan: -0.35 });
      }
      if (p > 0) for (let b = b0; b < b0 + 8 && b < B - 1; b += 1) drum(c, barT(c, b, 0), 0.22, 110, 50);
    }
  }
  padLine(c, { lvl: 0.5, cutoff: 1100, atk: 1.5, rel: 2, bright: 0.4 });
  bassLine(c, "half", 0.4);
  finalRoll(c, 0.4);
}

const ARRANGE: Record<Mood, (c: Ctx) => void> = {
  prologue, dawn, day, playful, tender, wind, sad, night, mystery, wonder, tension, triumph, festival, lullaby, credits,
};

// ---------------------------------------------------------------------------
// Voices (all write into a cue-local bus: L, R, reverb send S)
// ---------------------------------------------------------------------------

interface Bus { sr: number; n: number; L: Float32Array; R: Float32Array; S: Float32Array }

/** Pad: two detuned PolyBLEP saw/triangle blends, each through a 2-pole lowpass, spread L/R. */
function renderPad(b: Bus, e: PadEv, r: Rng): void {
  const sr = b.sr;
  const f = mtof(e.midi);
  const cents = 5 + 3 * r.next();
  const dt1 = (f * Math.pow(2, -cents / 1200)) / sr;
  const dt2 = (f * Math.pow(2, (cents + 1) / 1200)) / sr;
  let p1 = r.next(), p2 = r.next();
  const nOn = Math.round(e.dur * sr), nA = Math.max(1, Math.round(e.atk * sr)), nR = Math.max(1, Math.round(e.rel * sr));
  const i0 = Math.round(e.t * sr);
  const lpA = 1 - Math.exp((-TAU * Math.min(e.cutoff, 0.4 * sr)) / sr);
  const g = e.lvl * 0.1, br = e.bright, sn = SEND.pad * 0.5;
  const tw = (TAU * 5.5) / sr, trem = e.trem;
  const { L, R, S } = b;
  let a1 = 0, b1 = 0, a2 = 0, b2 = 0;
  for (let n = 0; n < nOn + nR; n++) {
    const i = i0 + n;
    if (i >= b.n) break;
    const s1 = 2 * p1 - 1 - blep(p1, dt1), t1 = 4 * Math.abs(p1 - 0.5) - 1;
    const s2 = 2 * p2 - 1 - blep(p2, dt2), t2 = 4 * Math.abs(p2 - 0.5) - 1;
    p1 += dt1;
    if (p1 >= 1) p1 -= 1;
    p2 += dt2;
    if (p2 >= 1) p2 -= 1;
    a1 += lpA * (br * s1 + (1 - br) * t1 - a1);
    b1 += lpA * (a1 - b1);
    a2 += lpA * (br * s2 + (1 - br) * t2 - a2);
    b2 += lpA * (a2 - b2);
    if (i < 0) continue;
    let env = n < nA ? 0.5 - 0.5 * Math.cos((Math.PI * n) / nA) : 1;
    if (n >= nOn) env *= 0.5 + 0.5 * Math.cos((Math.PI * (n - nOn)) / nR);
    let amp = env * g;
    if (trem) amp *= 1 - trem * 0.5 * (1 - Math.cos(tw * n));
    const v1 = b1 * amp, v2 = b2 * amp;
    L[i] += 0.85 * v1 + 0.3 * v2;
    R[i] += 0.3 * v1 + 0.85 * v2;
    S[i] += (v1 + v2) * sn;
  }
}

/**
 * Đàn tranh: Karplus–Strong with a fractional (linear-interpolated) delay so
 * it is in tune at 24 kHz and can bend — "nhấn" glides up from the scale
 * note below, "rung" adds delayed vibrato. Seeded, pluck-position-combed
 * noise burst; 5 ms attack, 100 ms damped release.
 */
function renderPluck(b: Bus, e: PluckEv, r: Rng, dl: Float32Array): void {
  const sr = b.sr;
  const f0 = mtof(e.midi);
  const vel = clamp(e.vel, 0, 1.2);
  const N0 = Math.max(2, Math.round(sr / f0));
  const exc = new Float32Array(N0);
  const nz = new Noise(r.seed32());
  // two-pole low-passed noise: brighter when plucked harder, never spitty
  const cA = 0.22 + 0.4 * Math.min(1, vel);
  let lp = 0, lp2 = 0;
  for (let k = 0; k < N0; k++) {
    lp += cA * (nz.next() - lp);
    lp2 += cA * (lp - lp2);
    exc[k] = lp2;
  }
  const pp = Math.max(1, Math.round(N0 * (0.13 + 0.06 * r.next())));
  for (let k = N0 - 1; k >= pp; k--) exc[k] -= exc[k - pp];
  let mean = 0, pow = 1e-12;
  for (let k = 0; k < N0; k++) mean += exc[k];
  mean /= N0;
  for (let k = 0; k < N0; k++) {
    exc[k] -= mean;
    pow += exc[k] * exc[k];
  }
  // RMS-normalized burst (+ a lift for the short, fast-dying top strings)
  const ga = (0.3 * vel * (1 + Math.max(0, e.midi - 76) * 0.06)) / Math.sqrt(pow / N0);
  for (let k = 0; k < N0; k++) exc[k] *= ga;

  // Loop: linear-interp fractional delay → y = a·x[n] + (1−a)·x[n−1] → ×rho.
  // Both filters lose energy per period (more for high strings), so solve the
  // brightness `a` and gain `rho` for the target ring time T60.
  const T60 = clamp(3.6 - (e.midi - 60) * 0.07, 1.2, 4.5);
  const w = (TAU * f0) / sr, cw = Math.cos(w);
  const Hpp = Math.pow(10, -3 / (T60 * f0)); // required per-period magnitude
  const mag2 = (x: number) => 1 - 2 * x * (1 - x) * (1 - cw); // |x + (1−x)e^{−jw}|²
  let a = 0.62;
  for (let it = 0; it < 3; it++) {
    const Dn = sr / f0 - (1 - a);
    const fr = Dn - Math.floor(Dn);
    const Ht = Hpp / Math.sqrt(mag2(fr)) / 0.99995;
    const q = Ht >= 1 ? 0 : (1 - Ht * Ht) / (2 * (1 - cw));
    a = q < 0.62 * 0.38 ? (1 + Math.sqrt(1 - 4 * q)) / 2 : 0.62;
  }
  const Dn0 = sr / f0 - (1 - a);
  const H = Math.sqrt(mag2(a) * mag2(Dn0 - Math.floor(Dn0)));
  const rho = Math.min(0.99995, Hpp / H);
  dl.fill(0);
  const mask = dl.length - 1;
  const nA = Math.round(0.005 * sr), nRel = Math.round(0.1 * sr);
  const nOn = Math.min(Math.round(e.dur * sr), Math.round(T60 * 1.05 * sr));
  const i0 = Math.round(e.t * sr);
  const [gl, gr] = panGains(e.pan);
  const sn = SEND.pluck;
  const bend = e.bend, vib = e.vib;
  const moving = bend !== 0 || vib !== 0;
  let D = sr / f0 - (1 - a);
  let wI = 0, prev = 0;
  const { L, R, S } = b;
  for (let n = 0; n < nOn + nRel; n++) {
    const i = i0 + n;
    if (i >= b.n) break;
    if (moving && (n & 7) === 0) {
      const t = n / sr;
      let semis = bend ? bend * (1 - smooth(0.035, 0.2, t)) : 0;
      if (vib && t > 0.3) semis += vib * smooth(0.3, 0.7, t) * Math.sin(TAU * 5.5 * (t - 0.3));
      D = clamp(sr / (f0 * Math.pow(2, semis / 12)) - (1 - a), 2, mask - 2);
    }
    const k = D | 0, fr = D - k;
    const x0 = dl[(wI - k) & mask], x1 = dl[(wI - k - 1) & mask];
    const tap = x0 + (x1 - x0) * fr;
    const y = rho * (a * tap + (1 - a) * prev);
    prev = tap;
    const v = (n < N0 ? exc[n] : 0) + y;
    dl[wI & mask] = v;
    wI++;
    if (i < 0) continue;
    let env = n < nA ? 0.5 - 0.5 * Math.cos((Math.PI * n) / nA) : 1;
    if (n >= nOn) env *= 0.5 + 0.5 * Math.cos((Math.PI * (n - nOn)) / nRel);
    const out = v * env * 2;
    L[i] += out * gl;
    R[i] += out * gr;
    S[i] += out * sn;
  }
}

/**
 * Sáo (bamboo flute) / humming voice: one continuous oscillator per legato
 * segment (glides between notes), sine + 2nd/3rd harmonics, vibrato that
 * fades in ~0.25 s into each note, scoops/mordents, band-passed breath with
 * a chiff at note onsets. Humming: purer tone, no breath, softer envelope.
 */
function renderFlute(b: Bus, e: FluteEv, r: Rng): void {
  const sr = b.sr;
  const notes = e.notes;
  const hum = e.hum;
  const [gl, gr] = panGains(e.pan);
  const g = e.lvl * 0.2;
  const sn = SEND.flute;
  const h2 = hum ? 0.08 : 0.16, h3 = hum ? 0.02 : 0.06;
  const breath = hum ? 0 : 0.2;
  const gc = 1 - Math.exp(-1 / (0.022 * sr));
  const vw = (TAU * 5.1) / sr;
  const nz = new Noise(r.seed32());
  const { L, R, S } = b;
  let s0 = 0;
  while (s0 < notes.length) {
    let s1 = s0;
    while (s1 + 1 < notes.length && notes[s1 + 1].t - (notes[s1].t + notes[s1].dur) <= 0.06) s1++;
    const tS = notes[s0].t, tE = notes[s1].t + notes[s1].dur;
    const i0 = Math.round(tS * sr);
    const nOn = Math.max(1, Math.round((tE - tS) * sr));
    const nA = Math.round((hum ? 0.18 : 0.08) * sr), nR = Math.round((hum ? 0.35 : 0.2) * sr);
    const starts: number[] = [];
    for (let k = s0; k <= s1; k++) starts.push(Math.round((notes[k].t - tS) * sr));
    let k = 0;
    const n0 = notes[s0];
    let lp = n0.midi - (n0.orn === "scoop" ? n0.depth : 0);
    let ph = r.next(), vph = r.next() * TAU, inc = mtof(lp) / sr, F = 0.2;
    let low = 0, band = 0;
    for (let n = 0; n < nOn + nR; n++) {
      const i = i0 + n;
      if (i >= b.n) break;
      while (k + 1 < starts.length && n >= starts[k + 1]) {
        k++;
        const nt = notes[s0 + k];
        if (nt.orn === "scoop") lp = nt.midi - nt.depth;
      }
      const note = notes[s0 + k];
      const dtN = (n - starts[k]) / sr;
      let target = note.midi;
      if (note.orn === "scoop") target -= note.depth * (1 - smooth(0, 0.12, dtN));
      else if (note.orn === "mord" && dtN > 0.05 && dtN < 0.11) target += note.depth;
      lp += (target - lp) * gc;
      vph += vw;
      if ((n & 3) === 0) {
        const vd = (hum ? 0.07 : 0.14) * smooth(0.22, 0.7, dtN);
        const f = mtof(lp + vd * Math.sin(vph));
        inc = f / sr;
        F = 2 * Math.sin((Math.PI * Math.min(3800, 1.8 * f)) / sr);
      }
      ph += inc;
      if (ph >= 1) ph -= 1;
      const an = TAU * ph;
      const s = Math.sin(an), co = Math.cos(an);
      let v = s + h2 * 2 * s * co + h3 * (3 * s - 4 * s * s * s);
      if (breath) {
        const x = nz.next();
        low += F * band;
        const hp = x - low - 1.1 * band;
        band += F * hp;
        const chiff = dtN < 0.3 ? 0.5 * Math.exp(-dtN / 0.045) * (k === 0 ? 1 : 0.45) : 0;
        v += band * (breath + chiff);
      }
      if (i < 0) continue;
      let env = n < nA ? 0.5 - 0.5 * Math.cos((Math.PI * n) / nA) : 1;
      if (n >= nOn) env *= 0.5 + 0.5 * Math.cos((Math.PI * (n - nOn)) / nR);
      const art = k > 0 ? 0.74 + 0.26 * smooth(0, 0.07, dtN) : 1;
      const sw = note.dur > 0.8 ? 1 + 0.1 * Math.sin(Math.PI * Math.min(1, dtN / note.dur)) : 1;
      const out = v * env * art * sw * g;
      L[i] += out * gl;
      R[i] += out * gr;
      S[i] += out * sn;
    }
    s0 = s1 + 1;
  }
}

/** Soft sine bass/drone with a touch of 2nd/3rd harmonic. */
function renderBass(b: Bus, e: BassEv): void {
  const sr = b.sr;
  const inc = (TAU * mtof(e.midi)) / sr;
  const nOn = Math.round(e.dur * sr), nA = Math.max(Math.round(0.005 * sr), Math.round(e.atk * sr)), nR = Math.max(Math.round(0.005 * sr), Math.round(e.rel * sr));
  const i0 = Math.round(e.t * sr);
  const g = e.lvl * 0.1, sn = SEND.bass;
  const { L, R, S } = b;
  for (let n = 0; n < nOn + nR; n++) {
    const i = i0 + n;
    if (i >= b.n) break;
    if (i < 0) continue;
    const s = Math.sin(inc * n), c = Math.cos(inc * n);
    let env = n < nA ? 0.5 - 0.5 * Math.cos((Math.PI * n) / nA) : 1;
    if (n >= nOn) env *= 0.5 + 0.5 * Math.cos((Math.PI * (n - nOn)) / nR);
    const out = (s + 0.22 * 2 * s * c + 0.08 * (3 * s - 4 * s * s * s)) * env * g;
    L[i] += out;
    R[i] += out;
    S[i] += out * sn;
  }
}

/** FM bell / celesta: index decays faster than amplitude; index capped below Nyquist. */
function renderBell(b: Bus, e: BellEv): void {
  const sr = b.sr;
  const fc = mtof(e.midi), fm = fc * e.ratio;
  const index = Math.min(e.index, Math.max(0, (0.42 * sr - fc) / fm - 1));
  const len = Math.round(Math.min(7, e.decay * 5.75) * sr);
  const nA = Math.round(0.005 * sr), nEnd = Math.round(0.02 * sr);
  const kd = Math.exp(-1 / (e.decay * sr)), ki = Math.exp(-1 / (e.decay * 0.35 * sr));
  const i0 = Math.round(e.t * sr);
  const [gl, gr] = panGains(e.pan);
  const g = e.vel * 0.22, sn = SEND.bell;
  const wc = (TAU * fc) / sr, wm = (TAU * fm) / sr;
  let amp = 1, I = index;
  const { L, R, S } = b;
  for (let n = 0; n < len; n++) {
    const i = i0 + n;
    if (i >= b.n) break;
    let env = amp;
    amp *= kd;
    const v = Math.sin(wc * n + I * Math.sin(wm * n));
    I *= ki;
    if (i < 0) continue;
    if (n < nA) env *= 0.5 - 0.5 * Math.cos((Math.PI * n) / nA);
    if (n > len - nEnd) env *= (len - n) / nEnd;
    const out = v * env * g;
    L[i] += out * gl;
    R[i] += out * gr;
    S[i] += out * sn;
  }
}

/** Mõ (wooden temple block): two damped modes + a tiny noise tick. */
function renderWood(b: Bus, e: WoodEv, r: Rng): void {
  const sr = b.sr;
  const len = Math.round(0.22 * sr), nA = Math.round(0.005 * sr);
  const i0 = Math.round(e.t * sr);
  const w1 = (TAU * e.freq) / sr, w2 = (TAU * e.freq * 2.71) / sr;
  const k1 = Math.exp(-1 / (0.035 * sr)), k2 = Math.exp(-1 / (0.012 * sr)), k3 = Math.exp(-1 / (0.004 * sr));
  const [gl, gr] = panGains(e.pan);
  const g = e.vel * 0.8, sn = SEND.wood;
  const nz = new Noise(r.seed32());
  let e1 = 1, e2 = 0.35, e3 = 0.3, lp = 0;
  const { L, R, S } = b;
  for (let n = 0; n < len; n++) {
    const i = i0 + n;
    if (i >= b.n) break;
    lp += 0.5 * (nz.next() - lp);
    const v = Math.sin(w1 * n) * e1 + Math.sin(w2 * n) * e2 + lp * e3;
    e1 *= k1;
    e2 *= k2;
    e3 *= k3;
    if (i < 0) continue;
    const env = (n < nA ? 0.5 - 0.5 * Math.cos((Math.PI * n) / nA) : 1) * (n > len - nA ? (len - n) / nA : 1);
    const out = v * env * g;
    L[i] += out * gl;
    R[i] += out * gr;
    S[i] += out * sn;
  }
}

/** Trống: sine thump with a pitch drop + short low-passed skin noise. */
function renderDrum(b: Bus, e: DrumEv, r: Rng): void {
  const sr = b.sr;
  const len = Math.round(0.8 * sr), nA = Math.round(0.005 * sr), nE = Math.round(0.03 * sr);
  const i0 = Math.round(e.t * sr);
  const kp = Math.exp(-1 / (0.045 * sr)), ka = Math.exp(-1 / (0.3 * sr)), kn = Math.exp(-1 / (0.03 * sr));
  const g = e.vel * 0.35, sn = SEND.drum;
  const nz = new Noise(r.seed32());
  let ph = 0, pe = 1, ae = 1, ne = 0.3, lp = 0;
  const { L, R, S } = b;
  for (let n = 0; n < len; n++) {
    const i = i0 + n;
    if (i >= b.n) break;
    const f = e.f1 + (e.f0 - e.f1) * pe;
    pe *= kp;
    ph += (TAU * f) / sr;
    lp += 0.2 * (nz.next() - lp);
    const v = Math.sin(ph) * ae + lp * ne;
    ae *= ka;
    ne *= kn;
    if (i < 0) continue;
    const env = (n < nA ? 0.5 - 0.5 * Math.cos((Math.PI * n) / nA) : 1) * (n > len - nE ? (len - n) / nE : 1);
    const out = v * env * g;
    L[i] += out;
    R[i] += out;
    S[i] += out * sn;
  }
}

/** Chập chả (small cymbals): decorrelated high-passed noise + a few inharmonic partials. */
function renderCym(b: Bus, e: CymEv, r: Rng): void {
  const sr = b.sr;
  const len = Math.round(Math.min(2.5, e.decay * 5) * sr), nA = Math.round(0.005 * sr), nE = Math.round(0.02 * sr);
  const i0 = Math.round(e.t * sr);
  const kd = Math.exp(-1 / (e.decay * sr)), kr = Math.exp(-1 / (e.decay * 1.4 * sr));
  const parts = [3270, 4610, 5890, 7310].map((f) => (TAU * Math.min(f * r.range(0.97, 1.03), 0.45 * sr)) / sr);
  const g = e.vel * 0.42, sn = SEND.cym;
  const nl = new Noise(r.seed32()), nr = new Noise(r.seed32());
  let ll = 0, lr = 0, l2 = 0, r2 = 0, amp = 1, ra = 0.12;
  const { L, R, S } = b;
  for (let n = 0; n < len; n++) {
    const i = i0 + n;
    if (i >= b.n) break;
    const xl = nl.next(), xr = nr.next();
    ll += 0.35 * (xl - ll);
    lr += 0.35 * (xr - lr);
    const hl = xl - ll, hr = xr - lr;
    l2 += 0.35 * (hl - l2);
    r2 += 0.35 * (hr - r2);
    let ring = 0;
    for (const w of parts) ring += Math.sin(w * n);
    ring *= ra;
    ra *= kr;
    const envA = (n < nA ? 0.5 - 0.5 * Math.cos((Math.PI * n) / nA) : 1) * (n > len - nE ? (len - n) / nE : 1);
    const vl = ((hl - l2) * 0.6 * amp + ring) * envA * g;
    const vr = ((hr - r2) * 0.6 * amp + ring) * envA * g;
    amp *= kd;
    if (i < 0) continue;
    L[i] += vl;
    R[i] += vr;
    S[i] += (vl + vr) * 0.5 * sn;
  }
}

/** Cricket chirp: a few Hann-windowed sine pulses (6.5 ms rise each). */
function renderCricket(b: Bus, e: CricketEv): void {
  const sr = b.sr;
  const pl = 0.013, pp = 0.022;
  const len = Math.round(e.pulses * pp * sr);
  const i0 = Math.round(e.t * sr);
  const w = (TAU * e.freq) / sr;
  const [gl, gr] = panGains(e.pan);
  const sn = SEND.cricket;
  const { L, R, S } = b;
  for (let n = 0; n < len; n++) {
    const i = i0 + n;
    if (i >= b.n) break;
    if (i < 0) continue;
    const t = n / sr;
    const tp = t - Math.floor(t / pp) * pp;
    if (tp >= pl) continue;
    const out = Math.sin(w * n) * (0.5 - 0.5 * Math.cos((TAU * tp) / pl)) * e.vel;
    L[i] += out * gl;
    R[i] += out * gr;
    S[i] += out * sn;
  }
}

/** Wind: decorrelated band-passed noise with seeded slow sweeps, gusts and a faint whistle. */
function renderWind(b: Bus, e: WindEv, r: Rng): void {
  const sr = b.sr;
  const i0 = Math.round(e.t * sr);
  const nOn = Math.round(e.dur * sr);
  const nA = Math.max(1, Math.round(Math.min(2.5, e.dur / 3) * sr));
  const lf = Array.from({ length: 6 }, () => ({ w: (TAU * r.range(0.02, 0.11)) / sr, p: r.next() * TAU }));
  const nl = new Noise(r.seed32()), nr = new Noise(r.seed32());
  const q = 0.75, qw = 0.12;
  const g = e.lvl * 0.35, sn = SEND.wind;
  let F = 0.1, Fw = 0.2, gust = 0.5, whistle = 0;
  let lo1 = 0, ba1 = 0, lo2 = 0, ba2 = 0, lo3 = 0, ba3 = 0;
  const { L, R, S } = b;
  for (let n = 0; n < nOn; n++) {
    const i = i0 + n;
    if (i >= b.n) break;
    if ((n & 31) === 0) {
      const m1 = (Math.sin(lf[0].w * n + lf[0].p) + Math.sin(lf[1].w * n + lf[1].p) + Math.sin(lf[2].w * n + lf[2].p)) / 3;
      const m2 = (Math.sin(lf[3].w * n + lf[3].p) + Math.sin(lf[4].w * n + lf[4].p) + Math.sin(lf[5].w * n + lf[5].p)) / 3;
      const fc = 420 * Math.pow(2, 1.1 * m1);
      F = 2 * Math.sin((Math.PI * fc) / sr);
      Fw = 2 * Math.sin((Math.PI * Math.min(3500, 2.4 * fc)) / sr);
      gust = 0.25 + 0.75 * smooth(-0.6, 0.8, m2);
      whistle = 0.1 * smooth(0.35, 0.9, m2);
    }
    const xl = nl.next(), xr = nr.next();
    lo1 += F * ba1;
    ba1 += F * (xl - lo1 - q * ba1);
    lo2 += F * ba2;
    ba2 += F * (xr - lo2 - q * ba2);
    lo3 += Fw * ba3;
    ba3 += Fw * ((xl + xr) * 0.5 - lo3 - qw * ba3);
    if (i < 0) continue;
    const env = (n < nA ? 0.5 - 0.5 * Math.cos((Math.PI * n) / nA) : 1) * (n > nOn - nA ? 0.5 - 0.5 * Math.cos((Math.PI * (nOn - n)) / nA) : 1);
    const w = ba3 * whistle;
    const vl = (ba1 * gust + w * 0.8) * env * g;
    const vr = (ba2 * gust + w * 0.6) * env * g;
    L[i] += vl;
    R[i] += vr;
    S[i] += (vl + vr) * 0.5 * sn;
  }
}

function renderEvent(b: Bus, e: Ev, r: Rng, dl: Float32Array): void {
  switch (e.k) {
    case "pad": return renderPad(b, e, r);
    case "pluck": return renderPluck(b, e, r, dl);
    case "flute": return renderFlute(b, e, r);
    case "bass": return renderBass(b, e);
    case "bell": return renderBell(b, e);
    case "wood": return renderWood(b, e, r);
    case "drum": return renderDrum(b, e, r);
    case "cym": return renderCym(b, e, r);
    case "cricket": return renderCricket(b, e);
    case "wind": return renderWind(b, e, r);
  }
}

// ---------------------------------------------------------------------------
// Room: Freeverb-lite (4 damped combs + 2 allpasses per side), mono send in
// ---------------------------------------------------------------------------

function reverb(b: Bus, size: number, damp: number, wet: number): void {
  const sr = b.sr, k = sr / 44100;
  const spread = Math.round(23 * k);
  const mk = (lens: number[], off: number) => lens.map((x) => ({ buf: new Float32Array(Math.max(1, Math.round(x * k) + off)), i: 0, f: 0 }));
  const cL = mk([1116, 1188, 1277, 1356], 0), cR = mk([1116, 1188, 1277, 1356], spread);
  const aL = mk([556, 441], 0), aR = mk([556, 441], spread);
  const pd = Math.round(0.018 * sr);
  const hpA = 1 - Math.exp((-TAU * 160) / sr);
  const gIn = 0.25, d1 = damp, d2 = 1 - damp;
  let hp = 0;
  const { L, R, S } = b;
  const comb = (cs: typeof cL, x: number) => {
    let out = 0;
    for (const c of cs) {
      const y = c.buf[c.i];
      c.f = y * d2 + c.f * d1;
      c.buf[c.i] = x + c.f * size;
      if (++c.i >= c.buf.length) c.i = 0;
      out += y;
    }
    return out;
  };
  const allp = (as: typeof aL, x: number) => {
    for (const a of as) {
      const y = a.buf[a.i];
      a.buf[a.i] = x + y * 0.5;
      if (++a.i >= a.buf.length) a.i = 0;
      x = y - x;
    }
    return x;
  };
  for (let i = 0; i < b.n; i++) {
    const s = i >= pd ? S[i - pd] : 0;
    hp += hpA * (s - hp);
    const x = (s - hp) * gIn;
    L[i] += allp(aL, comb(cL, x)) * wet;
    R[i] += allp(aR, comb(cR, x)) * wet;
  }
}

// ---------------------------------------------------------------------------
// Cue + master
// ---------------------------------------------------------------------------

const REVERB_TAIL = 3;

function renderCue(cue: Cue, idx: number, totalSec: number, sr: number, seed: string, outL: Float32Array, outR: Float32Array, dl: Float32Array): void {
  const cfg = MOODS[cue.mood];
  if (!cfg) throw new Error(`Unknown mood "${String(cue.mood)}".`);
  if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end)) throw new Error(`Cue ${idx} has a non-finite start/end.`);
  const start = Math.max(0, cue.start), end = Math.min(totalSec, cue.end);
  if (end - start < 0.05) return;
  const fi = Math.max(0.05, cue.fadeIn ?? 3), fo = Math.max(0.05, cue.fadeOut ?? 3);
  const extStart = Math.max(0, start - fi / 2), extEnd = Math.min(totalSec, end + fo / 2);
  const inEnd = Math.min(extEnd, start + fi / 2), outStart = Math.max(extStart, end - fo / 2);
  const srcLen = extEnd - extStart;
  const n = Math.min(Math.ceil((srcLen + REVERB_TAIL) * sr), outL.length - Math.round(extStart * sr));
  if (n <= 0) return;

  // bar grid: nudge tempo ≤12% so a whole number of bars fills the cue
  const dur = end - start;
  const nominal = (60 / cfg.bpm) * cfg.bpb;
  let bars = Math.max(1, Math.round(dur / nominal));
  let bar = dur / bars;
  if (Math.abs(bar / nominal - 1) > 0.12) {
    bars = Math.max(1, Math.floor(dur / nominal));
    bar = nominal;
  }
  const ctx: Ctx = {
    mood: cue.mood, rng: new Rng(`${seed}|${idx}|${cue.mood}|${start.toFixed(3)}`),
    key: cfg.key, minor: cfg.minor, scale: cfg.minor ? MIN_PENT : MAJ_PENT,
    bpb: cfg.bpb, beat: bar / cfg.bpb, bar, bars, t0: start - extStart, endT: srcLen, prog: [], ev: [],
  };
  ARRANGE[cue.mood](ctx);

  const bus: Bus = { sr, n, L: new Float32Array(n), R: new Float32Array(n), S: new Float32Array(n) };
  ctx.ev.forEach((e, k) => renderEvent(bus, e, new Rng(`${seed}|${idx}|ev${k}`), dl));

  // equal-power fades on the sources (reverb tail rings on past the fade)
  const inLen = Math.max(1e-3, inEnd - extStart), outLen = Math.max(1e-3, extEnd - outStart);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const abs = extStart + t;
    let gf = 1;
    if (abs < inEnd) gf *= Math.sin((Math.PI / 2) * clamp(t / inLen, 0, 1));
    if (abs > outStart) gf *= Math.sin((Math.PI / 2) * clamp((extEnd - abs) / outLen, 0, 1));
    if (gf !== 1) {
      bus.L[i] *= gf;
      bus.R[i] *= gf;
      bus.S[i] *= gf;
    }
  }
  reverb(bus, cfg.rev.size, cfg.rev.damp, cfg.rev.wet);

  // trim to the mood's loudness, then sum into the film
  const lu = measureLoudness({ sampleRate: sr, channels: [bus.L, bus.R] }).integrated;
  const gain = Number.isFinite(lu) ? clamp(Math.pow(10, (cfg.target - lu) / 20), 0.05, 20) : 1;
  const o = Math.round(extStart * sr);
  for (let i = 0; i < n; i++) {
    outL[o + i] += bus.L[i] * gain;
    outR[o + i] += bus.R[i] * gain;
  }
}

const TARGET_LUFS = -20;
const CEILING = Math.pow(10, -1.3 / 20);

/** Look-ahead peak limiter: 5 ms linear attack (backward pass), 250 ms release. */
function limit(L: Float32Array, R: Float32Array, sr: number): void {
  const n = L.length;
  const g = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = Math.max(Math.abs(L[i]), Math.abs(R[i]));
    g[i] = p > CEILING ? CEILING / p : 1;
  }
  const rel = 1 - Math.exp(-1 / (0.25 * sr));
  let env = 1;
  for (let i = 0; i < n; i++) {
    env = Math.min(g[i], env + (1 - env) * rel);
    g[i] = env;
  }
  const step = 1 / Math.max(1, Math.round(0.005 * sr));
  env = 1;
  for (let i = n - 1; i >= 0; i--) {
    env = Math.min(g[i], env + step);
    g[i] = env;
  }
  for (let i = 0; i < n; i++) {
    L[i] = clamp(L[i] * g[i], -CEILING, CEILING);
    R[i] = clamp(R[i] * g[i], -CEILING, CEILING);
  }
}

function master(L: Float32Array, R: Float32Array, sr: number): void {
  // DC blocker (~15 Hz)
  const Rc = 1 - (TAU * 15) / sr;
  for (const ch of [L, R]) {
    let x1 = 0, y1 = 0;
    for (let i = 0; i < ch.length; i++) {
      const x = ch[i];
      const y = x - x1 + Rc * y1;
      x1 = x;
      y1 = y;
      ch[i] = y;
    }
  }
  const lu = measureLoudness({ sampleRate: sr, channels: [L, R] }).integrated;
  if (Number.isFinite(lu)) {
    const gain = Math.pow(10, (TARGET_LUFS - lu) / 20);
    for (let i = 0; i < L.length; i++) {
      L[i] *= gain;
      R[i] *= gain;
    }
  }
  limit(L, R, sr);
  // click-free file edges
  const nI = Math.min(L.length >> 2, Math.round(0.01 * sr)), nO = Math.min(L.length >> 2, Math.round(0.3 * sr));
  for (let i = 0; i < nI; i++) {
    const w = 0.5 - 0.5 * Math.cos((Math.PI * i) / nI);
    L[i] *= w;
    R[i] *= w;
  }
  for (let i = 0; i < nO; i++) {
    const j = L.length - 1 - i;
    const w = 0.5 - 0.5 * Math.cos((Math.PI * i) / nO);
    L[j] *= w;
    R[j] *= w;
  }
}

/**
 * Render the score for a cue list into a stereo buffer of `totalSec` seconds.
 * Deterministic: identical inputs (and seed) give identical samples.
 */
export function renderScore(cues: readonly Cue[], totalSec: number, opts: ScoreOptions = {}): AudioBuffer {
  const sr = Math.round(opts.sampleRate ?? 24000);
  const seed = opts.seed ?? "den-ong-sao";
  if (!Number.isFinite(totalSec) || totalSec <= 0) throw new Error("totalSec must be a positive number.");
  if (!(sr >= 8000 && sr <= 192000)) throw new Error("sampleRate must be within 8000..192000 Hz.");
  const n = Math.max(1, Math.round(totalSec * sr));
  const L = new Float32Array(n), R = new Float32Array(n);
  let dlLen = 1;
  while (dlLen < sr / 6) dlLen <<= 1; // Karplus–Strong delay line: down to ~6 Hz
  const dl = new Float32Array(dlLen);
  cues.forEach((cue, i) => renderCue(cue, i, totalSec, sr, seed, L, R, dl));
  master(L, R, sr);
  return { sampleRate: sr, channels: [L, R] };
}
