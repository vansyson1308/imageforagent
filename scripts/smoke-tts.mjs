/**
 * Smoke test Gemini TTS — xác minh model ID hoạt động (chi phí không đáng kể).
 * Thử GEMINI_TTS_MODEL trước, rồi lần lượt các ứng viên; in model nào PASS.
 * Usage: node scripts/smoke-tts.mjs
 */
import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import fs from "node:fs";

const apiKey = process.env.GEMINI_API_KEY?.trim();
if (!apiKey) {
  console.error("❌ Thiếu GEMINI_API_KEY trong .env");
  process.exit(1);
}

const candidates = [
  ...(process.env.GEMINI_TTS_MODEL ? [process.env.GEMINI_TTS_MODEL.trim()] : []),
  "gemini-3.1-flash-tts-preview",
  "gemini-2.5-flash-tts",
  "gemini-2.5-flash-preview-tts",
];

const ai = new GoogleGenAI({ apiKey });
const text = "Chào mừng đến với quán mì Tantan, nơi mọi tô mì đều được nấu bằng cả trái tim.";

function pcmToWav(pcm, sampleRate, channels) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE((sampleRate * channels * 16) / 8, 28);
  header.writeUInt16LE((channels * 16) / 8, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

for (const model of [...new Set(candidates)]) {
  process.stdout.write(`[smoke-tts] thử ${model} … `);
  try {
    const interaction = await ai.interactions.create({
      model,
      input: text,
      generation_config: { speech_config: [{ voice: "Kore" }] },
      response_format: { type: "audio" },
    });
    const audio = interaction.output_audio;
    if (!audio?.data) {
      console.log("❌ không có output_audio");
      continue;
    }
    const pcm = Buffer.from(audio.data, "base64");
    const isWav = pcm.subarray(0, 4).toString() === "RIFF";
    const wav = isWav ? pcm : pcmToWav(pcm, 24000, 1);
    fs.mkdirSync("storage/_smoke", { recursive: true });
    fs.writeFileSync("storage/_smoke/smoke-tts.wav", wav);
    console.log(
      `✅ PASS (${wav.length} bytes, mime=${audio.mime_type ?? "?"}) → storage/_smoke/smoke-tts.wav`,
    );
    console.log(`\n→ Dùng model này: GEMINI_TTS_MODEL="${model}"`);
    process.exit(0);
  } catch (err) {
    console.log(`❌ ${String(err?.message ?? err).slice(0, 120)}`);
  }
}
console.error("\n❌ Không model TTS nào hoạt động — kiểm tra docs speech-generation.");
process.exit(1);
