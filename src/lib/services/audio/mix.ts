import { resample, toChannels, type AudioBuffer } from "@/lib/services/audio/wav";
import { measureLoudness, type LoudnessStats } from "@/lib/services/audio/loudness";

/**
 * mix — mixer timeline thuần TS: đặt clip theo giây, gain/fade/pan, BUS
 * THOẠI điều khiển DUCKING bus nhạc (sidechain: envelope RMS attack/release
 * → giảm nhạc khi có thoại), rồi chuẩn hoá loudness BS.1770 về target và
 * chặn sample peak. Deterministic. Kinh nghiệm cũ (ADR-009): thoại 0 dB >
 * nhạc −6 dB + duck theo bus thoại; không loudnorm trên im lặng tuyệt đối.
 */

export type ClipRole = "dialogue" | "music" | "fx";

export interface MixClip {
  readonly audio: AudioBuffer;
  /** Thời điểm bắt đầu trên timeline (giây). */
  readonly start: number;
  readonly role: ClipRole;
  readonly gainDb?: number;
  readonly fadeIn?: number;
  readonly fadeOut?: number;
  /** −1 trái … 1 phải (clip mono); constant-power. */
  readonly pan?: number;
  /** Cắt clip ở giây này của timeline (vd hết shot). */
  readonly end?: number;
}

export interface MixOptions {
  readonly duration: number;
  readonly sampleRate?: number;
  readonly channels?: number;
  /** Giảm nhạc bao nhiêu dB khi có thoại (0 = tắt ducking). */
  readonly duckDb?: number;
  /** Loudness đích (LUFS) — web ≈ −16, phát sóng −23, rạp (thoại) ≈ −27. */
  readonly targetLufs?: number;
  /** Trần sample peak (dBFS). */
  readonly peakDb?: number;
  /** Gain mặc định bus nhạc (dB). */
  readonly musicDb?: number;
}

export interface MixResult {
  readonly audio: AudioBuffer;
  readonly before: LoudnessStats;
  readonly after: LoudnessStats;
  readonly gainDb: number;
  /** true nếu limiter phải chặn đỉnh để đạt loudness đích. */
  readonly limited: boolean;
}

const dbToGain = (db: number) => 10 ** (db / 20);

function placeClip(bus: Float32Array[], clip: MixClip, rate: number, extraDb: number): void {
  const src = toChannels(resample(clip.audio, rate), clip.audio.channels.length === 1 && bus.length === 2 ? 1 : bus.length);
  const start = Math.round(clip.start * rate);
  const endSample = clip.end !== undefined ? Math.round(clip.end * rate) : Infinity;
  const len = src.channels[0].length;
  const g = dbToGain((clip.gainDb ?? 0) + extraDb);
  const fi = Math.round((clip.fadeIn ?? 0.005) * rate);
  const fo = Math.round((clip.fadeOut ?? 0.01) * rate);
  const playLen = Math.min(len, endSample - start);
  // Constant-power pan cho mono → stereo
  const pan = Math.max(-1, Math.min(1, clip.pan ?? 0));
  const theta = ((pan + 1) * Math.PI) / 4;
  const panG = [Math.cos(theta) * Math.SQRT2, Math.sin(theta) * Math.SQRT2];
  for (let i = 0; i < playLen; i++) {
    const t = start + i;
    if (t < 0 || t >= bus[0].length) continue;
    let env = 1;
    if (i < fi) env = i / fi;
    if (playLen - i < fo) env = Math.min(env, (playLen - i) / fo);
    for (let c = 0; c < bus.length; c++) {
      const s = src.channels.length === 1 ? src.channels[0][i] * (bus.length === 2 ? panG[c] / Math.SQRT2 : 1) : src.channels[c][i];
      bus[c][t] += s * g * env;
    }
  }
}

/**
 * Gain duck của bus nhạc theo bus thoại, kiểu compressor sidechain: detector
 * peak nhanh (attack 5 ms / release 60 ms) → có thoại (> −40 dBFS) ⇒ đích
 * −duckDb; GAIN được làm mượt riêng: xuống 80 ms, hồi lên 350 ms — nhạc trở
 * lại tự nhiên ngay sau câu thoại thay vì bị giữ theo đuôi envelope.
 */
export function duckGainCurve(dialogue: readonly Float32Array[], rate: number, duckDb: number): Float32Array {
  const n = dialogue[0]?.length ?? 0;
  const side = new Float32Array(n);
  for (const ch of dialogue) for (let i = 0; i < n; i++) side[i] = Math.max(side[i], Math.abs(ch[i]));
  return duckGainCurveInPlace(side, rate, duckDb);
}

/** Như duckGainCurve nhưng GHI ĐÈ `side` (|thoại|) thành gain — không cấp thêm. */
function duckGainCurveInPlace(side: Float32Array, rate: number, duckDb: number): Float32Array {
  if (duckDb <= 0) return side.fill(1);
  const coef = (sec: number) => Math.exp(-1 / (sec * rate));
  const detA = coef(0.005);
  const detR = coef(0.06);
  const gDown = coef(0.08);
  const gUp = coef(0.35);
  const threshold = dbToGain(-40);
  const floor = dbToGain(-duckDb);
  let det = 0;
  let g = 1;
  for (let i = 0; i < side.length; i++) {
    const lvl = side[i];
    det = lvl > det ? detA * det + (1 - detA) * lvl : detR * det + (1 - detR) * lvl;
    const target = det > threshold ? floor : 1;
    const k = target < g ? gDown : gUp;
    g = k * g + (1 - k) * target;
    side[i] = g;
  }
  return side;
}

/**
 * Limiter lookahead OFFLINE, tất định: gain cần = min(1, trần/|x|) (max qua
 * kênh) → sliding-MIN cửa sổ 2L (thấy trước đỉnh) → trung bình trượt L
 * (ramp mượt, không click; mọi mẫu trong vùng đỉnh ≤ gain cần) → release
 * mũ 80 ms. L = 5 ms. Không bao giờ vượt trần.
 */
export function limitPeaks(chs: Float32Array[], rate: number, ceiling: number): void {
  const n = chs[0]?.length ?? 0;
  if (n === 0) return;
  const L = Math.max(1, Math.round(0.005 * rate));
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let p = 0;
    for (const ch of chs) p = Math.max(p, Math.abs(ch[i]));
    need[i] = p > ceiling ? ceiling / p : 1;
  }
  // Sliding min cửa sổ [i − L, i + L] (deque đơn điệu, O(n))
  const minG = new Float32Array(n);
  const dq = new Int32Array(n + 2 * L + 1);
  let head = 0;
  let tail = 0;
  let j = 0;
  for (let i = 0; i < n; i++) {
    const hi = Math.min(n - 1, i + L);
    for (; j <= hi; j++) {
      while (tail > head && need[dq[tail - 1]] >= need[j]) tail--;
      dq[tail++] = j;
    }
    while (dq[head] < i - L) head++;
    minG[i] = need[dq[head]];
  }
  // Trung bình trượt cửa sổ L (ramp) rồi release mũ
  const rel = Math.exp(-1 / (0.08 * rate));
  let acc = 0;
  let g = 1;
  for (let i = 0; i < n; i++) {
    acc += minG[i] - (i >= L ? minG[i - L] : 1);
    // Mỗi minG trong [i−L+1, i] có cửa sổ phủ i ⇒ avg ≤ need[i]: ramp mượt MÀ vẫn an toàn
    const avg = (acc + L) / L;
    g = avg < g ? avg : rel * g + (1 - rel) * avg;
    const gg = Math.min(g, need[i]);
    for (const ch of chs) ch[i] *= gg;
  }
}

/**
 * Bộ nhớ gọn: MỘT bus out (nch) + MỘT sidechain mono (tái dùng tại chỗ làm
 * duck curve). Thoại cộng thẳng vào out; nhạc đặt SAU khi có duck curve.
 */
export function mixTimeline(clips: readonly MixClip[], opts: MixOptions): MixResult {
  const rate = opts.sampleRate ?? 48_000;
  const nch = opts.channels ?? 2;
  const frames = Math.max(1, Math.round(opts.duration * rate));
  const out = Array.from({ length: nch }, () => new Float32Array(frames));
  for (const c of clips) if (c.role !== "music") placeClip(out, c, rate, 0);
  // Sidechain = |thoại| lớn nhất qua các kênh (trước khi có nhạc)
  const side = new Float32Array(frames);
  for (const ch of out) for (let i = 0; i < frames; i++) side[i] = Math.max(side[i], Math.abs(ch[i]));
  const duck = duckGainCurveInPlace(side, rate, opts.duckDb ?? 9);
  for (const c of clips) {
    if (c.role !== "music") continue;
    // Nhạc: đặt vào bus tạm từng clip rồi nhân duck — clip nhạc thường là một
    const tmp = Array.from({ length: nch }, () => new Float32Array(frames));
    placeClip(tmp, c, rate, opts.musicDb ?? -6);
    for (let k = 0; k < nch; k++) for (let i = 0; i < frames; i++) out[k][i] += tmp[k][i] * duck[i];
  }
  const mixed: AudioBuffer = { sampleRate: rate, channels: out };
  const before = measureLoudness(mixed);
  let gainDb = 0;
  // Không chuẩn hoá trên im lặng tuyệt đối (−∞ LUFS ⇒ gain vô hạn / NaN)
  if (opts.targetLufs !== undefined && Number.isFinite(before.integrated)) gainDb = opts.targetLufs - before.integrated;
  const peakCap = opts.peakDb ?? -1;
  if (gainDb !== 0) {
    const g = dbToGain(gainDb);
    for (const ch of out) for (let i = 0; i < ch.length; i++) ch[i] *= g;
  }
  // Đỉnh vượt trần sau khi đẩy loudness ⇒ limiter (không hạ cả bài)
  let limited = false;
  if (Number.isFinite(before.samplePeak) && before.samplePeak + gainDb > peakCap) {
    limitPeaks(out, rate, dbToGain(peakCap));
    limited = true;
  }
  let after = measureLoudness(mixed);
  // Limiter ăn bớt loudness ⇒ bù gain + limit lại (≤ 2 vòng, hội tụ ±0.2 LU)
  for (let k = 0; k < 2 && limited && opts.targetLufs !== undefined && Number.isFinite(after.integrated); k++) {
    const delta = opts.targetLufs - after.integrated;
    if (Math.abs(delta) <= 0.2) break;
    const g = dbToGain(delta);
    for (const ch of out) for (let i = 0; i < ch.length; i++) ch[i] *= g;
    gainDb += delta;
    limitPeaks(out, rate, dbToGain(peakCap));
    after = measureLoudness(mixed);
  }
  return { audio: mixed, before, after, gainDb, limited };
}
