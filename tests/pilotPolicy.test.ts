import { describe, expect, it } from "vitest";
import { isNonCommercialVoice, publishVerdict, spokenLines } from "@/lib/services/director/pilotPolicy";

describe("pilot publication rule (owner QC: the JA Piper voice is non-commercial)", () => {
  it("knows which voices are non-commercial from the voice licences", () => {
    expect(isNonCommercialVoice("piper:ja_JP-hi_fi_captain-medium")).toBe(true);
    expect(isNonCommercialVoice("piper:ja_JP-hi_fi_captain-medium#1@-2")).toBe(true);
    expect(isNonCommercialVoice("piper:en_US-john-medium")).toBe(false);
    expect(isNonCommercialVoice("piper:vi_VN-vais1000-medium")).toBe(false);
    expect(isNonCommercialVoice("ja")).toBe(false); // espeak-ng (GPL program, output is not restricted)
    expect(isNonCommercialVoice(null)).toBe(false);
  });

  it("an episode is publishable only when every non-commercial line was replaced by the owner's recording", () => {
    const steps = [
      { role: "dialogue", action: "voice", shotIndex: 1, model: "piper:ja_JP-hi_fi_captain-medium#1" },
      { role: "dialogue", action: "voice", shotIndex: 2, model: "subtitle-only" },
      { role: "dialogue", action: "voice", shotIndex: 3, model: "piper:ja_JP-hi_fi_captain-medium@-1" },
      { role: "dialogue", action: "voice", shotIndex: 4, model: "piper:ja_JP-hi_fi_captain-medium", error: "TTS failed" },
      { role: "artist", action: "draw", shotIndex: 1, model: "x" },
    ];
    const lines = spokenLines(steps);
    expect(lines).toEqual([{ shot: 1, voice: "piper:ja_JP-hi_fi_captain-medium#1" }, { shot: 2, voice: null }, { shot: 3, voice: "piper:ja_JP-hi_fi_captain-medium@-1" }]);
    expect(publishVerdict(lines, new Set([1])).blocking.map((l) => l.shot)).toEqual([3]);
    expect(publishVerdict(lines, new Set([1, 3])).publishable).toBe(true);
  });
});
