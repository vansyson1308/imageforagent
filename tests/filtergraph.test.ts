import { describe, expect, it } from "vitest";
import {
  buildAnimaticArgs,
  buildAssemblyArgs,
  buildNormalizeArgs,
  type AssemblyOptions,
} from "@/lib/services/filtergraph";

function joinFilter(args: string[]): string {
  const i = args.indexOf("-filter_complex");
  return i >= 0 ? args[i + 1] : "";
}

describe("buildAnimaticArgs", () => {
  it("zoom-in 16:9 8s: zoompan đúng số frame + anullsrc", () => {
    const args = buildAnimaticArgs({
      imagePath: "in.png",
      outputPath: "out.mp4",
      durationSec: 8,
      width: 1280,
      height: 720,
      kenBurns: "zoom-in",
    });
    const filter = joinFilter(args);
    expect(filter).toContain("zoompan=z='min(1+0.12*on/192,1.12)'");
    expect(filter).toContain("s=1280x720");
    expect(args).toContain("anullsrc=r=48000:cl=stereo");
    expect(args[args.length - 1]).toBe("out.mp4");
  });

  it.each(["zoom-out", "pan-left", "pan-right", "static"] as const)(
    "kenBurns %s snapshot",
    (effect) => {
      const args = buildAnimaticArgs({
        imagePath: "in.png",
        outputPath: "out.mp4",
        durationSec: 4,
        width: 720,
        height: 1280,
        kenBurns: effect,
      });
      expect(joinFilter(args)).toMatchSnapshot();
    },
  );
});

describe("buildNormalizeArgs", () => {
  const base = {
    inputPath: "clip.mp4",
    outputPath: "norm.mp4",
    width: 1280,
    height: 720,
    durationSec: 8,
  };

  it("native + VO: native −13dB dưới VO, amix duration=first", () => {
    const args = buildNormalizeArgs({
      ...base,
      voPath: "vo.wav",
      clipHasAudio: true,
      nativeAudioEnabled: true,
      voiceoverEnabled: true,
    });
    const f = joinFilter(args);
    expect(f).toContain("volume=-13dB");
    expect(f).toContain("amix=inputs=2:duration=first:normalize=0");
    expect(args).toContain("vo.wav");
  });

  it("chỉ native (VO tắt)", () => {
    const args = buildNormalizeArgs({
      ...base,
      voPath: "vo.wav",
      clipHasAudio: true,
      nativeAudioEnabled: true,
      voiceoverEnabled: false,
    });
    const f = joinFilter(args);
    expect(f).not.toContain("volume=-13dB");
    expect(args).not.toContain("vo.wav");
  });

  it("chỉ VO (clip câm): apad + atrim theo duration", () => {
    const args = buildNormalizeArgs({
      ...base,
      voPath: "vo.wav",
      clipHasAudio: false,
      nativeAudioEnabled: true,
      voiceoverEnabled: true,
    });
    expect(joinFilter(args)).toContain("apad,atrim=0:8");
  });

  it("câm hoàn toàn: chèn anullsrc", () => {
    const args = buildNormalizeArgs({
      ...base,
      voPath: null,
      clipHasAudio: false,
      nativeAudioEnabled: true,
      voiceoverEnabled: true,
    });
    expect(args).toContain("anullsrc=r=48000:cl=stereo");
  });

  it("native bị tắt toggle → coi như câm", () => {
    const args = buildNormalizeArgs({
      ...base,
      voPath: null,
      clipHasAudio: true,
      nativeAudioEnabled: false,
      voiceoverEnabled: true,
    });
    expect(args).toContain("anullsrc=r=48000:cl=stereo");
  });
});

describe("buildAssemblyArgs", () => {
  const clips = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ path: `c${i}.mp4`, durationSec: 8 }));

  const baseOpts = (over: Partial<AssemblyOptions>): AssemblyOptions => ({
    clips: clips(3),
    outputPath: "final.mp4",
    width: 1280,
    transitionType: "cut",
    transitionSec: 0.4,
    bgm: null,
    captionsFileName: null,
    colorPolish: false,
    watermark: null,
    ...over,
  });

  it("cut 3 clip: concat n=3, tổng duration = Σ", () => {
    const { args, totalDurationSec } = buildAssemblyArgs(baseOpts({}));
    expect(joinFilter(args)).toContain("concat=n=3:v=1:a=1[vcat][sp]");
    expect(totalDurationSec).toBe(24);
    expect(joinFilter(args)).toContain("loudnorm=I=-16:TP=-1.5:LRA=11");
  });

  it("crossfade 3 clip: chuỗi xfade offset đúng, tổng trừ overlap", () => {
    const { args, totalDurationSec } = buildAssemblyArgs(
      baseOpts({ transitionType: "crossfade" }),
    );
    const f = joinFilter(args);
    expect(f).toContain("xfade=transition=fade:duration=0.4:offset=7.600");
    expect(f).toContain("xfade=transition=fade:duration=0.4:offset=15.200");
    expect(f).toContain("acrossfade=d=0.4");
    expect(totalDurationSec).toBeCloseTo(24 - 2 * 0.4);
  });

  it("1 clip: không concat, vẫn loudnorm", () => {
    const { args } = buildAssemblyArgs(baseOpts({ clips: clips(1) }));
    const f = joinFilter(args);
    expect(f).not.toContain("concat=");
    expect(f).toContain("loudnorm");
  });

  it("BGM: sidechaincompress key bằng speech bus + asplit + fade", () => {
    const { args } = buildAssemblyArgs(
      baseOpts({ bgm: { path: "bgm.mp3", volumeDb: -6 } }),
    );
    const f = joinFilter(args);
    expect(f).toContain("asplit=2[spKey][spMix]");
    expect(f).toContain("sidechaincompress=threshold=0.03:ratio=8:attack=5:release=400");
    expect(f).toContain("volume=-6dB");
    expect(f).toContain("afade=t=in:d=1");
    expect(args).toContain("-stream_loop");
  });

  it("full hậu kỳ: polish + captions + watermark đúng thứ tự", () => {
    const { args } = buildAssemblyArgs(
      baseOpts({
        colorPolish: true,
        captionsFileName: "captions.srt",
        watermark: {
          path: "wm.png",
          position: "bottom-right",
          scalePercent: 12,
          opacity: 0.85,
        },
      }),
    );
    const f = joinFilter(args);
    const iPolish = f.indexOf("eq=saturation");
    const iSubs = f.indexOf("subtitles=captions.srt");
    const iOverlay = f.indexOf("overlay=main_w-overlay_w-24:main_h-overlay_h-24");
    expect(iPolish).toBeGreaterThan(-1);
    expect(iSubs).toBeGreaterThan(iPolish);
    expect(iOverlay).toBeGreaterThan(iSubs);
    expect(f).toContain("colorchannelmixer=aa=0.85");
    expect(f).toContain("scale=154:-1"); // 12% × 1280
  });

  it.each([
    [1, "cut"],
    [2, "crossfade"],
    [5, "crossfade"],
  ] as const)("snapshot %s clip / %s", (n, transition) => {
    const { args } = buildAssemblyArgs(
      baseOpts({
        clips: clips(n),
        transitionType: transition,
        bgm: { path: "bgm.mp3", volumeDb: -8 },
        colorPolish: true,
        captionsFileName: "captions.srt",
        watermark: { path: "wm.png", position: "top-left", scalePercent: 10, opacity: 0.7 },
      }),
    );
    expect(joinFilter(args)).toMatchSnapshot();
  });

  it("throw khi 0 clip", () => {
    expect(() => buildAssemblyArgs(baseOpts({ clips: [] }))).toThrow();
  });
});
