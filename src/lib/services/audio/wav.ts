/**
 * wav — codec WAV/RIFF thuần TS (không dependency): đọc PCM 8/16/24/32-bit
 * nguyên + 32/64-bit float (WAVE_FORMAT_EXTENSIBLE cũng được), ghi PCM
 * 16/24-bit. Âm thanh nội bộ là Float32 [-1, 1] từng kênh. Pure.
 */

export interface AudioBuffer {
  readonly sampleRate: number;
  /** Mỗi kênh một Float32Array cùng độ dài. */
  readonly channels: Float32Array[];
}

export class WavError extends Error {}

export function audioDuration(a: AudioBuffer): number {
  return a.channels[0] ? a.channels[0].length / a.sampleRate : 0;
}

export function isWav(buf: Buffer): boolean {
  return buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WAVE";
}

export function decodeWav(buf: Buffer): AudioBuffer {
  if (!isWav(buf)) throw new WavError("Not a RIFF/WAVE file.");
  let off = 12;
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  let data: Buffer | null = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    let size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    // Streaming writers (espeak/ffmpeg stdout) ghi size 0xFFFFFFFF / 0 cho data
    if (id === "data" && (size === 0 || body + size > buf.length)) size = buf.length - body;
    if (id === "fmt ") {
      let format = buf.readUInt16LE(body);
      const channels = buf.readUInt16LE(body + 2);
      const rate = buf.readUInt32LE(body + 4);
      const bits = buf.readUInt16LE(body + 14);
      if (format === 0xfffe && size >= 26) format = buf.readUInt16LE(body + 24); // sub-format GUID đầu
      fmt = { format, channels, rate, bits };
    } else if (id === "data") {
      data = buf.subarray(body, body + size);
    }
    off = body + size + (size % 2);
  }
  if (!fmt || !data) throw new WavError("WAV is missing its fmt or data chunk.");
  const { format, channels: nch, rate, bits } = fmt;
  if (nch < 1 || nch > 16 || rate < 1000 || rate > 384_000) throw new WavError(`Unsupported WAV layout (${nch} ch, ${rate} Hz).`);
  const bps = bits / 8;
  const frames = Math.floor(data.length / (bps * nch));
  const channels = Array.from({ length: nch }, () => new Float32Array(frames));
  const read: (o: number) => number =
    format === 3 && bits === 32
      ? (o) => data!.readFloatLE(o)
      : format === 3 && bits === 64
        ? (o) => data!.readDoubleLE(o)
        : format === 1 && bits === 16
          ? (o) => data!.readInt16LE(o) / 32768
          : format === 1 && bits === 24
            ? (o) => data!.readIntLE(o, 3) / 8388608
            : format === 1 && bits === 32
              ? (o) => data!.readInt32LE(o) / 2147483648
              : format === 1 && bits === 8
                ? (o) => (data!.readUInt8(o) - 128) / 128
                : (() => {
                    throw new WavError(`Unsupported WAV encoding (format ${format}, ${bits}-bit).`);
                  })();
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < nch; c++) channels[c][f] = read((f * nch + c) * bps);
  }
  return { sampleRate: rate, channels };
}

/** Ghi PCM nguyên 16/24-bit, clip [-1, 1] (dither TPDF tất định khi 16-bit). */
export function encodeWav(a: AudioBuffer, bits: 16 | 24 = 24): Buffer {
  const nch = a.channels.length;
  const frames = a.channels[0]?.length ?? 0;
  const bps = bits / 8;
  const dataLen = frames * nch * bps;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(nch, 22);
  buf.writeUInt32LE(a.sampleRate, 24);
  buf.writeUInt32LE(a.sampleRate * nch * bps, 28);
  buf.writeUInt16LE(nch * bps, 32);
  buf.writeUInt16LE(bits, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataLen, 40);
  const max = bits === 16 ? 32767 : 8388607;
  let seed = 22222;
  const rnd = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed / 4294967296;
  };
  let o = 44;
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < nch; c++) {
      let v = Math.max(-1, Math.min(1, a.channels[c][f])) * max;
      if (bits === 16) v += rnd() - rnd(); // TPDF ±1 LSB
      const q = Math.max(-max - 1, Math.min(max, Math.round(v)));
      if (bits === 16) buf.writeInt16LE(q, o);
      else buf.writeIntLE(q, o, 3);
      o += bps;
    }
  }
  return buf;
}

/**
 * Resample bằng windowed-sinc (Lanczos a=8) — sạch cho thoại/nhạc, tất định.
 * Hạ mẫu có lọc chống alias (cutoff theo tỉ lệ).
 */
export function resample(a: AudioBuffer, rate: number): AudioBuffer {
  if (a.sampleRate === rate) return a;
  const ratio = rate / a.sampleRate;
  const n = a.channels[0].length;
  const outLen = Math.max(1, Math.round(n * ratio));
  const A = 8;
  const cutoff = Math.min(1, ratio);
  const sinc = (x: number) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));
  const channels = a.channels.map((src) => {
    const dst = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const center = i / ratio;
      const lo = Math.ceil(center - A / cutoff);
      const hi = Math.floor(center + A / cutoff);
      let acc = 0;
      let wsum = 0;
      for (let j = lo; j <= hi; j++) {
        if (j < 0 || j >= n) continue;
        const x = (j - center) * cutoff;
        const w = sinc(x) * sinc(x / A);
        acc += src[j] * w;
        wsum += w;
      }
      // Chuẩn hoá theo tổng trọng số ⇒ DC gain = 1 (kể cả sát biên)
      dst[i] = wsum !== 0 ? acc / wsum : 0;
    }
    return dst;
  });
  return { sampleRate: rate, channels };
}

/** Đổi số kênh: mono → N (nhân bản), N → mono (trung bình), stereo ↔ khác theo L/R. */
export function toChannels(a: AudioBuffer, n: number): AudioBuffer {
  if (a.channels.length === n) return a;
  const len = a.channels[0].length;
  if (a.channels.length === 1) return { sampleRate: a.sampleRate, channels: Array.from({ length: n }, () => Float32Array.from(a.channels[0])) };
  if (n === 1) {
    const m = new Float32Array(len);
    for (const ch of a.channels) for (let i = 0; i < len; i++) m[i] += ch[i] / a.channels.length;
    return { sampleRate: a.sampleRate, channels: [m] };
  }
  return { sampleRate: a.sampleRate, channels: Array.from({ length: n }, (_, c) => Float32Array.from(a.channels[c % a.channels.length])) };
}
