import sharp from "sharp";
import type { ImageRequest } from "@/lib/services/promptComposer";
import type { GeneratedImage, ImageProvider } from "@/lib/providers/types";

/** Kích thước theo ratio × resolution — đủ cho dev/preview, không cần khớp Gemini. */
const BASE_WIDTH: Record<string, number> = { "1K": 1024, "2K": 2048 };

function dimensions(aspectRatio: string, resolution: string): { w: number; h: number } {
  const base = BASE_WIDTH[resolution] ?? 1024;
  const [rw, rh] = aspectRatio.split(":").map(Number);
  if (!rw || !rh) return { w: base, h: Math.round((base * 9) / 16) };
  if (rh > rw) {
    return { w: Math.round((base * rw) / rh), h: base };
  }
  return { w: base, h: Math.round((base * rh) / rw) };
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).trim().length > maxChars) {
      lines.push(current.trim());
      current = word;
      if (lines.length >= maxLines) break;
    } else {
      current = (current + " " + word).trim();
    }
  }
  if (lines.length < maxLines && current) lines.push(current.trim());
  return lines;
}

/**
 * MockImageProvider — trả ảnh placeholder vẽ số frame + mô tả.
 * Dùng cho toàn bộ dev/test để không tốn tiền API (boundary blueprint).
 */
export class MockImageProvider implements ImageProvider {
  readonly name = "mock";

  async generate(request: ImageRequest): Promise<GeneratedImage> {
    const { w, h } = dimensions(request.aspectRatio, request.resolution);

    // Trích số frame từ prompt ("SCENE (Frame i/total)") để vẽ lên ảnh
    const match = request.prompt.match(/Frame (\d+)\/(\d+)/);
    const frameNo = match ? match[1] : "?";
    const total = match ? match[2] : "?";
    const sceneMatch = request.prompt.match(/SCENE \(Frame \d+\/\d+\): ([^\n]+)/);
    const scene = sceneMatch ? sceneMatch[1] : "";

    const hue = (Number(frameNo) * 47) % 360;
    const fontSize = Math.round(h / 4);
    const captionSize = Math.round(h / 28);
    const lines = wrapText(scene, 60, 3);

    const caption = lines
      .map(
        (line, i) =>
          `<text x="50%" y="${h - (lines.length - i) * (captionSize * 1.5) - h * 0.04}" ` +
          `text-anchor="middle" font-family="sans-serif" font-size="${captionSize}" ` +
          `fill="#c9c9d4">${escapeXml(line)}</text>`,
      )
      .join("");

    const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="hsl(${hue}, 45%, 16%)"/>
      <stop offset="100%" stop-color="hsl(${(hue + 60) % 360}, 50%, 10%)"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <circle cx="${w * 0.78}" cy="${h * 0.3}" r="${h * 0.18}" fill="hsl(${hue}, 60%, 30%)" opacity="0.5"/>
  <text x="50%" y="48%" text-anchor="middle" font-family="sans-serif" font-weight="bold"
    font-size="${fontSize}" fill="#ececf1">F${frameNo}</text>
  <text x="50%" y="${h * 0.58}" text-anchor="middle" font-family="sans-serif"
    font-size="${Math.round(captionSize * 1.2)}" fill="#8b8b98">MOCK ${frameNo}/${total} — ${request.aspectRatio} ${request.resolution}</text>
  ${caption}
</svg>`;

    const data = await sharp(Buffer.from(svg)).png().toBuffer();
    return { data, mimeType: "image/png" };
  }
}
