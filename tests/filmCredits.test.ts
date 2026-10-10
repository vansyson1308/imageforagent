import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { filmCredits, NEMOTRON_LINE, TAVILY_LINE, VAIS_CREDIT, voiceCreditLine, type CreditStep } from "@/lib/services/director/filmCredits";
import { OWNER_VOICE } from "@/lib/services/director/fixedNarration";
import { VOICE_CREDIT } from "@/lib/services/director/ownerPackage";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { appendCredits, CARD_TYPE, cardRows, creditFilter, CRF, ems, FADE_IN, FADE_OUT, probe, readVoiceCredit, TEXT_WIDTH, wrapTwo } from "../scripts/director/credits";

/** The end card of every published film (owner plan 2026-10-10, item 2): built from the run's trace. */
describe("film credits", () => {
  const voice = (model: string): CreditStep => ({ role: "dialogue", action: "voice", model });
  const search = (results: number, error?: string): CreditStep => ({ role: "researcher", action: "search", model: "tavily/search", output: JSON.stringify(Array.from({ length: results }, (_, i) => ({ title: `r${i}`, url: `https://example.org/${i}` }))), error });

  it("every film credits Nemotron on Nebius; nothing else unless the run used it", () => {
    expect(filmCredits([voice("piper:en_US-kristin-medium")])).toEqual([{ main: NEMOTRON_LINE }]);
    expect(filmCredits([])).toEqual([{ main: "Made with NVIDIA Nemotron on Nebius Token Factory" }]);
  });

  it("the owner's AivisSpeech narration → the voice credit from qa/voice_credit.txt, name and detail split at （", () => {
    const file = readFileSync("docs/hackathon/pilot/SHOWCASE_furin/qa/voice_credit.txt", "utf8");
    expect(voiceCreditLine(file)).toBe(VOICE_CREDIT);
    expect(readVoiceCredit("docs/hackathon/pilot/PILOT01_tegami")).toBe(VOICE_CREDIT);
    expect(readVoiceCredit("docs/hackathon/pilot/nowhere")).toBeNull();
    const c = filmCredits([voice(OWNER_VOICE), voice(OWNER_VOICE)], { voiceCredit: file });
    expect(c[0]).toEqual({ main: "音声合成：AivisSpeech / morioki", detail: "（ボイス提供：もりおき、モデル制作：yuki、ACML 1.0）" });
    expect(c).toHaveLength(2);
    // without the file, the decided text
    expect(filmCredits([voice(OWNER_VOICE)])[0].main).toBe("音声合成：AivisSpeech / morioki");
  });

  it("a Vietnamese Piper voice → the VAIS-1000 attribution (CC BY 4.0), once", () => {
    const c = filmCredits([voice("piper:vi_VN-vais1000-medium"), voice("piper:vi_VN-vais1000-medium@-1")]);
    expect(c).toEqual([VAIS_CREDIT, { main: NEMOTRON_LINE }]);
    expect(VAIS_CREDIT.detail).toContain("CC BY 4.0");
  });

  it("Tavily only when a search returned references (not on a failed or empty search, nor a skipped one)", () => {
    expect(filmCredits([search(3)]).map((b) => b.main)).toContain(TAVILY_LINE);
    expect(filmCredits([search(0)]).map((b) => b.main)).not.toContain(TAVILY_LINE);
    expect(filmCredits([search(2, "HTTP 500")]).map((b) => b.main)).not.toContain(TAVILY_LINE);
    expect(filmCredits([{ role: "researcher", action: "search", model: "tavily", output: null }]).map((b) => b.main)).not.toContain(TAVILY_LINE);
  });

  it("the published v2 bánh chưng trace gets VAIS-1000 + Nemotron (+ Tavily if its research found references)", () => {
    const t = JSON.parse(readFileSync("public/showcase/v2-banh-chung/trace.json", "utf8")) as { steps: CreditStep[] };
    const mains = filmCredits(t.steps).map((b) => b.main);
    expect(mains.slice(0, 2)).toEqual([VAIS_CREDIT.main, NEMOTRON_LINE]);
  });

  const ALL = [{ main: "音声合成：AivisSpeech / morioki", detail: "（ボイス提供：もりおき、モデル制作：yuki、ACML 1.0）" }, VAIS_CREDIT, { main: NEMOTRON_LINE }, { main: TAVILY_LINE }];

  it("no row shrinks below its floor (9:16 main ≥ 40, detail ≥ 30; 16:9 main ≥ 36, detail ≥ 26) and every row fits", () => {
    for (const aspect of ["16:9", "9:16"] as const) {
      const T = CARD_TYPE[aspect];
      const rows = cardRows(aspect, ALL);
      for (const r of rows) {
        const floor = r.fill === "#5a3a22" ? T.mainFloor : T.detailFloor;
        expect(r.size, `${aspect} ${r.text}`).toBeGreaterThanOrEqual(floor);
        expect(ems(r.text) * r.size, `${aspect} ${r.text}`).toBeLessThanOrEqual(T.width * TEXT_WIDTH + 1);
      }
    }
    expect(CARD_TYPE["9:16"].main).toBe(56);
    // at 9:16 the long lines wrap onto two rows instead of shrinking
    const tall = cardRows("9:16", ALL).map((r) => r.text);
    expect(tall).toContain("Made with NVIDIA Nemotron");
    expect(tall).toContain("on Nebius Token Factory");
    expect(tall).toContain("Vietnamese voice: Piper");
    // at 16:9 they stay on one row
    expect(cardRows("16:9", ALL).map((r) => r.text)).toContain(NEMOTRON_LINE);
  });

  it("wraps at the space nearest the middle, or after 、/： in Japanese", () => {
    expect(wrapTwo("Made with NVIDIA Nemotron on Nebius Token Factory")).toEqual(["Made with NVIDIA Nemotron", "on Nebius Token Factory"]);
    expect(wrapTwo("（ボイス提供：もりおき、モデル制作：yuki、ACML 1.0）")).toEqual(["（ボイス提供：もりおき、", "モデル制作：yuki、ACML 1.0）"]);
    expect(wrapTwo("あいうえおかきくけこ")).toEqual(["あいうえお", "かきくけこ"]);
  });

  it("fades the film out over its last 0.5 s (picture and sound) and the card in over 0.3 s", () => {
    const f = creditFilter({ w: 1080, h: 1920, fps: 12, audio: true, dur: 60 });
    expect(FADE_OUT).toBe(0.5);
    expect(FADE_IN).toBe(0.3);
    expect(f).toContain("fade=t=out:st=59.500:d=0.5");
    expect(f).toContain("afade=t=out:st=59.500:d=0.5");
    expect(f).toContain("fade=t=in:st=0:d=0.3");
    expect(f).toContain("concat=n=2:v=1:a=1");
    expect(creditFilter({ w: 1080, h: 1920, fps: 12, audio: false, dur: 60 })).toContain("concat=n=2:v=1:a=0");
  });

  const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
  it.skipIf(!hasFfmpeg)("appends the card to a real film: total = film + 3 s, sound faded at the cut, x264 CRF 18", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "credits-"));
    try {
      const film = path.join(dir, "film.mp4");
      const make = spawnSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=320x568:r=12:d=2", "-f", "lavfi", "-i", "sine=f=440:d=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", film]);
      expect(make.status).toBe(0);
      await appendCredits(film, "9:16", [{ main: NEMOTRON_LINE }]);
      const p = probe(film);
      expect(p.dur).toBeGreaterThan(4.95);
      expect(p.dur).toBeLessThan(5.1);
      const peak = (from: number, to: number) => Number(/max_volume: (-?[\d.]+|-inf) dB/.exec(spawnSync("ffmpeg", ["-i", film, "-af", `atrim=${from}:${to},volumedetect`, "-f", "null", "-"], { encoding: "utf8" }).stderr)?.[1] ?? "-inf");
      expect(peak(1.9, 1.98)).toBeLessThan(peak(0.5, 1.4) - 12);
      expect(spawnSync("grep", ["-c", "-a", `crf=${CRF}.0`, film], { encoding: "utf8" }).stdout.trim()).not.toBe("0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("contact sheet", () => {
  it("puts every shot on one image in reading order: 4 columns at 16:9, 6 at 9:16", async () => {
    const { contactSheet, sheetColumns, tileSize } = await import("../scripts/director/contactSheet");
    const sharp = (await import("sharp")).default;
    const tile = await sharp({ create: { width: 64, height: 36, channels: 3, background: "#c84" } }).png().toBuffer();
    const tiles = Array.from({ length: 11 }, (_, i) => ({ image: tile, label: `${i + 1} · MS · critic 7/10` }));
    expect(sheetColumns("16:9")).toBe(4);
    expect(sheetColumns("9:16")).toBe(6);
    const meta = await sharp(await contactSheet(tiles, { aspect: "16:9", title: "v2-kite" })).metadata();
    const { w, h } = tileSize("16:9");
    expect(meta.width).toBe(4 * w + 5 * 12);
    expect(meta.height).toBe(56 + 3 * (h + 30 + 12) + 12);
    expect(meta.format).toBe("jpeg");
  });
});
