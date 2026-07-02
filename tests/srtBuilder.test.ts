import { describe, expect, it } from "vitest";
import { buildSrt } from "@/lib/services/srtBuilder";

describe("buildSrt", () => {
  it("builds sequential blocks at 1.5s per frame", () => {
    const srt = buildSrt(
      [
        { index: 1, description: "Mascot pops in" },
        { index: 2, description: "Ramen bowl glows" },
      ],
      1.5,
    );
    expect(srt).toBe(
      "1\n00:00:00,000 --> 00:00:01,500\nMascot pops in\n\n" +
        "2\n00:00:01,500 --> 00:00:03,000\nRamen bowl glows\n",
    );
  });

  it("sorts frames by index before building", () => {
    const srt = buildSrt(
      [
        { index: 2, description: "Second" },
        { index: 1, description: "First" },
      ],
      1,
    );
    expect(srt.indexOf("First")).toBeLessThan(srt.indexOf("Second"));
  });

  it("crosses the minute boundary correctly", () => {
    const frames = Array.from({ length: 13 }, (_, i) => ({
      index: i + 1,
      description: `Frame ${i + 1}`,
    }));
    const srt = buildSrt(frames, 5);
    expect(srt).toContain("00:01:00,000");
  });
});
