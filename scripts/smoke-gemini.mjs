/**
 * Smoke test Gemini API thật — chạy thủ công, KHÔNG nằm trong npm test.
 * Usage:  node scripts/smoke-gemini.mjs [--image]
 *   (mặc định chỉ test text structured output — rẻ;
 *    thêm --image để test tạo 1 ảnh 16:9 1K — tốn ~1 lượt ảnh)
 */
import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import fs from "node:fs";

const apiKey = process.env.GEMINI_API_KEY?.trim();
if (!apiKey) {
  console.error("❌ Chưa có GEMINI_API_KEY trong .env — dán key vào rồi chạy lại.");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });
const textModel = process.env.GEMINI_TEXT_MODEL?.trim() || "gemini-flash-latest";
const imageModel = process.env.GEMINI_IMAGE_MODEL?.trim() || "gemini-3.1-flash-image";

// ---- 1. Text structured output ----
console.log(`[1/2] Text structured output (${textModel})...`);
try {
  const interaction = await ai.interactions.create({
    model: textModel,
    system_instruction:
      "Return the frames with descriptions translated to English. JSON only.",
    input: JSON.stringify({
      instruction: "translate to English",
      frames: [{ index: 1, shotType: "Static shot", description: "Chú cáo vẫy tay chào" }],
    }),
    response_format: {
      type: "text",
      mime_type: "application/json",
      schema: {
        type: "object",
        properties: {
          frames: {
            type: "array",
            items: {
              type: "object",
              properties: {
                index: { type: "integer" },
                shotType: { type: "string" },
                description: { type: "string" },
              },
              required: ["index", "shotType", "description"],
            },
          },
        },
        required: ["frames"],
      },
    },
  });
  const parsed = JSON.parse(interaction.output_text ?? "null");
  if (!parsed?.frames?.[0]?.description) throw new Error("Thiếu frames trong kết quả");
  console.log("  ✅ OK:", JSON.stringify(parsed.frames[0]));
} catch (err) {
  console.error("  ❌ Text FAILED:", err?.message ?? err);
  process.exit(1);
}

// ---- 2. Image generation (tùy chọn --image) ----
if (!process.argv.includes("--image")) {
  console.log("[2/2] Bỏ qua test ảnh (thêm --image để chạy). Smoke text PASS.");
  process.exit(0);
}

console.log(`[2/2] Image generation (${imageModel}, 16:9, 1K)...`);
try {
  const interaction = await ai.interactions.create({
    model: imageModel,
    input:
      "A cheerful orange fox mascot waving hello inside a cozy ramen restaurant, " +
      "flat 2D cartoon style, bold outlines, warm lighting. No text in image.",
    response_format: {
      type: "image",
      mime_type: "image/png",
      aspect_ratio: "16:9",
      image_size: "1K",
    },
  });
  const image = interaction.output_image;
  if (!image?.data) {
    throw new Error(`Không có ảnh trả về. output_text=${(interaction.output_text ?? "").slice(0, 200)}`);
  }
  const buffer = Buffer.from(image.data, "base64");
  fs.mkdirSync("storage/_smoke", { recursive: true });
  fs.writeFileSync("storage/_smoke/smoke.png", buffer);
  console.log(`  ✅ OK: ${buffer.length} bytes → storage/_smoke/smoke.png`);
} catch (err) {
  console.error("  ❌ Image FAILED:", err?.message ?? err);
  process.exit(1);
}
console.log("Smoke PASS toàn bộ.");
