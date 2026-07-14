import {
  FillRule,
  PathBoolean,
  PathBooleanOperation,
  pathFromPathData,
  pathToPathData,
} from "path-bool";
import { AppError } from "@/lib/services/apiError";
import { CONSTRUCT_LIMITS } from "@/lib/config/limits";
import { fmt } from "@/lib/services/construct/geometry2d";

/**
 * Wrapper path-bool: nhận path data chuẩn (M/L/C/Z tuyệt đối), chạy phép
 * boolean, trả về path data đã re-quantize theo precision + chuẩn hoá Z.
 * Mọi lỗi từ path-bool đều map thành CONSTRUCTION_INVALID kèm hint.
 */

export type BooleanOp = "union" | "difference" | "intersection" | "exclusion";

const OP_MAP: Record<BooleanOp, PathBooleanOperation> = {
  union: PathBooleanOperation.Union,
  difference: PathBooleanOperation.Difference,
  intersection: PathBooleanOperation.Intersection,
  exclusion: PathBooleanOperation.Exclusion,
};

/** Đếm lệnh path thô — enforce trần input trước khi đưa vào path-bool. */
export function countPathCommands(d: string): number {
  return d.match(/[MLCQAZmlcqaz]/g)?.length ?? 0;
}

/**
 * Re-quantize toàn bộ số trong path data theo precision, chuẩn hoá "-0".
 * path-bool emit 12 chữ số thập phân — phải ép về precision để deterministic
 * và gọn byte.
 */
export function quantizePathData(d: string, precision: number): string {
  return d
    .replace(/-?\d+\.?\d*(?:[eE][+-]?\d+)?/g, (num) => fmt(Number(num), precision))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Chuẩn hoá path đóng: path-bool đóng vòng bằng cách lặp lại điểm đầu —
 * thay đoạn "L <điểm đầu>" cuối bằng "Z" cho gọn và đúng ngữ nghĩa fill.
 */
export function closeWithZ(d: string): string {
  const subpaths = d.split(/(?=M )/).map((s) => s.trim()).filter(Boolean);
  return subpaths
    .map((sub) => {
      if (sub.endsWith("Z")) return sub;
      const start = sub.match(/^M (-?[\d.]+) (-?[\d.]+)/);
      if (!start) return sub;
      const tail = new RegExp(`L ${escapeRegExp(start[1])} ${escapeRegExp(start[2])}$`);
      if (tail.test(sub)) return sub.replace(tail, "Z");
      return `${sub} Z`;
    })
    .join(" ");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface BooleanResult {
  /** Path data đã quantize + chuẩn hoá Z; "" nếu kết quả rỗng. */
  readonly d: string;
  readonly isEmpty: boolean;
}

/**
 * Chạy phép boolean trên n operand (n ≥ 2).
 * Semantics của path-bool với nhiều input: difference = path đầu trừ union
 * phần còn lại; exclusion = vùng phủ bởi số lẻ path — khớp hợp đồng spec.
 */
export function runBoolean(
  op: BooleanOp,
  operandPathData: readonly string[],
  precision: number,
  context: string,
): BooleanResult {
  if (operandPathData.length > CONSTRUCT_LIMITS.maxBooleanOperands) {
    throw new AppError(
      "CONSTRUCTION_INVALID",
      `Boolean "${context}" has ${operandPathData.length} operands (max ${CONSTRUCT_LIMITS.maxBooleanOperands}).`,
      "Split the operation into nested booleans or reduce the operand list.",
    );
  }

  const totalSegments = operandPathData.reduce((sum, d) => sum + countPathCommands(d), 0);
  if (totalSegments > CONSTRUCT_LIMITS.maxBooleanInputSegments) {
    throw new AppError(
      "CONSTRUCTION_INVALID",
      `Boolean "${context}" has ${totalSegments} input segments (max ${CONSTRUCT_LIMITS.maxBooleanInputSegments}).`,
      'Reduce "segments" on curved shapes or simplify operand paths.',
    );
  }

  try {
    const bool = new PathBoolean(
      operandPathData.map((d) => ({
        path: pathFromPathData(d),
        fillRule: FillRule.NonZero,
      })),
    );
    const result = bool.get(OP_MAP[op]);
    if (result.length === 0) return { d: "", isEmpty: true };

    const d = result
      .map((p) => closeWithZ(quantizePathData(pathToPathData(p), precision)))
      .join(" ");
    return { d, isEmpty: d.length === 0 };
  } catch (err: unknown) {
    if (err instanceof AppError) throw err;
    const detail = err instanceof Error ? err.message : String(err);
    throw new AppError(
      "CONSTRUCTION_INVALID",
      `Boolean "${context}" (${op}) failed: ${detail}`,
      "Operand paths may be degenerate or self-intersecting — simplify the shapes or nudge coordinates slightly.",
    );
  }
}

/** Union path 2D theo lô ≤ maxBooleanOperands — dùng chung shadow + silhouette. */
export function unionPaths(ds: string[], precision: number, context: string): string {
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

/**
 * Union một path với chính nó — chuẩn hoá path tự cắt (self-intersecting)
 * thành outline sạch theo nonzero fill. Dùng trước extrude.
 */
export function normalizeSelfUnion(d: string, precision: number, context: string): string {
  try {
    const bool = new PathBoolean([{ path: pathFromPathData(d), fillRule: FillRule.NonZero }]);
    const result = bool.get(PathBooleanOperation.Union);
    if (result.length === 0) return "";
    return result
      .map((p) => closeWithZ(quantizePathData(pathToPathData(p), precision)))
      .join(" ");
  } catch {
    // Path không parse được bằng path-bool → giữ nguyên, lỗi thật sẽ nổi ở
    // bước render với thông điệp rõ hơn.
    void context;
    return d;
  }
}
