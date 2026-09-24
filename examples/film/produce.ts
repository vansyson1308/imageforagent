/**
 * Producer: makes the film through the REAL app API, exactly as an agent
 * would — no shortcuts into the database or the renderer.
 *
 *   npx tsx examples/film/produce.ts [--base http://localhost:3000] [--state /tmp/film-state.json] [--only 3.] [--export DIR]
 *
 * 1. POST /api/projects, PATCH it to DCI Flat 1.85:1 at 2K
 * 2. POST /api/script/import (one TSV row per shot)
 * 3. per shot: PATCH scene/transition → PUT dialogue (local TTS) → PUT motion (renders the clip)
 * 4. compose the score on the project's own timeline → PUT soundtrack
 * 5. GET lint → GET export ZIP → unzip → sh assemble.sh (film.mp4)
 *
 * Resumable: a state file remembers the project and a hash of every shot
 * already rendered, so a crash or restart only redoes what changed.
 */
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { buildShot, VOICES, type BuiltShot } from "./shots";
import { SHOTS } from "./screenplay";
import { renderScore, type Cue, type Mood } from "./score";
import { encodeWav } from "@/lib/services/audio/wav";
import { buildTimeline, timelineDuration } from "@/lib/services/timeline";

const argv = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : d;
};
const BASE = arg("--base", "http://localhost:3000");
const STATE = arg("--state", "/tmp/claude-0/film/produce-state.json");
const ONLY = arg("--only", "");
const EXPORT_DIR = arg("--export", "/tmp/claude-0/film/export");
const TITLE = "Đèn Ông Sao";

interface State {
  projectId?: string;
  frameIds?: string[];
  done: Record<string, string>;
  voice: Record<string, string>;
  meta: Record<string, string>;
  soundtrack?: string;
}
const state: State = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : { done: {}, voice: {}, meta: {} };
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 1));
const hash = (x: unknown) => createHash("sha1").update(JSON.stringify(x)).digest("hex").slice(0, 16);
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function api<T = Record<string, unknown>>(method: string, url: string, body?: unknown): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}${url}`, {
      method,
      headers: body !== undefined ? { "content-type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 && attempt < 30) {
      await new Promise((r) => setTimeout(r, 4000));
      continue;
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${url} → ${res.status}: ${text.slice(0, 800)}`);
    return (text ? JSON.parse(text) : {}) as T;
  }
}

/** Mood per shot (score cues follow the story beats). */
function moodOf(id: string): Mood {
  const table: [string, Mood][] = [
    ["1.00", "prologue"], ["1.01", "dawn"], ["1.02", "dawn"], ["1.03", "dawn"], ["1.04", "dawn"], ["1.05", "playful"],
    ["1.06", "day"], ["1.07", "playful"], ["1.08", "tender"], ["1.09", "tender"], ["1.10", "tender"], ["1.11", "tender"], ["1.12", "tender"],
    ["1.13", "playful"], ["1.14", "playful"],
    ["2.01", "tender"], ["2.02", "playful"], ["2.03", "playful"], ["2.04", "wind"], ["2.05", "wind"], ["2.06", "wind"], ["2.07", "wind"],
    ["2.08", "sad"], ["2.09", "sad"], ["2.10", "sad"], ["2.11", "night"], ["2.12", "mystery"],
    ["3.01", "wonder"], ["3.02", "wonder"], ["3.03", "mystery"], ["3.04", "mystery"], ["3.05", "night"], ["3.06", "mystery"], ["3.07", "mystery"],
    ["3.08", "tension"], ["3.09", "playful"], ["3.10", "wonder"], ["3.11", "wonder"],
    ["4.01", "tension"], ["4.02", "tension"], ["4.03", "tension"], ["4.04", "tension"], ["4.05", "tension"], ["4.06", "triumph"],
    ["4.07", "playful"], ["4.08", "playful"], ["4.09", "mystery"], ["4.10", "tension"], ["4.11", "tension"], ["4.12", "sad"], ["4.13", "sad"],
    ["5.01", "wonder"], ["5.02", "wonder"], ["5.03", "triumph"], ["5.04", "wonder"], ["5.05", "triumph"], ["5.06", "triumph"], ["5.07", "wonder"],
    ["5.08", "tender"], ["5.09", "tender"], ["5.10", "triumph"],
    ["6.07", "tender"], ["6.08", "tender"], ["6.12", "wonder"], ["6.12c", "lullaby"], ["6.", "festival"],
    ["7.06", "credits"], ["7.07", "credits"], ["7.08", "credits"], ["7.09", "credits"], ["7.", "lullaby"],
  ];
  // longest matching prefix wins ("1.07a" → "1.07", "6.12c" beats "6.12")
  let best: [string, Mood] = ["", "day"];
  for (const row of table) if (id.startsWith(row[0]) && row[0].length > best[0].length) best = row;
  return best[1];
}

function timelineOf(built: readonly BuiltShot[]) {
  return buildTimeline(
    built.map((b, i) => ({
      index: i + 1,
      description: b.def.desc,
      clip: { fps: b.motion.fps, frameCount: Math.max(1, Math.round(b.motion.duration * b.motion.fps)), duration: b.motion.duration },
      voice: null,
      transition: { kind: b.def.transition?.[0] ?? "cut", duration: b.def.transition?.[1] ?? 0.5 },
      scene: b.def.scene,
    })),
    1.5,
  );
}

function cuesOf(built: readonly BuiltShot[]): { cues: Cue[]; total: number } {
  const tl = timelineOf(built);
  const cues: Cue[] = [];
  tl.forEach((e, i) => {
    const mood = moodOf(built[i].def.id);
    const end = e.startSec + e.durationSec;
    const last = cues[cues.length - 1];
    if (last && last.mood === mood) last.end = end;
    else cues.push({ start: e.startSec + (e.transitionIn ? e.transitionIn.duration / 2 : 0), end, mood });
  });
  for (let i = 1; i < cues.length; i++) cues[i - 1].end = cues[i].start;
  return { cues, total: timelineDuration(tl) };
}

async function main() {
  const t0 = Date.now();
  const built = SHOTS.map(buildShot);
  const { cues, total } = cuesOf(built);
  log(`screenplay: ${built.length} shots, film ${(total / 60).toFixed(2)} min, ${cues.length} music cues`);

  // ---------- 1–2. project + script ----------
  if (!state.projectId) {
    const project = await api<{ id: string }>("POST", "/api/projects", { name: TITLE });
    state.projectId = project.id;
    save();
    await api("PATCH", `/api/projects/${project.id}`, { aspectRatio: "1.85:1", resolution: "2K", playbackSpeed: 3 });
    const tsv = ["STT\tShot Type\tDescription", ...built.map((b, i) => `${i + 1}\t${b.def.shotType}\t${b.def.desc}`)].join("\n");
    const imp = await api<{ frames: { id: string; index: number }[] }>("POST", "/api/script/import", { projectId: project.id, source: "tsv", tsvText: tsv, confirmOverwrite: true });
    state.frameIds = imp.frames.sort((a, b) => a.index - b.index).map((f) => f.id);
    save();
    log(`project ${project.id}: ${state.frameIds.length} frames imported`);
  }
  const pid = state.projectId!;
  const frameIds = state.frameIds!;
  if (frameIds.length !== built.length) throw new Error(`project has ${frameIds.length} frames, screenplay ${built.length} — use a fresh --state`);

  // ---------- 3. shots ----------
  let rendered = 0;
  let renderSec = 0;
  for (let i = 0; i < built.length; i++) {
    const b = built[i];
    const fid = frameIds[i];
    if (ONLY && !b.def.id.startsWith(ONLY)) continue;
    const metaH = hash([b.def.scene, b.def.transition, b.def.shotType, b.def.desc]);
    if (state.meta[b.def.id] !== metaH) {
      await api("PATCH", `/api/frames/${fid}`, {
        scene: b.def.scene,
        shotType: b.def.shotType,
        description: b.def.desc,
        transition: b.def.transition?.[0] ?? "cut",
        ...(b.def.transition ? { transitionDuration: b.def.transition[1] } : {}),
      });
      state.meta[b.def.id] = metaH;
      save();
    }
    const voiceH = hash(b.def.line ?? null);
    if (state.voice[b.def.id] !== voiceH) {
      if (b.def.line) {
        const v = VOICES[b.def.line.by];
        await api("PUT", `/api/frames/${fid}/dialogue`, { text: b.def.line.text, tts: { voice: v.voice, speed: v.speed }, offset: b.def.line.offset ?? 0 });
      } else if (state.voice[b.def.id]) {
        await api("DELETE", `/api/frames/${fid}/dialogue`);
      }
      state.voice[b.def.id] = voiceH;
      delete state.done[b.def.id]; // lip-sync depends on the voice
      save();
    }
    const h = hash(b.json);
    if (state.done[b.def.id] === h) continue;
    const s0 = Date.now();
    const res = await api<{ status: string; errorMsg?: string; stats?: { frameCount: number }; warnings?: string[] }>("PUT", `/api/frames/${fid}/motion`, { motion: b.json });
    const sec = (Date.now() - s0) / 1000;
    renderSec += sec;
    rendered++;
    if (res.status !== "done") throw new Error(`shot ${b.def.id}: status ${res.status} ${res.errorMsg ?? ""}`);
    state.done[b.def.id] = h;
    save();
    const left = built.slice(i + 1).filter((x) => !ONLY || x.def.id.startsWith(ONLY)).reduce((a, x) => a + x.def.dur, 0);
    const rate = renderSec / Math.max(1, built.slice(0, i + 1).filter((x) => state.done[x.def.id]).reduce((a, x) => a + x.def.dur, 0));
    log(`${b.def.id.padEnd(6)} ${String(res.stats?.frameCount ?? "?").padStart(4)} frames ${sec.toFixed(1).padStart(6)}s  (~${((left * rate) / 60).toFixed(0)} min left)`);
  }
  if (ONLY) return;

  // ---------- 4. score ----------
  const scoreH = hash(cues);
  if (state.soundtrack !== scoreH) {
    log("composing score…");
    const audio = renderScore(cues, total + 2, { sampleRate: 24000 });
    const wav = encodeWav(audio, 16);
    mkdirSync(path.dirname(STATE), { recursive: true });
    writeFileSync(path.join(path.dirname(STATE), "score.wav"), wav);
    await api("PUT", `/api/projects/${pid}/soundtrack`, { wav: wav.toString("base64") });
    state.soundtrack = scoreH;
    save();
    log(`soundtrack uploaded (${(wav.length / 1e6).toFixed(1)} MB, ${cues.length} cues)`);
  }

  // ---------- 5. lint → export → assemble ----------
  const lint = await api<{ ok: boolean; durationSec: number; summary: Record<string, number>; findings: { severity: string; code: string; message: string }[] }>("GET", `/api/projects/${pid}/lint`);
  const issues = lint.findings ?? [];
  log(`lint: ok=${lint.ok} ${JSON.stringify(lint.summary)} — server timeline ${(lint.durationSec / 60).toFixed(2)} min`);
  for (const x of issues.filter((y) => y.severity !== "info").slice(0, 20)) log(`  ${x.severity} ${x.code} ${x.message}`);
  writeFileSync(path.join(path.dirname(STATE), "lint.json"), JSON.stringify(issues, null, 1));

  log("exporting…");
  rmSync(EXPORT_DIR, { recursive: true, force: true });
  mkdirSync(EXPORT_DIR, { recursive: true });
  const zip = `${EXPORT_DIR}.zip`;
  const res = await fetch(`${BASE}/api/export/zip?projectId=${pid}`);
  if (!res.ok || !res.body) throw new Error(`export → ${res.status}`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(zip));
  const unzip = spawnSync("unzip", ["-q", "-o", zip, "-d", EXPORT_DIR], { stdio: "inherit" });
  if (unzip.status !== 0) throw new Error("unzip failed");
  rmSync(zip, { force: true });
  log("assembling film.mp4…");
  const asm = spawnSync("sh", ["assemble.sh"], { cwd: EXPORT_DIR, stdio: "inherit" });
  if (asm.status !== 0) throw new Error("assemble.sh failed");
  log(`done in ${((Date.now() - t0) / 60000).toFixed(1)} min → ${EXPORT_DIR}/film.mp4 (rendered ${rendered} shots this run)`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
