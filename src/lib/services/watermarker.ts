import sharp from "sharp";
import { readBuffer, saveBuffer } from "@/lib/services/storage";

export interface WatermarkConfig {
  readonly position: string; // top-left | top-right | bottom-left | bottom-right | center
  readonly scalePercent: number; // % chiều rộng ảnh (mặc định 12)
  readonly opacity: number; // 0..1 (mặc định 0.85)
}

const PADDING = 24;

function placement(
  imgW: number,
  imgH: number,
  logoW: number,
  logoH: number,
  position: string,
): { left: number; top: number } {
  switch (position) {
    case "top-left":
      return { left: PADDING, top: PADDING };
    case "top-right":
      return { left: imgW - logoW - PADDING, top: PADDING };
    case "bottom-left":
      return { left: PADDING, top: imgH - logoH - PADDING };
    case "center":
      return {
        left: Math.round((imgW - logoW) / 2),
        top: Math.round((imgH - logoH) / 2),
      };
    case "bottom-right":
    default:
      return { left: imgW - logoW - PADDING, top: imgH - logoH - PADDING };
  }
}

/**
 * Đóng watermark logo lên ảnh gốc → ghi ra outRelPath.
 * Ảnh gốc (rawRelPath) luôn được giữ nguyên để re-watermark không tốn API.
 */
export async function applyWatermark(
  rawRelPath: string,
  outRelPath: string,
  logoRelPath: string,
  config: WatermarkConfig,
): Promise<void> {
  const [rawBuffer, logoBuffer] = await Promise.all([
    readBuffer(rawRelPath),
    readBuffer(logoRelPath),
  ]);

  const base = sharp(rawBuffer);
  const meta = await base.metadata();
  const imgW = meta.width ?? 1024;
  const imgH = meta.height ?? 576;

  // Clamp logo vào trong ảnh (trừ padding) ở CẢ 2 chiều — logo dọc/cao
  // không được phép vượt chiều cao ảnh (sharp composite sẽ throw)
  const maxLogoW = Math.max(16, imgW - PADDING * 2);
  const maxLogoH = Math.max(16, imgH - PADDING * 2);
  const targetLogoW = Math.min(
    maxLogoW,
    Math.max(16, Math.round((imgW * config.scalePercent) / 100)),
  );

  // Resize logo (fit inside giữ tỷ lệ) + nhân alpha theo opacity (blend dest-in)
  const resizedLogo = await sharp(logoBuffer)
    .ensureAlpha()
    .resize({ width: targetLogoW, height: maxLogoH, fit: "inside" })
    .png()
    .toBuffer();

  const alpha = Math.round(Math.min(1, Math.max(0.05, config.opacity)) * 255);
  const logoWithOpacity = await sharp(resizedLogo)
    .composite([
      {
        input: Buffer.from([255, 255, 255, alpha]),
        raw: { width: 1, height: 1, channels: 4 },
        tile: true,
        blend: "dest-in",
      },
    ])
    .png()
    .toBuffer();

  const logoMeta = await sharp(logoWithOpacity).metadata();
  const rawPos = placement(
    imgW,
    imgH,
    logoMeta.width ?? targetLogoW,
    logoMeta.height ?? targetLogoW,
    config.position,
  );
  // An toàn tuyệt đối: toạ độ không bao giờ âm
  const pos = { left: Math.max(0, rawPos.left), top: Math.max(0, rawPos.top) };

  const output = await base
    .composite([{ input: logoWithOpacity, left: pos.left, top: pos.top }])
    .png()
    .toBuffer();

  await saveBuffer(outRelPath, output);
}
