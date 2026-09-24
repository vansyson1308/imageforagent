/**
 * color — sRGB (D65) → X′Y′Z′ DCI 12-bit, thuần TS, bằng LUT:
 *   1. giải mã sRGB (hàm truyền piecewise IEC 61966-2-1) → RGB tuyến tính
 *   2. ma trận sRGB→XYZ (D65, không chromatic adaptation — trắng D65 đi
 *      nguyên vào XYZ như DCP-o-matic mặc định)
 *   3. chuẩn hoá DCI: XYZ · L/52.37 với L = 48 cd/m² (14 fL, trắng tham
 *      chiếu), mã hoá gamma 1/2.6, lượng tử 12-bit (0…4095)
 * Kiểm chứng: trắng sRGB → Y′ = 3960 (giá trị kinh điển cho 48 nit).
 */

const M = [
  [0.4124564, 0.3575761, 0.1804375],
  [0.2126729, 0.7151522, 0.072175],
  [0.0193339, 0.119192, 0.9503041],
] as const;

const DCI_NORM = 48 / 52.37;
const ENCODE_STEPS = 65536;

const decode8 = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const v = i / 255;
  decode8[i] = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** LUT mã hoá: giá trị tuyến tính chuẩn hoá [0,1] (lượng tử 16-bit) → mã 12-bit. */
const encodeLut = new Uint16Array(ENCODE_STEPS);
for (let i = 0; i < ENCODE_STEPS; i++) {
  encodeLut[i] = Math.round(4095 * (i / (ENCODE_STEPS - 1)) ** (1 / 2.6));
}

const enc = (lin: number) => encodeLut[Math.max(0, Math.min(ENCODE_STEPS - 1, Math.round(lin * DCI_NORM * (ENCODE_STEPS - 1))))];

/** Một pixel sRGB 8-bit → [X′, Y′, Z′] 12-bit. */
export function srgbToDciXyz(r: number, g: number, b: number): [number, number, number] {
  const R = decode8[r];
  const G = decode8[g];
  const B = decode8[b];
  return [
    enc(M[0][0] * R + M[0][1] * G + M[0][2] * B),
    enc(M[1][0] * R + M[1][1] * G + M[1][2] * B),
    enc(M[2][0] * R + M[2][1] * G + M[2][2] * B),
  ];
}

/**
 * Khung rgb24 (w·h·3 byte) → PPM P6 16-bit big-endian maxval 4095 (định dạng
 * opj_compress nhận trực tiếp cho codestream 12-bit X′Y′Z′).
 */
export function rgb24ToXyzPpm(rgb: Buffer, width: number, height: number): Buffer {
  const header = Buffer.from(`P6\n${width} ${height}\n4095\n`, "ascii");
  const out = Buffer.alloc(header.length + width * height * 6);
  header.copy(out, 0);
  let o = header.length;
  for (let i = 0; i < width * height * 3; i += 3) {
    const [x, y, z] = srgbToDciXyz(rgb[i], rgb[i + 1], rgb[i + 2]);
    out.writeUInt16BE(x, o);
    out.writeUInt16BE(y, o + 2);
    out.writeUInt16BE(z, o + 4);
    o += 6;
  }
  return out;
}
