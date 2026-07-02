/**
 * Logic reorder/reindex thuần cho Frame — phần ghi DB nằm ở route handler
 * (transaction). Index luôn 1-based và liên tục 1..N.
 */

export interface OrderedFrame {
  readonly id: string;
  readonly index: number;
}

export interface ReindexUpdate {
  readonly id: string;
  readonly index: number;
}

/**
 * Di chuyển frame `frameId` tới vị trí `targetIndex` (1-based) và trả về
 * danh sách update {id, index} cho TOÀN BỘ frame theo thứ tự mới.
 * Trả về null nếu frameId không tồn tại.
 */
export function computeReorder(
  frames: readonly OrderedFrame[],
  frameId: string,
  targetIndex: number,
): readonly ReindexUpdate[] | null {
  const sorted = frames.slice().sort((a, b) => a.index - b.index);
  const from = sorted.findIndex((f) => f.id === frameId);
  if (from === -1) return null;

  const clamped = Math.min(Math.max(targetIndex, 1), sorted.length);
  const without = [...sorted.slice(0, from), ...sorted.slice(from + 1)];
  const reordered = [
    ...without.slice(0, clamped - 1),
    sorted[from],
    ...without.slice(clamped - 1),
  ];

  return reordered.map((f, i) => ({ id: f.id, index: i + 1 }));
}

/**
 * Sau khi xoá một frame: trả về update reindex để index liên tục 1..N.
 */
export function computeReindexAfterDelete(
  remaining: readonly OrderedFrame[],
): readonly ReindexUpdate[] {
  return remaining
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((f, i) => ({ id: f.id, index: i + 1 }));
}

/** Format index hiển thị: 1 → "F01", 12 → "F12", 123 → "F123". */
export function formatFrameBadge(index: number): string {
  return `F${String(index).padStart(2, "0")}`;
}
