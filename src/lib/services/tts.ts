import { spawn, spawnSync } from "node:child_process";
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

export async function synthesizeSpeech(text: string, voice = "vi", speed = 160): Promise<Buffer> {
  if (!VOICE_RE.test(voice)) throw new AppError("VALIDATION", `Invalid TTS voice "${voice}".`, 'Use an espeak-ng voice id like "vi", "en-us", "vi-vn-x-central".');
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
