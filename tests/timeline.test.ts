import { describe, expect, it } from "vitest";
import { buildAssembleScript, buildTimeline, timelineDuration } from "@/lib/services/timeline";
import { buildTimedSrt } from "@/lib/services/srtBuilder";

describe("timeline", () => {
  const frames = [
    { index: 3, description: "C", clip: null },
    { index: 1, description: "A", clip: null },
    { index: 2, description: "B", clip: { fps: 12, frameCount: 30, duration: 2.5 } },
  ];

  it("still giữ playbackSpeed, clip dài đúng frameCount/fps, tuần tự theo index", () => {
    const t = buildTimeline(frames, 1.5);
    expect(t.map((e) => [e.index, e.kind, e.startSec, e.durationSec])).toEqual([
      [1, "still", 0, 1.5],
      [2, "clip", 1.5, 2.5],
      [3, "still", 4, 1.5],
    ]);
    expect(timelineDuration(t)).toBe(5.5);
  });

  it("SRT theo timeline thật — phụ đề khớp shot motion", () => {
    const t = buildTimeline(frames, 1.5);
    const srt = buildTimedSrt(t.map((e) => ({ description: "x", startSec: e.startSec, durationSec: e.durationSec })));
    expect(srt).toContain("00:00:01,500 --> 00:00:04,000");
    expect(srt).toContain("00:00:04,000 --> 00:00:05,500");
  });

  it("assemble.sh: segment mỗi shot (still loop / chuỗi PNG) + concat", () => {
    const t = buildTimeline(frames, 1.5);
    const sh = buildAssembleScript(t.map((entry) => ({ badge: `F0${entry.index}`, entry })));
    expect(sh.startsWith("#!/usr/bin/env sh")).toBe(true);
    expect(sh).toContain("-loop 1 -framerate \"$FPS\" -t 1.5 -i F01.png");
    expect(sh).toContain("-framerate 12 -i clips/F02/%04d.png");
    expect(sh).toContain("-f concat -safe 0 -i _shots/list.txt -c copy film.mp4");
    // Kích thước chẵn cho libx264 (4:5 1K = 819 px lẻ)
    expect(sh).toContain("scale=trunc(iw/2)*2:trunc(ih/2)*2");
    expect(sh.indexOf("F01.mp4")).toBeLessThan(sh.indexOf("F02.mp4"));
  });

  it("thoại: frame tĩnh kéo dài tới hết câu + khoảng thở; clip giữ nguyên, giọng bị cắt ở cuối shot", () => {
    const t = buildTimeline(
      [
        { index: 1, description: "A", voice: { offset: 0.2, duration: 2.5 } },
        { index: 2, description: "B", clip: { fps: 12, frameCount: 24, duration: 2 }, voice: { offset: 0.5, duration: 3 } },
      ],
      1.5,
    );
    // 0.2 + 2.5 + 0.35 = 3.05 s → ceil lên frame phim: 74/24 = 3.083 s
    expect(t[0].durationSec).toBeCloseTo(74 / 24, 5);
    expect(t[0].voiceStart).toBeCloseTo(0.2, 6);
    expect(t[1].durationSec).toBe(2);
    expect(t[1].voiceStart).toBeCloseTo(t[1].startSec + 0.5, 6);
    expect(t[1].voiceDuration).toBeCloseTo(1.5, 6);
  });

  it("assemble.sh có mix → mux AAC vào film.mp4", () => {
    const t = buildTimeline([{ index: 1, description: "A" }], 1.5);
    const sh = buildAssembleScript(t.map((entry) => ({ badge: "F01", entry })), 24, { mix: "audio/mix.wav" });
    expect(sh).toContain("-i audio/mix.wav -map 0:v -map 1:a -c:v copy -c:a aac");
  });
});
