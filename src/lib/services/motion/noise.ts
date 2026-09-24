/**
 * noise — value noise 1D mượt, TẤT ĐỊNH theo seed (không Math.random).
 * Hash số nguyên kiểu murmur-finalizer qua Math.imul → lattice [-1,1],
 * nội suy quintic (C2) → không gãy vận tốc. Nhiều octave = fBm.
 */

function hash(seed: number, i: number, channel: number): number {
  let h = Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(i | 0, 0x85ebca6b) ^ Math.imul(channel | 0, 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return ((h >>> 0) / 0xffffffff) * 2 - 1;
}

const quintic = (u: number) => u * u * u * (u * (u * 6 - 15) + 10);

export function valueNoise1D(x: number, seed: number, channel: number): number {
  const i = Math.floor(x);
  const u = quintic(x - i);
  const a = hash(seed, i, channel);
  const b = hash(seed, i + 1, channel);
  return a + (b - a) * u;
}

/** fBm chuẩn hoá về ~[-1,1]: tổng octave biên độ ½ⁿ, tần số 2ⁿ. */
export function fbm1D(x: number, seed: number, channel: number, octaves: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let freq = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise1D(x * freq, seed + o * 1013, channel);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}
