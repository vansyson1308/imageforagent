import type { Mat4, Vec2, Vec3 } from "@/lib/services/construct/types";
import { transformPoint } from "@/lib/services/construct/math3d";
import { projectViewPoint, type Projection } from "@/lib/services/construct/camera";
import { convexHull2D, fmt } from "@/lib/services/construct/geometry2d";
import { runBoolean } from "@/lib/services/construct/pathBoolean";
import { CONSTRUCT_LIMITS } from "@/lib/config/limits";
import type { SolidSceneItem } from "@/lib/services/construct/painterSort";
import { GRADIENT_ID_PREFIX, type GradientDescriptor } from "@/lib/services/construct/shading";
import type { FilterDescriptor, PathItem } from "@/lib/services/construct/svgEmitter";

/**
 * shadow — Layer 4a: bóng đổ xuống mặt đất y=ground. Nguyên lý gốc: trượt
 * từng đỉnh DỌC HƯỚNG SÁNG tới mặt đất (s = (ground − y)/Ly), chiếu qua
 * camera sẵn có, union các silhouette bằng path-bool sẵn có.
 *
 * Silhouette mỗi solid = UNION footprint TỪNG MẶT (không phải convex hull)
 * → washer đổ bóng CÓ LỖ, hình lõm đổ bóng đúng dạng.
 */

export interface ShadowSpec {
  readonly style: "silhouette" | "blob" | "long" | "none";
  readonly color: string;
  readonly opacity: number;
  readonly blur: number;
  readonly ground: number;
  readonly longLength?: number;
}

export interface ShadowLayer {
  readonly paths: PathItem[];
  readonly gradients: GradientDescriptor[];
  readonly filters: FilterDescriptor[];
  readonly warnings: string[];
}

const EMPTY: ShadowLayer = { paths: [], gradients: [], filters: [], warnings: [] };

/** Trượt đỉnh world dọc hướng sáng tới y=ground (s clamp ≥ 0). */
function slideToGround(p: Vec3, light: Vec3, ground: number): Vec3 {
  const s = Math.max(0, (ground - p[1]) / light[1]);
  return [p[0] + s * light[0], ground, p[2] + s * light[2]];
}

function ringToPathD(ring: readonly Vec2[], precision: number): string {
  return (
    ring
      .map(([x, y], i) => `${i === 0 ? "M" : "L"} ${fmt(x, precision)} ${fmt(y, precision)}`)
      .join(" ") + " Z"
  );
}

/** Union path 2D theo lô ≤ maxBooleanOperands. */
function unionPaths(ds: string[], precision: number, context: string): string {
  let batch: string[] = [];
  let acc: string | null = null;
  const flush = () => {
    if (batch.length === 0) return;
    const operands = acc !== null ? [acc, ...batch] : batch;
    acc = operands.length === 1 ? operands[0] : runBoolean("union", operands, precision, context).d;
    batch = [];
  };
  for (const d of ds) {
    if (d.length === 0) continue;
    batch.push(d);
    if (batch.length >= CONSTRUCT_LIMITS.maxBooleanOperands - 1) flush();
  }
  flush();
  return acc ?? "";
}

/** Footprint bóng một solid trên MÀN HÌNH (union per-face, giữ lỗ). */
function solidShadowD(
  item: SolidSceneItem,
  light: Vec3,
  ground: number,
  view: Mat4,
  projection: Projection,
  precision: number,
  sweep: Vec3 | null,
): string {
  // Đỉnh world → điểm bóng ground → screen (memo theo index)
  const shadowScreen = item.mesh.vertices.map((v) => {
    const g = slideToGround(v, light, ground);
    return projectViewPoint(transformPoint(view, g), projection).screen;
  });
  // Long shadow: thêm bản trượt — hull(P ∪ P+sweep) = sweep hull của mặt lồi
  const sweepScreen = sweep
    ? item.mesh.vertices.map((v) => {
        const g = slideToGround(v, light, ground);
        const g2: Vec3 = [g[0] + sweep[0], ground, g[2] + sweep[2]];
        return projectViewPoint(transformPoint(view, g2), projection).screen;
      })
    : null;

  const ringArea = (ring: readonly Vec2[]): number => {
    let area = 0;
    for (let i = 0; i < ring.length; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[(i + 1) % ring.length];
      area += x1 * y2 - x2 * y1;
    }
    return Math.abs(area) / 2;
  };

  // Fast-path khối LỒI: hull toàn bộ điểm bóng = footprint chính xác,
  // 1 ring, không cần boolean (đa số solid trong scene là primitive lồi)
  if (item.convex && !sweepScreen) {
    const hull = convexHull2D(shadowScreen);
    return hull.length >= 3 ? ringToPathD(hull, precision) : "";
  }
  if (item.convex && sweepScreen) {
    const hull = convexHull2D([...shadowScreen, ...sweepScreen]);
    return hull.length >= 3 ? ringToPathD(hull, precision) : "";
  }

  const faceDs: string[] = [];
  for (const face of item.mesh.faces) {
    const pts = face.vertices.map((i) => shadowScreen[i]);
    if (sweepScreen) {
      // Long: sweep hull (lỗ mất trong mode long — stylized, ghi docs)
      const ring = convexHull2D([...pts, ...face.vertices.map((i) => sweepScreen[i])]);
      if (ring.length >= 3 && ringArea(ring) > 0.01) {
        faceDs.push(ringToPathD(ring, precision));
      }
      continue;
    }
    // Footprint chính xác: chiếu (ánh sáng + camera) là phép affine trên
    // mặt phẳng → ring đã map LÀ footprint, kể cả mặt lõm; holes giữ nguyên
    // (evenodd) — washer đổ bóng vành khuyên
    if (pts.length < 3 || ringArea(pts) < 0.01) continue; // mặt edge-on
    let d = ringToPathD(pts, precision);
    if (face.holes) {
      for (const holeRing of face.holes) {
        const hole = holeRing.map((i) => shadowScreen[i]);
        if (hole.length >= 3 && ringArea(hole) > 0.01) {
          d += " " + ringToPathD(hole, precision);
        }
      }
    }
    faceDs.push(d);
  }
  return unionPaths(faceDs, precision, `shadow of "${item.solidId}"`);
}

/**
 * Dựng layer bóng cho toàn scene. Trả EMPTY + warning nếu ánh sáng gần
 * ngang (|Ly| quá nhỏ — bóng chạy tới vô cực).
 */
export function buildShadowLayer(
  items: readonly SolidSceneItem[],
  lightWorld: Vec3,
  view: Mat4,
  projection: Projection,
  shadow: ShadowSpec,
  precision: number,
): ShadowLayer {
  if (shadow.style === "none" || items.length === 0) return EMPTY;
  if (Math.abs(lightWorld[1]) < 1e-6) {
    return {
      ...EMPTY,
      warnings: ['Shadow skipped: light direction is nearly horizontal (|direction.y| ≈ 0).'],
    };
  }

  const warnings: string[] = [];
  const gradients: GradientDescriptor[] = [];
  const filters: FilterDescriptor[] = [];
  const paths: PathItem[] = [];

  if (shadow.style === "blob") {
    // Blob: ellipse mềm dưới mỗi solid — 1 radial gradient dùng chung
    const gradId = `${GRADIENT_ID_PREFIX}shadow-blob`;
    gradients.push({
      id: gradId,
      kind: "radialGradient",
      attrs: { cx: "0.5", cy: "0.5", r: "0.5" },
      stops: [
        { offset: 0, color: shadow.color, opacity: shadow.opacity },
        { offset: 0.7, color: shadow.color, opacity: shadow.opacity * 0.55 },
        { offset: 1, color: shadow.color, opacity: 0 },
      ],
    });
    for (const item of items) {
      // Tâm + bán kính footprint trên ground (AABB world)
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity;
      for (const [x, y, z] of item.mesh.vertices) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
        if (y < minY) minY = y;
      }
      const center: Vec3 = [(minX + maxX) / 2, minY, (minZ + maxZ) / 2];
      const grounded = slideToGround(center, lightWorld, shadow.ground);
      const rx = (maxX - minX) / 2 + (maxZ - minZ) / 8;
      const rz = (maxZ - minZ) / 2 + (maxX - minX) / 8;
      // Sample ellipse trên ground → chiếu → polygon
      const N = 24;
      const ring: Vec2[] = [];
      for (let i = 0; i < N; i++) {
        const a = (i * 2 * Math.PI) / N;
        const p: Vec3 = [grounded[0] + rx * Math.cos(a), shadow.ground, grounded[2] + rz * Math.sin(a)];
        ring.push(projectViewPoint(transformPoint(view, p), projection).screen);
      }
      paths.push({
        d: ringToPathD(ring, precision),
        fill: `url(#${gradId})`,
        fillRule: "nonzero",
      });
    }
    return { paths, gradients, filters, warnings };
  }

  // silhouette / long: union footprint per-face per-solid rồi union tất cả
  let sweep: Vec3 | null = null;
  if (shadow.style === "long") {
    // Quét dọc hướng sáng chiếu lên ground; mặc định 2.5× kích thước scene
    let radius = 0;
    for (const item of items) {
      for (const [x, , z] of item.mesh.vertices) {
        const d = Math.hypot(x, z);
        if (d > radius) radius = d;
      }
    }
    const len = shadow.longLength ?? radius * 2.5;
    const dir: Vec2 = [lightWorld[0], lightWorld[2]];
    const dirLen = Math.hypot(dir[0], dir[1]);
    if (dirLen < 1e-9) {
      warnings.push("Long shadow skipped: light is vertical — no ground direction.");
    } else {
      sweep = [(dir[0] / dirLen) * len, 0, (dir[1] / dirLen) * len];
    }
  }

  const solidDs = items
    .map((item) => solidShadowD(item, lightWorld, shadow.ground, view, projection, precision, sweep))
    .filter((d) => d.length > 0);
  const merged = unionPaths(solidDs, precision, "shadow");
  if (merged.length === 0) return { ...EMPTY, warnings };

  let filterRef: string | undefined;
  if (shadow.blur > 0) {
    const filterId = `${GRADIENT_ID_PREFIX}blur-shadow`;
    filters.push({ id: filterId, stdDeviation: shadow.blur });
    filterRef = `url(#${filterId})`;
  }
  paths.push({
    d: merged,
    fill: shadow.color,
    fillRule: "nonzero",
    opacity: shadow.opacity,
    filter: filterRef,
  });
  return { paths, gradients, filters, warnings };
}
