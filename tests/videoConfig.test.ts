import { describe, expect, it } from "vitest";
import {
  effectiveClipDuration,
  estimateCost,
  videoDimensions,
} from "@/lib/config/video";
import { motionForShotType } from "@/lib/config/motion";
import { buildSrtFromDurations } from "@/lib/services/srtBuilder";

describe("effectiveClipDuration", () => {
  it("1080p ép 8s", () => {
    expect(effectiveClipDuration("lite", 4, "1080p")).toBe(8);
  });
  it("fast dùng refs → ép 8s", () => {
    expect(effectiveClipDuration("fast", 4, "720p")).toBe(8);
  });
  it("lite 720p giữ duration chọn", () => {
    expect(effectiveClipDuration("lite", 6, "720p")).toBe(6);
  });
  it("animatic tự do", () => {
    expect(effectiveClipDuration("animatic", 5, "720p")).toBe(5);
  });
});

describe("estimateCost", () => {
  it("animatic = $0", () => {
    expect(estimateCost("animatic", 7, 8).estUsd).toBe(0);
  });
  it("fast 7×8s = 56s × $0.15 = $8.4", () => {
    const est = estimateCost("fast", 7, 8);
    expect(est.totalSeconds).toBe(56);
    expect(est.estUsd).toBeCloseTo(8.4);
  });
});

describe("videoDimensions", () => {
  it("16:9 720p → 1280×720; 9:16 → 720×1280", () => {
    expect(videoDimensions("720p", "16:9")).toEqual({ w: 1280, h: 720 });
    expect(videoDimensions("720p", "9:16")).toEqual({ w: 720, h: 1280 });
  });
  it("16:9 1080p → 1920×1080", () => {
    expect(videoDimensions("1080p", "16:9")).toEqual({ w: 1920, h: 1080 });
  });
});

describe("motionForShotType", () => {
  it("map các shot type chính", () => {
    expect(motionForShotType("Slow zoom-in").kenBurns).toBe("zoom-in");
    expect(motionForShotType("Wide static shot").kenBurns).toBe("static");
    expect(motionForShotType("Pan left across the bar").kenBurns).toBe("pan-left");
    expect(motionForShotType("Không rõ").kenBurns).toBe("zoom-in"); // default
  });
});

describe("buildSrtFromDurations", () => {
  it("timing theo duration thật, trừ overlap crossfade", () => {
    const srt = buildSrtFromDurations(
      [
        { index: 1, description: "A", durationSec: 8 },
        { index: 2, description: "B", durationSec: 4 },
        { index: 3, description: "C", durationSec: 8 },
      ],
      0.4,
    );
    // Clip 2 bắt đầu tại 8 − 0.4 = 7.6
    expect(srt).toContain("00:00:07,600 --> 00:00:11,600");
    // Clip 3 bắt đầu tại 7.6 + 4 − 0.4 = 11.2
    expect(srt).toContain("00:00:11,200 --> 00:00:19,200");
  });

  it("cut (overlap 0): nối tiếp chuẩn", () => {
    const srt = buildSrtFromDurations(
      [
        { index: 1, description: "A", durationSec: 8 },
        { index: 2, description: "B", durationSec: 8 },
      ],
      0,
    );
    expect(srt).toContain("00:00:08,000 --> 00:00:16,000");
  });
});
