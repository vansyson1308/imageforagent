import type { ProjectedFace } from "@/lib/services/construct/types";
import type { ConstructSpec, Shape2D, Solid, Cutout } from "@/lib/validation/constructSchema";
import { AppError } from "@/lib/services/apiError";
import { CONSTRUCT_LIMITS } from "@/lib/config/limits";
import {
  circlePath,
  ellipsePath,
  linePath,
  placementToAffine,
  polygonPath,
  rectPath,
  regularPolygonPath,
  segmentsToPathData,
  starPath,
  transformSegments,
  type Segment2D,
} from "@/lib/services/construct/geometry2d";
import { parsePathData } from "@/lib/services/construct/pathParse";
import { runBoolean } from "@/lib/services/construct/pathBoolean";
import { faceToPathData, type PathItem } from "@/lib/services/construct/svgEmitter";

/**
 * resolve2d — tầng 2D của compiler: resolve shape refs (topo + cycle detect
 * + Levenshtein hint) và áp cutout 2D sau chiếu. Tách khỏi compile.ts để
 * orchestrator giữ gọn.
 */

function err(message: string, hint: string): never {
  throw new AppError("CONSTRUCTION_INVALID", message, hint);
}

/** Levenshtein cho gợi ý "Did you mean". */
function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let j = 1; j <= b.length; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const tmp = dp[i];
      dp[i] = Math.min(dp[i] + 1, dp[i - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[a.length];
}

export function unknownRefError(ref: string, context: string, known: readonly string[]): never {
  const nearest = [...known].sort((a, b) => levenshtein(ref, a) - levenshtein(ref, b))[0];
  const suggestion = nearest && levenshtein(ref, nearest) <= 3 ? `Did you mean "${nearest}"? ` : "";
  err(
    `Shape ref "${ref}" not found in ${context}.`,
    `${suggestion}Defined ids: ${known.join(", ") || "(none)"}.`,
  );
}

export interface ResolvedShape {
  readonly shape: Shape2D;
  /** Path data cuối (đã transform + boolean). */
  readonly d: string;
  /** true nếu boolean cho kết quả rỗng. */
  readonly isEmpty: boolean;
}

function primitiveSegments(shape: Shape2D): Segment2D[] {
  switch (shape.type) {
    case "rect":
      return rectPath(shape.w, shape.h, shape.rx);
    case "circle":
      return circlePath(shape.r);
    case "ellipse":
      return ellipsePath(shape.rx, shape.ry);
    case "polygon":
      return polygonPath(shape.points);
    case "regularPolygon":
      return regularPolygonPath(shape.sides, shape.r);
    case "star":
      return starPath(shape.points, shape.rOuter, shape.rInner);
    case "line":
      return linePath(shape.points);
    case "path":
      return parsePathData(shape.d, shape.id);
    case "boolean":
      throw new Error("unreachable");
  }
}

function hasPlacement(s: Shape2D): boolean {
  return (
    s.at[0] !== 0 || s.at[1] !== 0 || s.rotate !== 0 || s.skew[0] !== 0 || s.skew[1] !== 0 ||
    s.mirror !== undefined || (typeof s.scale === "number" ? s.scale !== 1 : true)
  );
}

export interface ShapeResolverOptions {
  readonly shapeMap: Map<string, Shape2D>;
  readonly allIds: readonly string[];
  readonly precision: number;
  readonly warnings: string[];
  readonly checkClock: (stage: string) => void;
}

export interface ShapeResolver {
  resolve(id: string, context: string, depth: number): ResolvedShape;
  readonly resolved: Map<string, ResolvedShape>;
}

/** Resolver memoized với cycle detect — mỗi lần compile tạo một instance. */
export function createShapeResolver(opts: ShapeResolverOptions): ShapeResolver {
  const { shapeMap, allIds, precision, warnings, checkClock } = opts;
  const resolved = new Map<string, ResolvedShape>();
  const resolving = new Set<string>();

  function resolve(id: string, context: string, depth: number): ResolvedShape {
    const cached = resolved.get(id);
    if (cached) return cached;
    const shape = shapeMap.get(id);
    if (!shape) unknownRefError(id, context, allIds);
    if (depth > CONSTRUCT_LIMITS.maxOpDepth) {
      err(
        `Boolean nesting deeper than ${CONSTRUCT_LIMITS.maxOpDepth} at "${id}".`,
        "Flatten the boolean tree — most artwork needs 2-3 levels.",
      );
    }
    if (resolving.has(id)) {
      err(
        `Boolean "${id}" is part of a reference cycle: ${[...resolving, id].join(" → ")}.`,
        "Boolean ops must form a tree — remove the back-reference.",
      );
    }

    let result: ResolvedShape;
    if (shape.type === "boolean") {
      resolving.add(id);
      const operands = shape.of.map((ref) => {
        const op = resolve(ref, `"${id}".of`, depth + 1);
        if (op.shape.type === "line") {
          err(
            `Boolean "${id}" references line "${ref}" — open strokes cannot participate in booleans.`,
            "Use a closed shape (rect/circle/polygon/path with Z) instead.",
          );
        }
        return op;
      });
      resolving.delete(id);
      const nonEmpty = operands.filter((o) => !o.isEmpty);
      if (nonEmpty.length < 2 && operands.some((o) => o.isEmpty)) {
        warnings.push(`Boolean "${id}": some operands are empty — result may be unexpected.`);
      }
      const bool = runBoolean(shape.op, operands.map((o) => o.d), precision, id);
      // Placement của chính boolean node áp dụng SAU phép toán
      let d = bool.d;
      if (!bool.isEmpty && hasPlacement(shape)) {
        const segs = transformSegments(parsePathData(bool.d, id), placementToAffine(shape));
        d = segmentsToPathData(segs, precision);
      }
      result = { shape, d, isEmpty: bool.isEmpty };
      checkClock(`boolean "${id}"`);
    } else {
      const segs = transformSegments(primitiveSegments(shape), placementToAffine(shape));
      result = { shape, d: segmentsToPathData(segs, precision), isEmpty: false };
    }
    resolved.set(id, result);
    return result;
  }

  return { resolve, resolved };
}

// ---------- Cutouts (boolean 2D sau chiếu) ----------

/** Entry trong draw list — cutout có thể ghi đè d hoặc gắn decal. */
export interface DrawEntry {
  face: ProjectedFace;
  fillOverride?: string;
  dOverride?: string;
  decals: PathItem[];
  /** PathItems vẽ TRƯỚC mặt này (vd glow halo sau lưng solid). */
  preItems?: PathItem[];
}

export interface CutoutOptions {
  readonly solidMap: Map<string, Solid>;
  /** Trả về kind smooth nếu solid là smooth (silhouette target). */
  readonly smoothKindOf: (solidId: string) => string | undefined;
  readonly resolver: ShapeResolver;
  readonly allIds: readonly string[];
  readonly precision: number;
  readonly warnings: string[];
  readonly checkClock: (stage: string) => void;
}

export function applyCutout(cutout: Cutout, list: DrawEntry[], opts: CutoutOptions): void {
  const { solidMap, smoothKindOf, resolver, allIds, precision, warnings, checkClock } = opts;
  const solid = solidMap.get(cutout.solid);
  if (!solid) unknownRefError(cutout.solid, "cutouts[].solid", allIds);
  const smoothKind = smoothKindOf(cutout.solid);

  // Depth sort exact có thể cắt một mặt thành nhiều fragment cùng
  // label/faceIndex — cutout áp lên TẤT CẢ fragment khớp
  let targets: DrawEntry[];
  if (smoothKind !== undefined) {
    if (cutout.mode === "subtract") {
      err(
        `Cutout target "${cutout.solid}" is a smooth ${smoothKind}.`,
        'Overlay maps to the silhouette plane; "subtract" requires a flat face (box, prism, extrude) or shading:"faceted".',
      );
    }
    targets = list.filter((e) => e.face.solidId === cutout.solid && e.face.label === "silhouette");
  } else if (typeof cutout.face === "string") {
    targets = list.filter((e) => e.face.solidId === cutout.solid && e.face.label === cutout.face);
  } else {
    targets = list.filter((e) => e.face.solidId === cutout.solid && e.face.faceIndex === cutout.face);
  }
  if (targets.length === 0) {
    const available = [
      ...new Set(
        list
          .filter((e) => e.face.solidId === cutout.solid)
          .map((e) => e.face.label ?? String(e.face.faceIndex)),
      ),
    ];
    err(
      `Cutout face "${String(cutout.face)}" of "${cutout.solid}" is not visible from this camera.`,
      `Visible faces of "${cutout.solid}": ${available.join(", ") || "(none)"} — change the camera or the face.`,
    );
  }

  const shapeRes = resolver.resolve(cutout.shape, "cutouts[].shape", 0);
  if (shapeRes.shape.type === "line") {
    err(`Cutout shape "${cutout.shape}" is an open line.`, "Use a closed shape for cutouts.");
  }
  // Đặt shape tại tâm CHUNG của mọi fragment (tâm mặt gốc) + offset at
  let sx = 0;
  let sy = 0;
  let count = 0;
  for (const t of targets) {
    for (const p of t.face.points) {
      sx += p[0];
      sy += p[1];
      count++;
    }
  }
  const affine = placementToAffine({
    at: [sx / count + cutout.at[0], sy / count + cutout.at[1]],
    rotate: cutout.rotate,
    scale: cutout.scale,
  });
  const shapeD = segmentsToPathData(
    transformSegments(parsePathData(shapeRes.d, cutout.shape), affine),
    precision,
  );

  if (cutout.mode === "subtract") {
    let removedAll = true;
    for (const target of targets) {
      const faceD = target.dOverride ?? faceToPathData(target.face, precision);
      const result = runBoolean("difference", [faceD, shapeD], precision, `cutout on "${cutout.solid}"`);
      target.dOverride = result.d;
      if (!result.isEmpty) removedAll = false;
    }
    if (removedAll) {
      warnings.push(`Cutout on "${cutout.solid}" removed the entire face.`);
    }
  } else {
    // Overlay: clip theo UNION các fragment, decal vẽ sau fragment cuối
    const faceDs = targets.map((t) => t.dOverride ?? faceToPathData(t.face, precision));
    const union =
      faceDs.length === 1
        ? { d: faceDs[0], isEmpty: faceDs[0].length === 0 }
        : runBoolean("union", faceDs, precision, `cutout on "${cutout.solid}"`);
    const clipped = runBoolean("intersection", [shapeD, union.d], precision, `cutout on "${cutout.solid}"`);
    if (clipped.isEmpty) {
      warnings.push(`Overlay cutout on "${cutout.solid}" does not intersect the face — skipped.`);
    } else {
      targets[targets.length - 1].decals.push({
        d: clipped.d,
        fill: cutout.fill ?? shapeRes.shape.fill ?? "#c0c0c0",
        fillRule: "nonzero",
      });
    }
  }
  checkClock("cutouts");
}

/** Dùng chung cho compile: gom operand bị tiêu thụ bởi boolean/extrude/cutout. */
export function collectConsumed(spec: ConstructSpec): Set<string> {
  const consumed = new Set<string>();
  for (const s of spec.shapes) if (s.type === "boolean") s.of.forEach((r) => consumed.add(r));
  for (const s of spec.solids) if (s.type === "extrude") consumed.add(s.profile);
  for (const c of spec.cutouts) consumed.add(c.shape);
  return consumed;
}
