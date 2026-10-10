import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { buildProduction, estimateSeconds, morae, PAUSE_AFTER, productionSchema, readingCheck, subPages, subText, ttsText, VOICE } from "@/lib/services/director/ownerPackage";

/**
 * The owner's narration package (owner decision 2026-10-10, section B): the
 * EP013 schema, one scene per shot, every line read by the narrator.
 */
describe("owner narration package", () => {
  const p = buildProduction(
    [
      { lines: [{ text: "春の午後、喫茶ひだまりの窓から、やわらかな日が差しこみます。" }] },
      { lines: [{ text: "老紳士は、手紙を、声に出して読みはじめました。" }, { text: "「やっと、言えた気がします」。" }] },
      { lines: [{ text: "まあるい月が、縁側を、明るく照らしました。", tts: "まあるいつきが、縁側を、明るく照らしました。" }] },
    ],
    { pageChars: 14 },
  );

  it("is one scene per shot, with S01_L01 ids, the narrator, pause_after 0.5 and the owner's voice block", () => {
    expect(productionSchema.safeParse(p).success).toBe(true);
    expect(p.scenes.map((s) => s.lines.map((l) => l.id))).toEqual([["S01_L01"], ["S02_L01", "S02_L02"], ["S03_L01"]]);
    expect(p.scenes.flatMap((s) => s.lines).every((l) => l.speaker === "narrator" && l.pause_after === PAUSE_AFTER)).toBe(true);
    expect(p.voice).toEqual(VOICE);
    expect(VOICE).toMatchObject({ engine: "aivisspeech", speaker: "<NARRATOR_MODEL_ID>", speedScale: 0.9, pauseLengthScale: 1.3, intonationScale: 1.0, use_field: "tts_text" });
  });

  it("tts_text drops quote brackets and takes a reading override; sub_text drops the closing 。", () => {
    const quote = p.scenes[1].lines[1];
    expect(quote.tts_text).toBe("やっと、言えた気がします。");
    expect(quote.sub_text).toBe("「やっと、言えた気がします」");
    expect(p.scenes[2].lines[0].tts_text).toBe("まあるいつきが、縁側を、明るく照らしました。");
    expect(p.scenes[2].lines[0].text).toBe("まあるい月が、縁側を、明るく照らしました。");
    expect(subText("ちりん。風鈴が鳴りました。")).toBe("ちりん。風鈴が鳴りました");
    expect(ttsText("「おばあちゃん」と言いました。")).toBe("おばあちゃんと言いました。");
  });

  it("splits subtitles into pages after 、 within the page width, never inside a clause", () => {
    expect(subPages("春の午後、喫茶ひだまりの窓から、やわらかな日が差しこみます", 14)).toEqual(["春の午後", "喫茶ひだまりの窓から", "やわらかな日が差しこみます"]);
    expect(subPages("春の午後、喫茶ひだまり", 22)).toEqual(["春の午後、喫茶ひだまり"]);
  });

  it("reading_check.txt: a header comment, then id TAB text, newline, TAB kana", () => {
    const txt = readingCheck("PILOT01", [{ id: "S01_L01", text: "春の午後。", kana: "ハルノゴゴ。" }]);
    expect(txt).toBe("# reading_check · PILOT01 · expected katakana of tts_text per line (pyopenjtalk g2p, kana=True)\nS01_L01\t春の午後。\n\tハルノゴゴ。\n");
  });

  it("estimates length from morae (small kana join the previous mora)", () => {
    expect(morae("キョート")).toBe(3);
    expect(estimateSeconds("ハルノゴゴ", "春の午後")).toBeCloseTo(5 / 6 + 0.5);
  });

  it("the committed packages parse and fit their format (Shorts ≤ 60 s)", () => {
    for (const slug of ["PILOT01_tegami", "PILOT02_umeboshi", "PILOT03_tsukimi", "SHOWCASE_furin"]) {
      const dir = `docs/hackathon/pilot/${slug}`;
      expect(existsSync(`${dir}/reading_check.txt`), slug).toBe(true);
      expect(productionSchema.safeParse(JSON.parse(readFileSync(`${dir}/production.json`, "utf8"))).success, slug).toBe(true);
      const meta = JSON.parse(readFileSync(`${dir}/director.json`, "utf8")) as { maxSeconds: number | null; estimatedSeconds: number; aspectRatio: string };
      if (meta.maxSeconds) expect(meta.estimatedSeconds, slug).toBeLessThanOrEqual(meta.maxSeconds);
      if (slug.startsWith("PILOT")) expect(meta.aspectRatio).toBe("9:16");
    }
  });
});
