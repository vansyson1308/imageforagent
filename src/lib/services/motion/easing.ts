import type { Ease } from "@/lib/validation/motionSchema";

/**
 * easing — hàm tiến độ u ∈ [0,1] → [0,1] (overshoot được với back/elastic).
 * Pure, không state. "smooth" KHÔNG ở đây: nó cần key lân cận (Catmull-Rom),
 * xử lý ở interpolate.ts; ở đây rơi về inOut.
 */

const clamp01 = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u);

function outBounce(u: number): number {
  const n = 7.5625;
  const d = 2.75;
  if (u < 1 / d) return n * u * u;
  if (u < 2 / d) {
    const x = u - 1.5 / d;
    return n * x * x + 0.75;
  }
  if (u < 2.5 / d) {
    const x = u - 2.25 / d;
    return n * x * x + 0.9375;
  }
  const x = u - 2.625 / d;
  return n * x * x + 0.984375;
}

/**
 * cubic-bezier CSS: P0=(0,0), P1=(x1,y1), P2=(x2,y2), P3=(1,1). Giải x(s)=u
 * bằng Newton + bisection fallback (x đơn điệu vì x1,x2 ∈ [0,1]) — số vòng
 * cố định → deterministic.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number, u: number): number {
  const bx = (s: number) => 3 * (1 - s) * (1 - s) * s * x1 + 3 * (1 - s) * s * s * x2 + s * s * s;
  const by = (s: number) => 3 * (1 - s) * (1 - s) * s * y1 + 3 * (1 - s) * s * s * y2 + s * s * s;
  const dbx = (s: number) => 3 * (1 - s) * (1 - s) * x1 + 6 * (1 - s) * s * (x2 - x1) + 3 * s * s * (1 - x2);
  let s = u;
  for (let i = 0; i < 8; i++) {
    const dx = bx(s) - u;
    if (Math.abs(dx) < 1e-7) return by(s);
    const d = dbx(s);
    if (Math.abs(d) < 1e-6) break;
    s = clamp01(s - dx / d);
  }
  let lo = 0;
  let hi = 1;
  s = u;
  for (let i = 0; i < 40; i++) {
    const x = bx(s);
    if (Math.abs(x - u) < 1e-7) break;
    if (x < u) lo = s;
    else hi = s;
    s = (lo + hi) / 2;
  }
  return by(s);
}

export function applyEase(ease: Ease, raw: number): number {
  const u = clamp01(raw);
  if (Array.isArray(ease)) return cubicBezier(ease[0], ease[1], ease[2], ease[3], u);
  switch (ease) {
    case "linear":
      return u;
    case "step":
      // Giữ giá trị key TRƯỚC cho tới đúng thời điểm key này (hold/stepped)
      return u >= 1 ? 1 : 0;
    case "in":
      return u * u * u;
    case "out":
      return 1 - (1 - u) ** 3;
    case "inOut":
    case "smooth":
      return u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
    case "inBack": {
      const c1 = 1.70158;
      return (c1 + 1) * u * u * u - c1 * u * u;
    }
    case "outBack": {
      const c1 = 1.70158;
      const x = u - 1;
      return 1 + (c1 + 1) * x * x * x + c1 * x * x;
    }
    case "outElastic": {
      if (u === 0 || u === 1) return u;
      const c4 = (2 * Math.PI) / 3;
      return 2 ** (-10 * u) * Math.sin((u * 10 - 0.75) * c4) + 1;
    }
    case "outBounce":
      return outBounce(u);
  }
}
