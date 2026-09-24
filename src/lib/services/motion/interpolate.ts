import type { Ease, Key, KeyValue } from "@/lib/validation/motionSchema";
import { applyEase } from "@/lib/services/motion/easing";

/**
 * interpolate — lấy mẫu một track keyframe tại thời điểm t.
 * Quy ước (giống After Effects "incoming"): `ease` của key k điều khiển đoạn
 * TỪ key k−1 TỚI key k. Trước key đầu = giữ giá trị key đầu; sau key cuối =
 * giữ key cuối (hold). "smooth" = Hermite với tiếp tuyến Catmull-Rom qua key
 * lân cận → đi QUA các key không khựng (camera path nhiều điểm).
 * Màu nội suy trong không gian tuyến tính (linear-light) — pha trộn không bẩn.
 */

export const DEFAULT_EASE: Ease = "inOut";

// ---------- Màu ----------

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.slice(1);
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const toLinear = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (l: number) => {
  const s = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(s * 255)));
};

export function rgbToHex(rgb: readonly number[]): string {
  return `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

export function mixColor(a: string, b: string, u: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  // u ngoài [0,1] (overshoot back/elastic) vẫn phải ra màu hợp lệ → clamp
  const w = Math.max(0, Math.min(1, u));
  return rgbToHex(ca.map((c, i) => fromLinear(toLinear(c) + (toLinear(cb[i]) - toLinear(c)) * w)));
}

// ---------- Số / vector ----------

function asArray(v: KeyValue): number[] {
  return typeof v === "number" ? [v] : (v as number[]);
}

function fromArray(template: KeyValue, arr: number[]): KeyValue {
  return typeof template === "number" ? arr[0] : arr;
}

/** Tiếp tuyến Catmull-Rom (đơn vị: giá trị/giây) tại key i. */
function tangent(keys: readonly Key[], i: number, c: number): number {
  if (i <= 0 || i >= keys.length - 1) return 0; // đầu/cuối: dừng mềm
  const prev = asArray(keys[i - 1].v)[c];
  const next = asArray(keys[i + 1].v)[c];
  return (next - prev) / (keys[i + 1].t - keys[i - 1].t);
}

export function sampleKeys(keys: readonly Key[], t: number): KeyValue {
  if (t <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.v;

  let k = 1;
  while (keys[k].t < t) k++;
  const a = keys[k - 1];
  const b = keys[k];
  const span = b.t - a.t;
  const u = (t - a.t) / span;
  const ease = b.ease ?? DEFAULT_EASE;

  if (typeof a.v === "string") {
    return mixColor(a.v, b.v as string, applyEase(ease, u));
  }

  const va = asArray(a.v);
  const vb = asArray(b.v);
  if (ease === "smooth") {
    // Hermite cubic: h00·p0 + h10·span·m0 + h01·p1 + h11·span·m1
    const u2 = u * u;
    const u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1;
    const h10 = u3 - 2 * u2 + u;
    const h01 = -2 * u3 + 3 * u2;
    const h11 = u3 - u2;
    return fromArray(
      a.v,
      va.map((p0, c) => h00 * p0 + h10 * span * tangent(keys, k - 1, c) + h01 * vb[c] + h11 * span * tangent(keys, k, c)),
    );
  }
  const e = applyEase(ease, u);
  return fromArray(a.v, va.map((p0, c) => p0 + (vb[c] - p0) * e));
}
