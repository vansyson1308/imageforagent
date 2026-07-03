/**
 * Smoke test Veo thật — 1 clip Lite 4s 720p (~$0.20). KHÔNG nằm trong npm test.
 * Usage: node scripts/smoke-veo.mjs [đường-dẫn-ảnh-frame.png]
 */
import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import fs from "node:fs";

const apiKey = process.env.GEMINI_API_KEY?.trim();
if (!apiKey) {
  console.error("❌ Thiếu GEMINI_API_KEY trong .env");
  process.exit(1);
}

const model = process.env.GEMINI_VEO_MODEL_LITE?.trim() || "veo-3.1-lite-generate-preview";
const imagePath = process.argv[2] || "storage/_smoke/smoke.png";

if (!fs.existsSync(imagePath)) {
  console.error(`❌ Không thấy ảnh ${imagePath} — truyền path ảnh frame làm tham số.`);
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });
console.log(`[smoke-veo] model=${model}, image=${imagePath}, 4s 720p 16:9...`);
const t0 = Date.now();

try {
  let operation = await ai.models.generateVideos({
    model,
    prompt:
      "Animate this 2D cartoon frame: the fox mascot waves hello warmly, " +
      "gentle ambient motion in the restaurant, camera locked off. " +
      "Keep the exact art style and character design of the image.",
    image: {
      imageBytes: fs.readFileSync(imagePath).toString("base64"),
      mimeType: "image/png",
    },
    config: {
      durationSeconds: 4,
      aspectRatio: "16:9",
      resolution: "720p",
      personGeneration: "allow_adult",
      numberOfVideos: 1,
    },
  });

  while (!operation.done) {
    process.stdout.write(`  … đợi (${Math.round((Date.now() - t0) / 1000)}s)\r`);
    await new Promise((r) => setTimeout(r, 10_000));
    operation = await ai.operations.getVideosOperation({ operation });
  }

  const resp = operation.response;
  if ((resp?.raiMediaFilteredCount ?? 0) > 0) {
    console.error("❌ Bị safety filter:", resp.raiMediaFilteredReasons?.join("; "));
    process.exit(1);
  }
  const video = resp?.generatedVideos?.[0]?.video;
  if (!video) {
    console.error("❌ Không có video trong response:", JSON.stringify(resp)?.slice(0, 300));
    process.exit(1);
  }

  let buffer;
  if (video.videoBytes) {
    buffer = Buffer.from(video.videoBytes, "base64");
  } else if (video.uri) {
    const res = await fetch(video.uri, {
      headers: { "x-goog-api-key": apiKey },
      redirect: "follow",
    });
    if (!res.ok) {
      console.error(`❌ Tải video lỗi HTTP ${res.status}`);
      process.exit(1);
    }
    buffer = Buffer.from(await res.arrayBuffer());
  } else {
    console.error("❌ Video không có bytes lẫn uri");
    process.exit(1);
  }

  fs.mkdirSync("storage/_smoke", { recursive: true });
  fs.writeFileSync("storage/_smoke/smoke-clip.mp4", buffer);
  console.log(
    `\n✅ OK: ${buffer.length} bytes trong ${Math.round((Date.now() - t0) / 1000)}s → storage/_smoke/smoke-clip.mp4`,
  );
} catch (err) {
  console.error("\n❌ FAILED:", err?.message ?? err);
  process.exit(1);
}
