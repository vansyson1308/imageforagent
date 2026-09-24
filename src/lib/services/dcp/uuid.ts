import { createHash } from "node:crypto";

/**
 * UUID TẤT ĐỊNH (dạng RFC 4122 v5-like từ SHA-1 của seed + nhãn): cùng
 * project + cùng nội dung ⇒ cùng Id DCP/MXF qua các lần master — tái lập
 * được, diff được, không dựa Math.random.
 */
export function uuidBytes(seed: string, label: string): Buffer {
  const h = createHash("sha1").update(`${seed}\u0000${label}`).digest().subarray(0, 16);
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  return Buffer.from(h);
}

export function uuidString(bytes: Buffer): string {
  const x = bytes.toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

export const urnUuid = (bytes: Buffer) => `urn:uuid:${uuidString(bytes)}`;
