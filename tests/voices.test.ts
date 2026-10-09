import { describe, expect, it } from "vitest";
import { castVoice, voiceTraits } from "@/lib/services/director/voices";
import { piperVoices, pitchShift, resetTtsCache, synthesizeSpeech, PIPER_MODELS } from "@/lib/services/tts";
import { decodeWav, audioDuration } from "@/lib/services/audio/wav";

const all = () => true;
const none = () => false;

describe("voice casting", () => {
  it("reads gender and age from the Bible (EN/VI/JA)", () => {
    expect(voiceTraits({ name: "Grandma Hoa", look: "elderly woman with a bun" })).toEqual({ gender: "female", age: "elder" });
    expect(voiceTraits({ name: "Tí", look: "a little boy in a red shirt" })).toEqual({ gender: "male", age: "child" });
    expect(voiceTraits({ name: "Ông Ba", look: "ông lão râu bạc" })).toEqual({ gender: "male", age: "elder" });
    expect(voiceTraits({ name: "ゆい", look: "浴衣を着た少女" })).toEqual({ gender: "female", age: "child" });
    expect(voiceTraits(null)).toEqual({ gender: "female", age: "adult" });
    // Vietnamese words match whole words only: "không" is not "ông", "bàn" is not "bà"
    expect(voiceTraits({ name: "Lan", look: "cô bé tóc ngắn, không đội nón, ngồi bên bàn" })).toEqual({ gender: "female", age: "child" });
  });

  it("gives each character a consistent neural voice when Piper is installed, espeak-ng otherwise", () => {
    expect(castVoice("en", { name: "Grandpa Joe", look: "an old man" }, all).voice).toBe("piper:en_US-john-medium@-2");
    expect(castVoice("en", { name: "Maya", look: "eight-year-old girl" }, all).voice).toBe("piper:en_US-kristin-medium@3");
    expect(castVoice("en", null, all).voice).toBe("piper:en_US-kristin-medium");
    expect(castVoice("vi", { name: "Ông", look: "ông nội" }, all).voice).toBe("piper:vi_VN-vais1000-medium@-6");
    expect(castVoice("ja", { name: "おじいさん", look: "老人の男" }, all).voice).toBe("piper:ja_JP-hi_fi_captain-medium#1@-2");
    expect(castVoice("en", null, none).voice).toBe("en-us");
    expect(castVoice("fr", null, all).voice).toBe("fr-fr");
    // same member → same voice, every time
    const m = { name: "Lan", look: "a girl with a bob" };
    expect(castVoice("vi", m, all)).toEqual(castVoice("vi", m, all));
  });

  it("refuses unknown or path-like Piper voices before spawning anything", async () => {
    await expect(synthesizeSpeech("hi", "piper:../../etc/passwd")).rejects.toThrow(/Invalid Piper voice/);
    await expect(synthesizeSpeech("hi", "piper:en_US-evil-medium")).rejects.toThrow(/Invalid Piper voice/);
    await expect(synthesizeSpeech("hi", "piper:en_US-kristin-medium; rm -rf /")).rejects.toThrow(/Invalid Piper voice/);
    expect(Object.values(PIPER_MODELS).find((v) => v.lang === "ja")?.licence).toMatch(/non-commercial/);
  });

  resetTtsCache();
  const installed = piperVoices();
  it.skipIf(!installed.includes("en"))("synthesises a real neural line (EN), pitch-shifted without changing its length", async () => {
    // (Piper's duration noise makes two syntheses of one line differ slightly, so shift the SAME line)
    const wav = await synthesizeSpeech("Grandma, why two cups?", "piper:en_US-kristin-medium", 150);
    const plain = decodeWav(wav);
    const high = decodeWav(await pitchShift(wav, 3));
    expect(audioDuration(plain)).toBeGreaterThan(0.8);
    expect(Math.abs(audioDuration(high) - audioDuration(plain))).toBeLessThan(0.01);
    expect((await pitchShift(wav, 3)).equals(wav)).toBe(false);
    expect(await synthesizeSpeech("Hi there.", "piper:en_US-john-medium@-2", 150)).toBeInstanceOf(Buffer);
  }, 60_000);
  it.skipIf(!installed.includes("ja"))("synthesises Japanese with the male speaker", async () => {
    const ja = decodeWav(await synthesizeSpeech("おばあちゃん、どうして毎朝お茶を二杯いれるの？", "piper:ja_JP-hi_fi_captain-medium#1", 150));
    expect(audioDuration(ja)).toBeGreaterThan(1);
  }, 60_000);
});
