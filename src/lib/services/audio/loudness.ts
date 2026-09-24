import type { AudioBuffer } from "@/lib/services/audio/wav";

/**
 * loudness — ITU-R BS.1770-4 / EBU R128 integrated loudness (LUFS) thuần TS:
 * K-weighting (shelf 1681.97 Hz +4 dB → high-pass 38.14 Hz, hệ số theo
 * libebur128 cho MỌI sample rate) → khối 400 ms chồng 75% → gate tuyệt
 * đối −70 LUFS + gate tương đối −10 LU. Trọng số kênh 5.1: L/R/C = 1,
 * Ls/Rs = 1.41, LFE (kênh 4 khi 6 kênh) loại. Pure, deterministic.
 */

interface Biquad {
  b: [number, number, number];
  a: [number, number, number];
}

function kWeighting(rate: number): [Biquad, Biquad] {
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / rate);
  const Vh = 10 ** (G / 20);
  const Vb = Vh ** 0.4996667741545416;
  let a0 = 1 + K / Q + K * K;
  const pre: Biquad = {
    b: [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0],
    a: [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0],
  };
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / rate);
  a0 = 1 + K / Q + K * K;
  const rlb: Biquad = { b: [1, -2, 1], a: [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0] };
  return [pre, rlb];
}

function channelWeight(index: number, count: number): number {
  if (count === 6) return [1, 1, 1, 0, 1.41, 1.41][index];
  if (count === 5) return [1, 1, 1, 1.41, 1.41][index];
  return 1;
}

export interface LoudnessStats {
  /** Integrated loudness (LUFS) — −Infinity khi toàn bộ dưới gate. */
  readonly integrated: number;
  /** Sample peak (dBFS). */
  readonly samplePeak: number;
}

/**
 * STREAMING: lọc K-weighting từng mẫu (trạng thái biquad), cộng năng lượng
 * theo hop 100 ms; khối 400 ms = 4 hop liên tiếp. Bộ nhớ O(số hop) — đo
 * được cả phim dài mà không cấp mảng cỡ tín hiệu.
 */
export function measureLoudness(a: AudioBuffer): LoudnessStats {
  const rate = a.sampleRate;
  const [pre, rlb] = kWeighting(rate);
  const hop = Math.round(0.1 * rate);
  const n = a.channels[0]?.length ?? 0;
  const hops = Math.floor(n / hop);
  const hopEnergy = new Float64Array(hops);
  let peak = 0;
  a.channels.forEach((ch, idx) => {
    for (let i = 0; i < ch.length; i++) {
      const v = Math.abs(ch[i]);
      if (v > peak) peak = v;
    }
    const w = channelWeight(idx, a.channels.length);
    if (w === 0) return;
    let px1 = 0, px2 = 0, py1 = 0, py2 = 0, rx1 = 0, rx2 = 0, ry1 = 0, ry2 = 0;
    for (let h = 0; h < hops; h++) {
      let e = 0;
      for (let i = h * hop; i < (h + 1) * hop; i++) {
        const x = ch[i];
        const y = pre.b[0] * x + pre.b[1] * px1 + pre.b[2] * px2 - pre.a[1] * py1 - pre.a[2] * py2;
        px2 = px1; px1 = x; py2 = py1; py1 = y;
        const z = rlb.b[0] * y + rlb.b[1] * rx1 + rlb.b[2] * rx2 - rlb.a[1] * ry1 - rlb.a[2] * ry2;
        rx2 = rx1; rx1 = y; ry2 = ry1; ry1 = z;
        e += z * z;
      }
      hopEnergy[h] += w * e;
    }
  });
  const blocks: number[] = [];
  const block = hop * 4;
  for (let h = 0; h + 4 <= hops; h++) {
    blocks.push((hopEnergy[h] + hopEnergy[h + 1] + hopEnergy[h + 2] + hopEnergy[h + 3]) / block);
  }
  const lufs = (z: number) => -0.691 + 10 * Math.log10(z);
  const abs = blocks.filter((z) => z > 0 && lufs(z) > -70);
  let integrated = -Infinity;
  if (abs.length > 0) {
    const meanAbs = abs.reduce((x, y) => x + y, 0) / abs.length;
    const rel = abs.filter((z) => lufs(z) > lufs(meanAbs) - 10);
    if (rel.length > 0) integrated = lufs(rel.reduce((x, y) => x + y, 0) / rel.length);
  }
  return { integrated, samplePeak: peak > 0 ? 20 * Math.log10(peak) : -Infinity };
}
