import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AppError } from "@/lib/services/apiError";

/**
 * tts — giọng đọc LOCAL, ZERO-KEY qua espeak-ng (nếu máy có cài): giọng
 * scratch cho animatic, lip-sync và timing thoại. Bảo mật: spawn với mảng
 * tham số (không shell), văn bản đi qua STDIN (không thể chèn cờ/lệnh),
 * voice id qua regex, timeout cứng. Thay bằng giọng thu thật bất cứ lúc nào
 * bằng cách gửi WAV.
 */

const VOICE_RE = /^[a-z]{2,3}([-+][\w-]{1,32})?$/;
let available: boolean | null = null;

export function ttsAvailable(): boolean {
  if (available === null) {
    try {
      available = spawnSync("espeak-ng", ["--version"], { stdio: "ignore", timeout: 5000 }).status === 0;
    } catch {
      available = false;
    }
  }
  return available;
}

/** Local TTS engines found on this server (for /api/health). */
export function ttsEngines(): string[] {
  const piper = piperVoices();
  return [...(piper.length ? [`piper (${piper.join(", ")})`] : []), ...(ttsAvailable() ? ["espeak-ng"] : [])];
}

// ---------- Piper neural voices (SPEC v2 WP4.5, DECISIONS D32) ----------

/**
 * Piper (rhasspy) runs as a SEPARATE PROCESS (`python -m piper`, argv array,
 * text on stdin, hard timeout), exactly like espeak-ng. piper-tts is
 * GPL-3.0; it is invoked, never linked, so this repo stays MIT. Voices are
 * ONNX models in PIPER_VOICES_DIR (the Docker image bakes them in, pinned
 * by hash: scripts/fetch-voices.sh). Voice ids: "piper:<model>[#speaker][@semitones]".
 */
export const PIPER_MODELS = {
  "en_US-kristin-medium": { lang: "en", licence: "public domain (LibriVox)", speakers: 1 },
  "en_US-john-medium": { lang: "en", licence: "public domain (LibriVox)", speakers: 1 },
  "vi_VN-vais1000-medium": { lang: "vi", licence: "CC BY 4.0 (VAIS-1000)", speakers: 1 },
  "ja_JP-hi_fi_captain-medium": { lang: "ja", licence: "CC BY-NC-SA 4.0 (Hi-Fi-CAPTAIN, NICT): non-commercial only", speakers: 2 },
} as const;
export type PiperModel = keyof typeof PIPER_MODELS;

const PIPER_RE = /^piper:([A-Za-z]{2}_[A-Za-z]{2}-[a-z0-9_]+-(?:x_low|low|medium|high))(?:#(\d{1,2}))?(?:@(-?\d{1,2}))?$/;

export function piperVoicesDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.PIPER_VOICES_DIR || "/opt/piper/voices";
}

let piperOk: boolean | null = null;
function piperPython(env: NodeJS.ProcessEnv = process.env): string {
  return env.PIPER_PYTHON || "/opt/piper/venv/bin/python";
}

/** Languages with an installed Piper voice (empty when Piper or its voices are missing). */
export function piperVoices(env: NodeJS.ProcessEnv = process.env): string[] {
  if (piperOk === null) {
    try {
      piperOk = existsSync(piperPython(env)) && spawnSync(piperPython(env), ["-c", "import piper"], { stdio: "ignore", timeout: 15_000 }).status === 0;
    } catch {
      piperOk = false;
    }
  }
  if (!piperOk) return [];
  const dir = piperVoicesDir(env);
  return [...new Set(Object.entries(PIPER_MODELS).filter(([m]) => existsSync(path.join(dir, `${m}.onnx`))).map(([, v]) => v.lang))];
}

export function piperHas(model: PiperModel, env: NodeJS.ProcessEnv = process.env): boolean {
  return piperVoices(env).length > 0 && existsSync(path.join(piperVoicesDir(env), `${model}.onnx`));
}

/** Test hook. */
export function resetTtsCache(): void {
  piperOk = null;
  available = null;
}

function run(cmd: string, args: string[], input: Buffer | string | null, timeoutMs: number): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.stderr.on("data", (c: Buffer) => (err += c.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new AppError("INTERNAL", `TTS failed: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new AppError("VALIDATION", `TTS failed (${code}): ${err.slice(-200)}`, "Check the voice id and text."));
      else resolve(Buffer.concat(chunks));
    });
    child.stdin.end(input ?? "");
  });
}

/**
 * Shift pitch by `semitones` keeping the duration exactly (ffmpeg rubberband,
 * argv only). Falls back to asetrate+atempo, then to the unshifted line: a
 * pitch problem never loses a voice.
 */
export async function pitchShift(wav: Buffer, semitones: number, sampleRate = 22050): Promise<Buffer> {
  if (!semitones) return wav;
  const f = 2 ** (semitones / 12);
  const io = (filter: string) => ["-v", "error", "-f", "wav", "-i", "pipe:0", "-af", filter, "-f", "wav", "-acodec", "pcm_s16le", "pipe:1"];
  for (const filter of [`rubberband=pitch=${f.toFixed(5)}`, `asetrate=${Math.round(sampleRate * f)},aresample=${sampleRate},atempo=${(1 / f).toFixed(5)}`]) {
    try {
      return await run("ffmpeg", io(filter), wav, 20_000);
    } catch {
      // next method
    }
  }
  return wav;
}

async function synthesizePiper(text: string, voice: string, speed: number): Promise<Buffer> {
  const m = voice.match(PIPER_RE);
  if (!m || !(m[1] in PIPER_MODELS)) throw new AppError("VALIDATION", `Invalid Piper voice "${voice}".`, `Use piper:<model> with one of ${Object.keys(PIPER_MODELS).join(", ")}.`);
  const model = m[1] as PiperModel;
  if (!piperHas(model)) throw new AppError("VALIDATION", `Piper voice ${model} is not installed on this server.`, "Use an espeak-ng voice id, or install the voice (scripts/fetch-voices.sh).");
  const speaker = m[2] ? Math.min(Number(m[2]), PIPER_MODELS[model].speakers - 1) : 0;
  const semitones = m[3] ? Math.max(-6, Math.min(6, Number(m[3]))) : 0;
  const clean = text.replace(/[\u0000-\u0008\u000b-\u001f]/g, " ").slice(0, 2000);
  const dir = await mkdtemp(path.join(os.tmpdir(), "piper-"));
  try {
    const out = path.join(dir, "line.wav");
    // speed: espeak's words per minute (150 = normal) → Piper's length scale
    const lengthScale = Math.max(0.6, Math.min(1.6, 150 / Math.max(80, speed)));
    const args = ["-m", "piper", "-m", path.join(piperVoicesDir(), `${model}.onnx`), "-f", out, "--length-scale", lengthScale.toFixed(3), "--sentence-silence", "0.2"];
    if (PIPER_MODELS[model].speakers > 1) args.push("-s", String(speaker));
    await run(piperPython(), args, clean, 60_000);
    return pitchShift(await readFile(out), semitones);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function synthesizeSpeech(text: string, voice = "vi", speed = 160): Promise<Buffer> {
  if (voice.startsWith("piper:")) return synthesizePiper(text, voice, speed);
  if (!VOICE_RE.test(voice)) throw new AppError("VALIDATION", `Invalid TTS voice "${voice}".`, 'Use an espeak-ng voice id like "vi", "en-us", "vi-vn-x-central", or a Piper voice like "piper:en_US-kristin-medium".');
  if (!ttsAvailable()) {
    throw new AppError(
      "VALIDATION",
      "Local TTS (espeak-ng) is not installed on this server.",
      'Install espeak-ng (apt install espeak-ng) or send your own voice as {"wav": "<base64>"}.',
    );
  }
  const clean = text.replace(/[\u0000-\u0008\u000b-\u001f]/g, " ").slice(0, 2000);
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn("espeak-ng", ["-v", voice, "-s", String(Math.round(speed)), "--stdout"], { stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.stderr.on("data", (c: Buffer) => (err += c.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new AppError("INTERNAL", `TTS failed: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new AppError("VALIDATION", `TTS failed (${code}): ${err.slice(0, 200)}`, "Check the voice id and text."));
      else resolve(Buffer.concat(chunks));
    });
    child.stdin.end(clean, "utf8");
  });
}
