import type { Mesh } from "@/lib/services/construct/types";
import type { ConstructSpec, Solid } from "@/lib/validation/constructSchema";
import { CONSTRUCT_LIMITS } from "@/lib/config/limits";
import type { DrawEntry, ShapeResolver } from "@/lib/services/construct/resolve2d";
import type { ShadowLayer } from "@/lib/services/construct/shadow";
import { faceGradientFill } from "@/lib/services/construct/faceGradient";
import {
  shadeFaceHex,
  type GradientDescriptor,
  type LightParams,
} from "@/lib/services/construct/shading";
import { faceToPathData, type PathItem } from "@/lib/services/construct/svgEmitter";

/**
 * emitScene — stage "Ghép PathItems" của compiler: hợp nhất 2D shapes,
 * partition ground/floating quanh bóng, mặt 3D (preItems → face → decals)
 * thành danh sách PathItem đúng thứ tự vẽ. Tách từ compile.ts để
 * orchestrator giữ gọn; PHẢI giữ output byte-identical với bản inline cũ.
 */

export interface SceneEmitInput {
  /** Id shape 2D được emit, theo thứ tự khai báo. */
  readonly emittedShapeIds: readonly string[];
  readonly resolver: ShapeResolver;
  /** Draw entries 3D đã sort + cutout. */
  readonly entries: readonly DrawEntry[];
  readonly solidMap: ReadonlyMap<string, Solid>;
  readonly shadowLayer: ShadowLayer | null;
  /** spec.shadow.ground — chỉ dùng khi shadowLayer != null. */
  readonly shadowGround: number | undefined;
  /** World mesh mọi solid không-csg (partition ground/floating). */
  readonly worldMeshById: ReadonlyMap<string, { readonly mesh: Mesh; readonly solidIndex: number }>;
  readonly lightParams: LightParams;
  /** Mutated: face gradients + shadow gradients push vào đây. */
  readonly gradients: GradientDescriptor[];
  /** Mutated: warning budget gradient. */
  readonly warnings: string[];
  readonly precision: number;
  readonly stroke: ConstructSpec["stroke"];
  /** Bóng tiếp xúc (AO) — vẽ SAU shadow layer, TRƯỚC solid nổi. */
  readonly contactPaths?: readonly PathItem[];
}

/** Ghép toàn bộ PathItems của scene (2D nền → ground 3D → bóng → nổi). */
export function buildScenePaths(input: SceneEmitInput): PathItem[] {
  const {
    emittedShapeIds,
    resolver,
    entries,
    solidMap,
    shadowLayer,
    shadowGround,
    worldMeshById,
    lightParams,
    gradients,
    warnings,
    precision,
    stroke: globalStroke,
  } = input;
  const paths: PathItem[] = [];

  // 2D shapes trước (nền phẳng), theo thứ tự khai báo
  for (const id of emittedShapeIds) {
    const r = resolver.resolved.get(id)!;
    if (r.isEmpty) {
      warnings.push(`"${id}" (${r.shape.type === "boolean" ? r.shape.op : r.shape.type}) produced an empty path — skipped.`);
      continue;
    }
    if (r.shape.type === "line") {
      paths.push({
        d: r.d,
        fill: "none",
        stroke: r.shape.stroke ?? "#333333",
        strokeWidth: r.shape.strokeWidth,
      });
    } else {
      paths.push({
        d: r.d,
        fill: r.shape.fill ?? "#c0c0c0",
        fillRule: "nonzero",
        stroke: r.shape.stroke ?? globalStroke?.color,
        strokeWidth: r.shape.strokeWidth ?? globalStroke?.width,
      });
    }
  }

  // Shadow layer: vẽ SAU solid "nền" (toàn bộ mesh ≤ mặt phẳng bóng —
  // vd sàn/đất), TRƯỚC mọi solid nổi phía trên — bóng nằm ĐÈ lên mặt sàn
  const groundSolidIds = new Set<string>();
  if (shadowLayer && shadowGround !== undefined) {
    const groundY = shadowGround + 1e-6;
    for (const [id, entry] of worldMeshById) {
      if (entry.mesh.vertices.every((v) => v[1] <= groundY)) groundSolidIds.add(id);
    }
  }
  const groundEntries = shadowLayer
    ? entries.filter((e) => groundSolidIds.has(e.face.solidId))
    : [];
  const floatingEntries = shadowLayer
    ? entries.filter((e) => !groundSolidIds.has(e.face.solidId))
    : entries;

  // 3D faces theo painter order (nền → bóng → phần nổi)
  let gradientSeq = 0;
  let gradientOverflow = false;
  const emit3d = (entry: DrawEntry) => {
    const solid = solidMap.get(entry.face.solidId)!;
    // face.fill = fill kế thừa từ solid nguồn (CSG đa màu; csg.fill đã
    // override từ lúc resolve) — solid thường không có face.fill
    const base = entry.face.fill ?? solid.fill ?? "#c0c0c0";
    let fill: string;
    if (entry.fillOverride) {
      fill = entry.fillOverride;
    } else if (solid.shading === "none") {
      fill = base;
    } else if (lightParams.mode === "gradient") {
      const budgetLeft = CONSTRUCT_LIMITS.maxGradients - gradients.length;
      const result = faceGradientFill(
        entry.face,
        base,
        lightParams.direction,
        lightParams.ambient,
        gradientSeq,
        budgetLeft,
      );
      if (result.gradient) {
        gradients.push(result.gradient);
        gradientSeq++;
      } else if (budgetLeft <= 0) {
        gradientOverflow = true;
      }
      fill = result.fill;
    } else {
      fill = shadeFaceHex(base, entry.face.normal, lightParams);
    }
    if (entry.preItems) paths.push(...entry.preItems);
    paths.push({
      d: entry.dOverride ?? faceToPathData(entry.face, precision),
      fill,
      fillRule: entry.face.holes ? "evenodd" : undefined,
      stroke: globalStroke?.color,
      strokeWidth: globalStroke?.width,
    });
    paths.push(...entry.decals);
  };

  for (const entry of groundEntries) emit3d(entry);
  if (shadowLayer) {
    gradients.push(...shadowLayer.gradients);
    paths.push(...shadowLayer.paths);
  }
  if (input.contactPaths) paths.push(...input.contactPaths);
  for (const entry of floatingEntries) emit3d(entry);

  if (gradientOverflow) {
    warnings.push(
      `Gradient budget (${CONSTRUCT_LIMITS.maxGradients}) exhausted — remaining faces use flat smooth fill. Reduce face count or use light.mode "quantized".`,
    );
  }

  return paths;
}
