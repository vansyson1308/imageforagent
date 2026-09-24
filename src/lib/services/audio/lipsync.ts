import type { AudioBuffer } from "@/lib/services/audio/wav";
import { toChannels } from "@/lib/services/audio/wav";

/**
 * lipsync — đường cong khẩu hình theo frame, thuần TS:
 *   từ ÂM THANH  mouthOpen = envelope RMS (dB, chuẩn hoá theo phân vị 95 của
 *                đoạn có tiếng, attack nhanh / release chậm — kỹ thuật "lip
 *                flap" kinh điển); mouthWide = zero-crossing rate (âm xát/nguyên
 *                âm dẹt i/e → ZCR cao → miệng bẹt; o/u → tròn)
 *   từ VĂN BẢN   fallback khi chưa có tiếng: mỗi ÂM TIẾT một nhịp mở-đóng
 *                (tiếng Việt: 1 từ = 1 âm tiết), độ bẹt theo nguyên âm chính.
 * Kết quả lấy mẫu tại tâm từng frame video. Deterministic.
 */

export interface LipCurves {
  readonly fps: number;
  /** Giây trên timeline shot ứng với phần tử 0. */
  readonly offset: number;
  readonly open: readonly number[];
  readonly wide: readonly number[];
}

export function audioLipCurves(voice: AudioBuffer, fps: number, offset = 0, gain = 1): LipCurves {
  const mono = toChannels(voice, 1).channels[0];
  const rate = voice.sampleRate;
  const hop = rate / fps;
  const count = Math.ceil(mono.length / hop);
  const db: number[] = [];
  const zcr: number[] = [];
  for (let k = 0; k < count; k++) {
    const a = Math.floor(k * hop);
    const b = Math.min(mono.length, Math.floor((k + 1) * hop));
    let e = 0;
    let z = 0;
    for (let i = a; i < b; i++) {
      e += mono[i] * mono[i];
      if (i > a && (mono[i] >= 0) !== (mono[i - 1] >= 0)) z++;
    }
    const n = Math.max(1, b - a);
    db.push(10 * Math.log10(e / n + 1e-12));
    zcr.push(z / n);
  }
  const voiced = db.filter((d) => d > -55).sort((x, y) => x - y);
  const peak = voiced.length > 0 ? voiced[Math.floor(voiced.length * 0.95)] : -20;
  const floorDb = peak - 28;
  const open: number[] = [];
  const wide: number[] = [];
  let o = 0;
  for (let k = 0; k < count; k++) {
    const target = Math.max(0, Math.min(1, ((db[k] - floorDb) / (peak - floorDb)) * gain)) ** 0.8;
    // Mở nhanh (attack), khép chậm hơn (release) — miệng không "giật"
    o = target > o ? o + (target - o) * 0.85 : o + (target - o) * 0.5;
    open.push(Math.round(o * 1000) / 1000);
    wide.push(Math.round(Math.max(0, Math.min(1, (zcr[k] - 0.04) / 0.22)) * 1000) / 1000);
  }
  return { fps, offset, open, wide };
}

const WIDE_VOWELS = /[iíìỉĩịyýỳỷỹỵeéèẻẽẹêếềểễệ]/;
const ROUND_VOWELS = /[oóòỏõọôốồổỗộơớờởỡợuúùủũụưứừửữự]/;

/** Fallback văn bản: mỗi âm tiết một nhịp mở–đóng trong `duration` giây. */
export function textLipCurves(text: string, duration: number, fps: number, offset = 0): LipCurves {
  const syllables = text
    .toLowerCase()
    .normalize("NFC")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0);
  const count = Math.max(1, Math.ceil(duration * fps));
  const open = new Array<number>(count).fill(0);
  const wide = new Array<number>(count).fill(0.4);
  if (syllables.length === 0 || duration <= 0) return { fps, offset, open, wide };
  const per = duration / syllables.length;
  syllables.forEach((w, s) => {
    const t0 = s * per;
    const w8 = WIDE_VOWELS.test(w) ? 0.85 : ROUND_VOWELS.test(w) ? 0.1 : 0.45;
    for (let k = Math.floor(t0 * fps); k < Math.min(count, Math.ceil((t0 + per) * fps)); k++) {
      const u = ((k + 0.5) / fps - t0) / per;
      if (u < 0 || u > 1) continue;
      open[k] = Math.max(open[k], Math.round(Math.sin(Math.PI * u) * 0.8 * 1000) / 1000);
      wide[k] = w8;
    }
  });
  return { fps, offset, open, wide };
}

/** Lấy mẫu đường cong tại thời điểm t (giây, timeline shot). */
export function sampleLip(c: LipCurves, t: number): { open: number; wide: number } {
  const x = (t - c.offset) * c.fps;
  if (x < 0 || x >= c.open.length) return { open: 0, wide: 0.4 };
  const i = Math.floor(x);
  const j = Math.min(c.open.length - 1, i + 1);
  const u = x - i;
  return { open: c.open[i] + (c.open[j] - c.open[i]) * u, wide: c.wide[i] + (c.wide[j] - c.wide[i]) * u };
}
