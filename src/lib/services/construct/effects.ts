import type { Affine2D, Mat4, Mesh, Vec2, Vec3 } from "@/lib/services/construct/types";
import type { SolidEffects } from "@/lib/validation/constructSchema";
import { transformPoint } from "@/lib/services/construct/math3d";
import { projectViewPoint, type Projection } from "@/lib/services/construct/camera";
import { fmt, segmentsToPathData, transformSegments } from "@/lib/services/construct/geometry2d";
import { parsePathData } from "@/lib/services/construct/pathParse";
import { runBoolean } from "@/lib/services/construct/pathBoolean";
import {
  applyLuminance,
  GRADIENT_ID_PREFIX,
  softShadowColor,
  type GradientDescriptor,
} from "@/lib/services/construct/shading";
import type { FilterDescriptor, PathItem } from "@/lib/services/construct/svgEmitter";
import type { SolidSilhouette } from "@/lib/services/construct/silhouette";

/**
 * effects — Layer 4c (Softness): các lớp làm mềm per-solid sinh từ MỘT
 * quy tắc boolean duy nhất trên silhouette S và bản shift của S về phía
 * nguồn sáng. Mép mềm KHÔNG cần filter: fill lưỡi liềm bằng linear
 * gradient userSpaceOnUse dọc trục sáng với stop-opacity tắt dần ở
 * terminator (kỹ thuật faceGradient sẵn có). Pure — không I/O.
 *
 * Kiểm chiều 1D: S = [0,10], sáng đi +x (nguồn bên trái) → shift về
 * nguồn = −x: shift(S,5) = [−5,5] → S − shift = [5,10] (phía khuất) TỐI;
 * S ∩ shift = [0,5] (phía nguồn) SÁNG.
 */

/** Trắng ấm default cho highlight (kỷ luật: highlight ấm / bóng lạnh). */
export const HIGHLIGHT_COLOR = "#fff1dd";
/** Lạnh sáng default cho rim (ánh viền ngược). */
export const RIM_COLOR = "#dcecff";
/** Trắng thuần default cho specular. */
export const SPECULAR_COLOR = "#ffffff";
/** Tối lạnh default cho bóng tiếp xúc (không bao giờ #000). */
export const CONTACT_COLOR = "#2c3548";
/** stdDeviation blur glow = hệ số này × R. */
export const GLOW_BLUR_FACTOR = 0.08;

export interface EffectsBuild {
  /** Vẽ ĐÈ lên solid (decals của entry cuối). */
  readonly over: PathItem[];
  /** Vẽ SAU LƯNG solid (preItems của entry đầu — glow S3). */
  readonly behind: PathItem[];
  readonly gradients: GradientDescriptor[];
  readonly filters: FilterDescriptor[];
  readonly warnings: string[];
  /** Giá trị seq sau khi cấp id — truyền cho solid kế tiếp. */
  readonly seqEnd: number;
}

export interface EffectsInput {
  readonly solidId: string;
  readonly silhouette: SolidSilhouette;
  /** Hướng ánh sáng ĐI TỚI trên màn hình (y-down) — chưa chắc đơn vị. */
  readonly lightScreen: Vec2;
  readonly effects: SolidEffects;
  /** Fill gốc của solid (hex) — nguồn suy màu bóng mặc định. */
  readonly baseFill: string;
  readonly precision: number;
  /** Bộ đếm id cg-e toàn cảnh. */
  readonly seq: number;
}

function translateAffine(dx: number, dy: number): Affine2D {
  return { a: 1, b: 0, c: 0, d: 1, e: dx, f: dy };
}

/** Chuẩn hoá toggle boolean|object của schema → params hoặc null. */
function norm<T>(v: boolean | T | undefined, defaults: T): T | null {
  if (v === undefined || v === false) return null;
  return v === true ? defaults : v;
}

export function buildSolidEffects(input: EffectsInput): EffectsBuild {
  const { solidId, silhouette: sil, effects, baseFill, precision } = input;
  const over: PathItem[] = [];
  const behind: PathItem[] = [];
  const gradients: GradientDescriptor[] = [];
  const filters: FilterDescriptor[] = [];
  const warnings: string[] = [];
  let seq = input.seq;

  const lLen = Math.hypot(input.lightScreen[0], input.lightScreen[1]);
  if (lLen < 1e-3) {
    warnings.push(
      `Effects on "${solidId}" skipped: light is head-on to the camera — no screen direction for crescents. Tilt light.direction.`,
    );
    return { over, behind, gradients, filters, warnings, seqEnd: seq };
  }
  // L̂ = hướng sáng đơn vị trên màn hình; shift VỀ NGUỒN = −L̂
  const lx = input.lightScreen[0] / lLen;
  const ly = input.lightScreen[1] / lLen;

  /** Bản sao S dịch về phía nguồn sáng một đoạn dist (px màn hình). */
  const shiftD = (dist: number): string =>
    segmentsToPathData(
      transformSegments(
        parsePathData(sil.d, `effects of "${solidId}"`),
        translateAffine(-lx * dist, -ly * dist),
      ),
      precision,
    );

  // Trục sáng qua tâm: q(t) = điểm có hình chiếu t dọc L̂
  const tc = sil.centroid[0] * lx + sil.centroid[1] * ly;
  const q = (t: number): Vec2 => [
    sil.centroid[0] + lx * (t - tc),
    sil.centroid[1] + ly * (t - tc),
  ];
  // Khoảng chiếu của bbox lên L̂ (4 góc)
  let tMin = Infinity;
  let tMax = -Infinity;
  for (const [x, y] of [
    [sil.minX, sil.minY],
    [sil.maxX, sil.minY],
    [sil.minX, sil.maxY],
    [sil.maxX, sil.maxY],
  ] as const) {
    const t = x * lx + y * ly;
    if (t < tMin) tMin = t;
    if (t > tMax) tMax = t;
  }

  /** Gradient linear userSpaceOnUse từ p1 → p2 tắt dần tại fadeAt. */
  const axisGradient = (
    p1: Vec2,
    p2: Vec2,
    color: string,
    opacity: number,
    fadeAt: number,
  ): GradientDescriptor => ({
    id: `${GRADIENT_ID_PREFIX}e${seq++}`,
    kind: "linearGradient",
    attrs: {
      gradientUnits: "userSpaceOnUse",
      x1: fmt(p1[0], 2),
      y1: fmt(p1[1], 2),
      x2: fmt(p2[0], 2),
      y2: fmt(p2[1], 2),
    },
    stops: [
      { offset: 0, color, opacity },
      { offset: fadeAt, color, opacity: 0 },
    ],
  });

  const crescent = (
    op: "difference" | "intersection",
    dist: number,
    label: string,
  ): string | null => {
    const result = runBoolean(op, [sil.d, shiftD(dist)], precision, `${label} of "${solidId}"`);
    if (result.isEmpty) {
      warnings.push(`Effect ${label} on "${solidId}" produced an empty shape — skipped (shift too large for this silhouette?).`);
      return null;
    }
    return result.d;
  };

  // ---- formShadow: lưỡi liềm TỐI phía khuất ----
  const fs = norm(effects.formShadow, { shift: 0.45, opacity: 0.15, color: undefined as string | undefined });
  if (fs) {
    const d = crescent("difference", fs.shift * sil.r, "formShadow");
    if (d) {
      const g = axisGradient(q(tMax), q(tMin), fs.color ?? softShadowColor(baseFill), fs.opacity, 0.55);
      gradients.push(g);
      over.push({ d, fill: `url(#${g.id})`, fillRule: "nonzero" });
    }
  }

  // ---- coreAccent: dải TỐI NHẤT sát mép khuất (giữa hai bản shift) ----
  const ca = norm(effects.coreAccent, { from: 0.1, to: 0.45, opacity: 0.2, color: undefined as string | undefined });
  if (ca) {
    const outerCrescent = runBoolean(
      "difference",
      [sil.d, shiftD(ca.to * sil.r)],
      precision,
      `coreAccent of "${solidId}"`,
    );
    const band = outerCrescent.isEmpty
      ? outerCrescent
      : runBoolean(
          "intersection",
          [outerCrescent.d, shiftD(ca.from * sil.r)],
          precision,
          `coreAccent of "${solidId}"`,
        );
    if (band.isEmpty) {
      warnings.push(`Effect coreAccent on "${solidId}" produced an empty band — skipped (from/to too close?).`);
    } else {
      over.push({
        d: band.d,
        fill: ca.color ?? applyLuminance(softShadowColor(baseFill), 0.75),
        fillRule: "nonzero",
        opacity: ca.opacity,
      });
    }
  }

  // ---- highlight: nửa SÁNG phía nguồn ----
  const hl = norm(effects.highlight, { shift: 0.5, opacity: 0.12, color: undefined as string | undefined });
  if (hl) {
    const d = crescent("intersection", hl.shift * sil.r, "highlight");
    if (d) {
      const g = axisGradient(q(tMin), q(tMax), hl.color ?? HIGHLIGHT_COLOR, hl.opacity, 0.55);
      gradients.push(g);
      over.push({ d, fill: `url(#${g.id})`, fillRule: "nonzero" });
    }
  }

  /** Đĩa 24 cạnh — path circle deterministic cho specular/glow. */
  const circleD = (cx: number, cy: number, r: number): string => {
    const pts: string[] = [];
    for (let i = 0; i < 24; i++) {
      const a = (i * 2 * Math.PI) / 24;
      pts.push(`${i === 0 ? "M" : "L"} ${fmt(cx + r * Math.cos(a), precision)} ${fmt(cy + r * Math.sin(a), precision)}`);
    }
    return pts.join(" ") + " Z";
  };

  // ---- specular: đốm gương dịch VỀ nguồn sáng, clip trong S ----
  const sp = norm(effects.specular, { size: 0.12, offset: 0.6, opacity: 0.5, color: undefined as string | undefined });
  if (sp) {
    const cx = sil.centroid[0] - lx * sp.offset * sil.r;
    const cy = sil.centroid[1] - ly * sp.offset * sil.r;
    const clipped = runBoolean(
      "intersection",
      [circleD(cx, cy, sp.size * sil.r), sil.d],
      precision,
      `specular of "${solidId}"`,
    );
    if (clipped.isEmpty) {
      warnings.push(`Effect specular on "${solidId}" fell outside the silhouette — skipped (reduce offset).`);
    } else {
      const color = sp.color ?? SPECULAR_COLOR;
      const g: GradientDescriptor = {
        id: `${GRADIENT_ID_PREFIX}e${seq++}`,
        kind: "radialGradient",
        attrs: { cx: "0.5", cy: "0.5", r: "0.5" },
        stops: [
          { offset: 0, color, opacity: sp.opacity },
          { offset: 1, color, opacity: 0 },
        ],
      };
      gradients.push(g);
      over.push({ d: clipped.d, fill: `url(#${g.id})`, fillRule: "nonzero" });
    }
  }

  // ---- glow: quầng sáng SAU LƯNG ----
  const gl = norm(effects.glow, {
    mode: "halo" as "halo" | "blur",
    size: 1.6,
    opacity: 0.5,
    color: undefined as string | undefined,
  });
  if (gl) {
    const color = gl.color ?? baseFill;
    if (gl.mode === "halo") {
      const g: GradientDescriptor = {
        id: `${GRADIENT_ID_PREFIX}e${seq++}`,
        kind: "radialGradient",
        attrs: { cx: "0.5", cy: "0.5", r: "0.5" },
        stops: [
          { offset: 0, color, opacity: gl.opacity },
          { offset: 0.55, color, opacity: gl.opacity * 0.4 },
          { offset: 1, color, opacity: 0 },
        ],
      };
      gradients.push(g);
      behind.push({
        d: circleD(sil.centroid[0], sil.centroid[1], gl.size * sil.r),
        fill: `url(#${g.id})`,
        fillRule: "nonzero",
      });
    } else {
      const filter: FilterDescriptor = {
        id: `${GRADIENT_ID_PREFIX}e${seq++}`,
        stdDeviation: GLOW_BLUR_FACTOR * gl.size * sil.r,
      };
      filters.push(filter);
      behind.push({
        d: sil.d,
        fill: color,
        fillRule: "nonzero",
        opacity: gl.opacity,
        filter: `url(#${filter.id})`,
      });
    }
  }

  // ---- rim: viền sáng mỏng mép khuất ----
  const rim = norm(effects.rim, { width: 0.03, opacity: 0.6, color: undefined as string | undefined });
  if (rim) {
    const d = crescent("difference", rim.width * sil.r, "rim");
    if (d) {
      // Ramp ngắn VÀO TRONG từ mép khuất — dài 6×width·R
      const span = Math.max(6 * rim.width * sil.r, 1e-3);
      const g = axisGradient(q(tMax), q(tMax - span), rim.color ?? RIM_COLOR, rim.opacity, 1);
      gradients.push(g);
      over.push({ d, fill: `url(#${g.id})`, fillRule: "nonzero" });
    }
  }

  return { over, behind, gradients, filters, warnings, seqEnd: seq };
}

// ---------- Contact shadow (AO trên ground — cần mesh + camera) ----------

export interface ContactInput {
  readonly solidId: string;
  /** World mesh của solid — footprint AABB. */
  readonly mesh: Mesh;
  readonly view: Mat4;
  readonly projection: Projection;
  /** Cao độ world y của mặt tiếp xúc (shadow.ground ?? đáy solid). */
  readonly ground: number;
  readonly params: { readonly opacity: number; readonly scale: number; readonly color?: string };
  readonly precision: number;
  readonly seq: number;
}

export interface ContactBuild {
  readonly path: PathItem | null;
  readonly gradient: GradientDescriptor | null;
  readonly seqEnd: number;
}

/**
 * Bóng tiếp xúc: ellipse mềm NẰM TRÊN mặt ground ngay dưới AABB solid
 * (không trượt theo hướng sáng — AO là tối do gần kề, không do chắn
 * sáng). Radial gradient, KHÔNG filter — thể hiện đúng tiên đề mềm-rẻ.
 */
export function buildContactShadow(input: ContactInput): ContactBuild {
  const { mesh, view, projection, ground, params, precision } = input;
  let seq = input.seq;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, , z] of mesh.vertices) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  // Nở footprint +⅛ trục kia (như blob shadow) — bóng LÓ RA quanh đáy,
  // không bị chính solid che khuất hoàn toàn
  let rx = ((maxX - minX) / 2 + (maxZ - minZ) / 8) * params.scale;
  let rz = ((maxZ - minZ) / 2 + (maxX - minX) / 8) * params.scale;
  // Solid mỏng dẹt: nở trục hẹp để ellipse vẫn đọc được là bóng mềm
  rx = Math.max(rx, rz * 0.25);
  rz = Math.max(rz, rx * 0.25);
  if (rx < 1e-6 || rz < 1e-6) return { path: null, gradient: null, seqEnd: seq };

  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const N = 24;
  const ring: string[] = [];
  for (let i = 0; i < N; i++) {
    const a = (i * 2 * Math.PI) / N;
    const p: Vec3 = [cx + rx * Math.cos(a), ground, cz + rz * Math.sin(a)];
    const s = projectViewPoint(transformPoint(view, p), projection).screen;
    ring.push(`${i === 0 ? "M" : "L"} ${fmt(s[0], precision)} ${fmt(s[1], precision)}`);
  }
  const color = params.color ?? CONTACT_COLOR;
  const gradient: GradientDescriptor = {
    id: `${GRADIENT_ID_PREFIX}e${seq++}`,
    kind: "radialGradient",
    attrs: { cx: "0.5", cy: "0.5", r: "0.5" },
    stops: [
      { offset: 0, color, opacity: params.opacity },
      { offset: 0.7, color, opacity: params.opacity * 0.55 },
      { offset: 1, color, opacity: 0 },
    ],
  };
  return {
    path: { d: ring.join(" ") + " Z", fill: `url(#${gradient.id})`, fillRule: "nonzero" },
    gradient,
    seqEnd: seq,
  };
}
