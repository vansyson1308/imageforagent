import type { DrawEntry } from "@/lib/services/construct/resolve2d";
import type { RenderPass } from "@/lib/services/construct/compile";
import { GRADIENT_ID_PREFIX, type GradientDescriptor } from "@/lib/services/construct/shading";
import { fmt } from "@/lib/services/construct/geometry2d";

/**
 * passes — mã hoá control pass (điều kiện cho AI video: ControlNet, Wan
 * VACE, LTX IC-LoRA) từ CÙNG thứ tự vẽ của renderer. Pure.
 *   depth         xám: GẦN = SÁNG (quy ước MiDaS/ZoeDepth mà ControlNet nhận)
 *   segmentation  màu phẳng theo ĐỐI TƯỢNG (id trước ":" — cả figure một màu),
 *                 màu băm từ id ⇒ ổn định qua mọi frame và mọi shot
 *   normal        normal view-space → RGB (n·0.5 + 0.5, +Y lên — kiểu OpenGL)
 * Giới hạn: solid smooth (silhouette) mang một depth/normal phẳng.
 */

const hex2 = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
const rgbHex = (r: number, g: number, b: number) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

/** FNV-1a 32-bit — băm ổn định cho id. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function hsvHex(h: number, s: number, v: number): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return rgbHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

/** Khoá đối tượng: "hero:shinL" → "hero" (cả nhân vật một vùng). */
export function segmentKey(solidId: string): string {
  return solidId.split(":")[0];
}

/** Màu segmentation của một đối tượng — deterministic theo id. */
export function segmentationColor(key: string): string {
  const h = fnv1a(key);
  return hsvHex(h % 360, 0.6 + ((h >>> 9) % 30) / 100, 0.85 + ((h >>> 17) % 15) / 100);
}

export interface PassFill {
  readonly fill: string;
  readonly gradient?: GradientDescriptor;
}

/**
 * Depth tại một điểm màn hình của mặt PHẲNG (ortho: view xy = (sx, −sy)/zoom):
 * z = z_c − (n_x(x − x_c) + n_y(y − y_c))/n_z. Mặt gần như cạnh (|n_z| nhỏ)
 * → depth centroid.
 */
function depthAt(e: DrawEntry, zoom: number): (p: readonly [number, number]) => number {
  const [nx, ny, nz] = e.face.normal;
  const pts = e.face.points;
  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    cx += p[0];
    cy += p[1];
  }
  cx /= pts.length;
  cy /= pts.length;
  if (Math.abs(nz) < 0.05) return () => e.face.depth;
  return (p) => e.face.depth - (nx * ((p[0] - cx) / zoom) + ny * (-(p[1] - cy) / zoom)) / nz;
}

export function makePassFill(
  pass: RenderPass,
  entries: readonly DrawEntry[],
  opts: { readonly zoom: number; readonly gradientBudget: number } = { zoom: 1, gradientBudget: 0 },
): (e: DrawEntry) => PassFill {
  if (pass === "segmentation") return (e) => ({ fill: segmentationColor(segmentKey(e.face.solidId)) });
  if (pass === "normal") {
    return (e) => {
      const [x, y, z] = e.face.normal;
      const n = Math.hypot(x, y, z) || 1;
      return { fill: rgbHex((x / n / 2 + 0.5) * 255, (y / n / 2 + 0.5) * 255, (z / n / 2 + 0.5) * 255) };
    };
  }
  // Depth: dải toàn scene theo depth TỪNG ĐỈNH (mặt lớn như mặt đất trải dài)
  const extents = new Map<DrawEntry, [number, number, readonly [number, number], readonly [number, number]]>();
  let min = Infinity;
  let max = -Infinity;
  for (const e of entries) {
    const at = depthAt(e, opts.zoom);
    let lo = Infinity;
    let hi = -Infinity;
    let pLo = e.face.points[0];
    let pHi = e.face.points[0];
    for (const p of e.face.points) {
      const d = at(p);
      if (d < lo) {
        lo = d;
        pLo = p;
      }
      if (d > hi) {
        hi = d;
        pHi = p;
      }
    }
    extents.set(e, [lo, hi, pLo, pHi]);
    min = Math.min(min, lo);
    max = Math.max(max, hi);
  }
  const range = max - min;
  const gray = (d: number) => {
    const t = range > 1e-9 ? Math.max(0, Math.min(1, (d - min) / range)) : 1;
    const g = 24 + 231 * t;
    return rgbHex(g, g, g);
  };
  let budget = opts.gradientBudget;
  let seq = 0;
  return (e) => {
    const [lo, hi, pLo, pHi] = extents.get(e) ?? [e.face.depth, e.face.depth, [0, 0], [0, 0]];
    // Mặt trải > 4% dải depth ⇒ gradient tuyến tính CHÍNH XÁC trên mặt phẳng
    if (range > 1e-9 && (hi - lo) / range > 0.04 && budget > 0) {
      // Trục gradient = hướng ∇z trên màn hình, qua hai đỉnh cực trị
      const [nx, ny, nz] = e.face.normal;
      const gx = -nx / (nz * opts.zoom);
      const gy = ny / (nz * opts.zoom);
      const gl = Math.hypot(gx, gy);
      if (Number.isFinite(gl) && gl > 1e-12) {
        const ux = gx / gl;
        const uy = gy / gl;
        const proj = (p: readonly [number, number]) => p[0] * ux + p[1] * uy;
        const a = proj(pLo);
        const b = proj(pHi);
        budget--;
        const id = `${GRADIENT_ID_PREFIX}d${seq++}`;
        return {
          fill: `url(#${id})`,
          gradient: {
            id,
            kind: "linearGradient",
            attrs: {
              gradientUnits: "userSpaceOnUse",
              x1: fmt(pLo[0] + (a - proj(pLo)) * ux, 2),
              y1: fmt(pLo[1] + (a - proj(pLo)) * uy, 2),
              x2: fmt(pLo[0] + (b - a) * ux, 2),
              y2: fmt(pLo[1] + (b - a) * uy, 2),
            },
            stops: [
              { offset: 0, color: gray(lo) },
              { offset: 1, color: gray(hi) },
            ],
          },
        };
      }
    }
    return { fill: gray(e.face.depth) };
  };
}
