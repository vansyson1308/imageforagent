import { describe, expect, it } from "vitest";
import {
  computeReindexAfterDelete,
  computeReorder,
  formatFrameBadge,
} from "@/lib/services/frameService";

const frames = [
  { id: "a", index: 1 },
  { id: "b", index: 2 },
  { id: "c", index: 3 },
  { id: "d", index: 4 },
];

describe("computeReorder", () => {
  it("moves a frame forward and keeps indexes contiguous 1..N", () => {
    const updates = computeReorder(frames, "a", 3);
    expect(updates).not.toBeNull();
    expect(updates!.map((u) => u.id)).toEqual(["b", "c", "a", "d"]);
    expect(updates!.map((u) => u.index)).toEqual([1, 2, 3, 4]);
  });

  it("moves a frame backward", () => {
    const updates = computeReorder(frames, "d", 1);
    expect(updates!.map((u) => u.id)).toEqual(["d", "a", "b", "c"]);
    expect(updates!.map((u) => u.index)).toEqual([1, 2, 3, 4]);
  });

  it("clamps target index out of range", () => {
    const updates = computeReorder(frames, "b", 99);
    expect(updates!.map((u) => u.id)).toEqual(["a", "c", "d", "b"]);
  });

  it("returns null for unknown frame id", () => {
    expect(computeReorder(frames, "zzz", 1)).toBeNull();
  });

  it("handles input not sorted by index", () => {
    const shuffled = [frames[2], frames[0], frames[3], frames[1]];
    const updates = computeReorder(shuffled, "a", 2);
    expect(updates!.map((u) => u.id)).toEqual(["b", "a", "c", "d"]);
    expect(updates!.map((u) => u.index)).toEqual([1, 2, 3, 4]);
  });
});

describe("computeReindexAfterDelete", () => {
  it("closes the gap after deletion", () => {
    const remaining = [
      { id: "a", index: 1 },
      { id: "c", index: 3 },
      { id: "d", index: 4 },
    ];
    const updates = computeReindexAfterDelete(remaining);
    expect(updates.map((u) => u.index)).toEqual([1, 2, 3]);
    expect(updates.map((u) => u.id)).toEqual(["a", "c", "d"]);
  });
});

describe("formatFrameBadge", () => {
  it("pads to 2 digits", () => {
    expect(formatFrameBadge(1)).toBe("F01");
    expect(formatFrameBadge(12)).toBe("F12");
    expect(formatFrameBadge(123)).toBe("F123");
  });
});
