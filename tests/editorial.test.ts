import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildTimeline, timelineDuration, type TimelineInput } from "@/lib/services/timeline";
import { buildEdl, buildOtio, timecode } from "@/lib/services/editorial";
import { lintStoryboard, type LintFrame } from "@/lib/services/storyboardLint";

const frames: TimelineInput[] = [
  { index: 1, description: "A", scene: "SC01" },
  { index: 2, description: "B", clip: { fps: 12, frameCount: 36, duration: 3 }, transition: { kind: "dissolve", duration: 1 }, scene: "SC01", voice: { offset: 0.5, duration: 1.5 } },
  { index: 3, description: "C", transition: { kind: "cut", duration: 0.5 }, scene: "SC02" },
  { index: 4, description: "D", transition: { kind: "fadeBlack", duration: 0.6 }, scene: "SC02" },
];
const timeline = buildTimeline(frames, 2);
const shots = timeline.map((entry) => ({
  badge: `F0${entry.index}`,
  entry,
  media: `_shots/F0${entry.index}.mp4`,
  ...(entry.voiceStart !== undefined && { voiceMedia: `audio/F0${entry.index}.wav` }),
}));

const hasOtio = spawnSync("python3", ["-c", "import opentimelineio"], { stdio: "ignore" }).status === 0;
const hasCmx = spawnSync("python3", ["-c", "import opentimelineio as o; o.adapters.from_name('cmx_3600')"], { stdio: "ignore" }).status === 0;

describe("timeline với chuyển cảnh", () => {
  it("dissolve/fade CHỒNG lên cuối shot trước; cut thì nối liền", () => {
    expect(timeline.map((e) => [e.startSec, e.durationSec])).toEqual([
      [0, 2],
      [1, 3], // dissolve 1 s: bắt đầu 1 s trước khi F01 hết
      [4, 2],
      [5.416667, 2], // fadeBlack 0.6 s → 14 frame chẵn @24 = 0.583 s
    ]);
    expect(timelineDuration(timeline)).toBe(7.416667);
    // Mọi mốc là số NGUYÊN frame @24 fps
    for (const e of timeline) expect(Math.abs(e.startSec * 24 - Math.round(e.startSec * 24))).toBeLessThan(1e-4);
    expect(timeline[1].voiceStart).toBe(1.5);
  });

  it("chuyển cảnh bị kẹp ≤ nửa mỗi shot kề", () => {
    const t = buildTimeline([{ index: 1, description: "a" }, { index: 2, description: "b", transition: { kind: "dissolve", duration: 4 } }], 1.5);
    expect(t[1].transitionIn!.duration).toBe(0.75);
  });
});

describe("EDL CMX3600", () => {
  it("timecode non-drop 24 fps", () => {
    expect(timecode(3661.5, 24)).toBe("01:01:01:12");
  });
  it("cut = C; dissolve = dòng C zero-length của shot ra + dòng D (số frame) của shot vào", () => {
    const edl = buildEdl("My Film", shots);
    expect(edl.startsWith("TITLE: My Film\nFCM: NON-DROP FRAME")).toBe(true);
    expect(edl).toContain("001  F01      V     C        00:00:00:00 00:00:01:00 00:00:00:00 00:00:01:00");
    expect(edl).toContain("002  F01      V     C        00:00:01:00 00:00:01:00 00:00:01:00 00:00:01:00");
    expect(edl).toContain("002  F02      V     D    024 00:00:00:00 00:00:03:00 00:00:01:00 00:00:04:00");
    expect(edl).toContain("* EFFECT NAME: fadeBlack");
    expect(edl).toContain("* FROM CLIP NAME: _shots/F02.mp4");
  });
});

describe("EDL qua adapter cmx_3600 của OpenTimelineIO", () => {
  it.skipIf(!hasCmx)("parse được: thời lượng, số clip, số dissolve khớp", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "edl-"));
    const file = path.join(dir, "film.edl");
    writeFileSync(file, buildEdl("My Film", shots));
    const py = `
import opentimelineio as otio, json
t = otio.adapters.read_from_file(${JSON.stringify(file)}, rate=24)
v = t.video_tracks()[0]
print(json.dumps({"dur": t.duration().to_seconds(), "clips": len(list(t.find_clips())), "trans": len([c for c in v if isinstance(c, otio.schema.Transition)])}))`;
    const r = spawnSync("python3", ["-c", py], { encoding: "utf8" });
    const out = JSON.parse(r.stdout) as { dur: number; clips: number; trans: number };
    expect(out.dur).toBeCloseTo(timelineDuration(timeline), 5);
    expect(out.clips).toBe(4);
    expect(out.trans).toBe(2);
  });
});

describe("OpenTimelineIO", () => {
  it("cấu trúc: clip + transition + track thoại có gap", () => {
    const otio = buildOtio("My Film", shots) as { tracks: { children: { kind: string; children: { OTIO_SCHEMA: string }[] }[] } };
    const [video, audio] = otio.tracks.children;
    expect(video.children.filter((c) => c.OTIO_SCHEMA === "Transition.1")).toHaveLength(2);
    expect(video.children.filter((c) => c.OTIO_SCHEMA === "Clip.2")).toHaveLength(4);
    expect(audio.kind).toBe("Audio");
    expect(audio.children.map((c) => c.OTIO_SCHEMA)).toEqual(["Gap.1", "Clip.2"]);
  });

  it.skipIf(!hasOtio)("thư viện opentimelineio (ASWF) đọc được; thời lượng = timeline engine", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "otio-"));
    const file = path.join(dir, "film.otio");
    writeFileSync(file, JSON.stringify(buildOtio("My Film", shots)));
    const py = `
import opentimelineio as otio, json
t = otio.adapters.read_from_file(${JSON.stringify(file)})
v = t.video_tracks()[0]
print(json.dumps({"dur": t.duration().to_seconds(), "clips": len(list(t.find_clips())),
  "trans": len([c for c in v if isinstance(c, otio.schema.Transition)]),
  "voice": [c.range_in_parent().start_time.to_seconds() for c in t.audio_tracks()[0] if isinstance(c, otio.schema.Clip)]}))`;
    const r = spawnSync("python3", ["-c", py], { encoding: "utf8" });
    expect(r.stderr).toBe("");
    const out = JSON.parse(r.stdout) as { dur: number; clips: number; trans: number; voice: number[] };
    expect(out.dur).toBeCloseTo(timelineDuration(timeline), 5);
    expect(out.clips).toBe(5);
    expect(out.trans).toBe(2);
    expect(out.voice[0]).toBeCloseTo(1.5, 3);
  });
});

describe("storyboard lint", () => {
  const base: LintFrame = {
    index: 1,
    status: "done",
    shotType: "Medium",
    scene: "SC01",
    dialogue: null,
    voiceDuration: null,
    voiceOffset: 0,
    clipDuration: null,
    transition: "cut",
    transitionDuration: 0.5,
    camera: { azimuth: 20, zoom: 1 },
  };
  const lint = (fs: LintFrame[]) =>
    lintStoryboard(fs, buildTimeline(fs.map((f) => ({ index: f.index, description: "", clip: f.clipDuration ? { fps: 12, frameCount: f.clipDuration * 12, duration: f.clipDuration } : null, voice: f.voiceDuration ? { offset: f.voiceOffset, duration: f.voiceDuration } : null, transition: { kind: f.transition, duration: f.transitionDuration } })), 2));
  const codes = (fs: LintFrame[]) => lint(fs).map((f) => f.code);

  it("luật 180°: hai shot cùng cảnh, camera quay > 150°", () => {
    expect(codes([base, { ...base, index: 2, shotType: "Close-up", camera: { azimuth: 200, zoom: 2 } }])).toContain("LINE_CROSS_180");
  });
  it("jump cut: cùng cảnh, cùng cỡ cảnh, góc gần như nhau, cut", () => {
    expect(codes([base, { ...base, index: 2, camera: { azimuth: 28, zoom: 1.05 } }])).toContain("JUMP_CUT");
    expect(codes([base, { ...base, index: 2, transition: "dissolve", camera: { azimuth: 28, zoom: 1.05 } }])).not.toContain("JUMP_CUT");
  });
  it("tốc độ đọc phụ đề > 17 ký tự/giây", () => {
    expect(codes([{ ...base, dialogue: "Một câu thoại rất dài mà chỉ có một giây để đọc hết", voiceDuration: 1 }])).toContain("READING_SPEED");
  });
  it("thoại tràn shot + frame chưa có artwork", () => {
    const c = codes([{ ...base, status: "draft", clipDuration: 2, voiceDuration: 2, voiceOffset: 0.5 }]);
    expect(c).toContain("VOICE_OVERRUN");
    expect(c).toContain("NO_ARTWORK");
  });
});
