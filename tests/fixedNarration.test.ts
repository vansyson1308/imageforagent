import { afterAll, beforeAll, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { prisma } from "@/lib/db";
import { MockLlmProvider, type MockHandler } from "@/lib/providers/mockLlmProvider";
import { demoHandler, MOCK_MODELS } from "@/lib/services/director/demoCrew";
import { createRun, executeRun, registerRun, unregisterRun } from "@/lib/services/director/loop";
import { DEFAULT_BUDGET } from "@/lib/services/director/budget";
import { hasRecording, levelLine, LINE_LUFS, shotText, shotVoice, timingsById, type NarrationShot } from "@/lib/services/director/fixedNarration";
import { measureLoudness } from "@/lib/services/audio/loudness";
import { OWNER_VOICE } from "@/lib/services/director/editor";
import { shotDuration } from "@/lib/services/director/artist";
import { audioDuration, decodeWav, encodeWav } from "@/lib/services/audio/wav";
import { publishVerdict, spokenLines } from "@/lib/services/director/pilotPolicy";

/**
 * Fixed narration (owner decision 2026-10-10, section B): the owner's
 * recordings are decided before the run; each shot holds its real audio +
 * pause_after; neither Ultra nor the Editor rewrites a line.
 */
const tone = (seconds: number, rate = 24000) => encodeWav({ sampleRate: rate, channels: [Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 220 * i) / rate))] }, 16);

describe("fixed narration: one voice per shot from the owner's lines", () => {
  it("joins a shot's lines in order with each pause_after, mono 16-bit at the first line's rate", () => {
    const shot: NarrationShot = { lines: [{ id: "S01_L01", text: "一。", pauseAfter: 0.5, wav: tone(1.0) }, { id: "S01_L02", text: "二。", pauseAfter: 0.5, wav: tone(0.5, 48000) }] };
    const v = shotVoice(shot)!;
    expect(v.seconds).toBeCloseTo(2.5, 2);
    expect(v.lines.map((l) => [l.id, l.seconds])).toEqual([["S01_L01", 1], ["S01_L02", 0.5]]);
    const a = decodeWav(v.wav);
    expect(a.sampleRate).toBe(24000);
    expect(a.channels).toHaveLength(1);
    expect(audioDuration(a)).toBeCloseTo(2.5, 2);
    expect(v.wav.readUInt16LE(34)).toBe(16);
  });

  it("levels every line to −18 LUFS before the mix, limiting peaks to −1 dBFS (a quiet line with loud peaks too)", () => {
    const rate = 24000;
    // a quiet voice-like tone (about −26 LUFS) with short loud spikes, like a line whose peaks already sit near full scale
    const ch = Float32Array.from({ length: rate * 3 }, (_, i) => 0.05 * Math.sin((2 * Math.PI * 220 * i) / rate) + (i % 6000 < 3 ? 0.85 : 0));
    const lv = levelLine({ sampleRate: rate, channels: [ch] });
    expect(lv.lufsIn).toBeLessThan(-24);
    expect(Math.abs(lv.lufsOut - LINE_LUFS)).toBeLessThanOrEqual(0.3);
    expect(measureLoudness(lv.audio).samplePeak).toBeLessThanOrEqual(-0.99);
    const loud = levelLine({ sampleRate: rate, channels: [Float32Array.from({ length: rate * 2 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 220 * i) / rate))] });
    expect(loud.gainDb).toBeLessThan(0);
    expect(Math.abs(loud.lufsOut - LINE_LUFS)).toBeLessThanOrEqual(0.3);
    // shotVoice levels each line (and keeps their lengths)
    const v = shotVoice({ lines: [{ id: "S01_L01", text: "一。", pauseAfter: 0.5, wav: encodeWav({ sampleRate: rate, channels: [ch] }, 16) }] })!;
    expect(v.lines[0].seconds).toBe(3);
    expect(Math.abs(v.lines[0].lufsOut - LINE_LUFS)).toBeLessThanOrEqual(0.3);
  });

  it("a shot with an unrecorded line has no owner voice (it is a draft)", () => {
    const shot: NarrationShot = { lines: [{ id: "S01_L01", text: "一。", pauseAfter: 0.5, wav: tone(1) }, { id: "S01_L02", text: "二。", pauseAfter: 0.5 }] };
    expect(hasRecording(shot)).toBe(false);
    expect(shotVoice(shot)).toBeNull();
    expect(shotText(shot, "ja")).toBe("一。二。");
    expect(shotText({ lines: [{ id: "S01_L01", text: "One.", pauseAfter: 0.5 }, { id: "S01_L02", text: "Two.", pauseAfter: 0.5 }] }, "en")).toBe("One. Two.");
  });

  it("reads line durations from the common timings.json shapes", () => {
    expect(timingsById({ S01_L01: 3.2, S01_L02: { duration: 1.5 } })).toEqual(new Map([["S01_L01", 3.2], ["S01_L02", 1.5]]));
    expect(timingsById({ lines: [{ id: "S01_L01", start: 1, end: 4.5 }] })).toEqual(new Map([["S01_L01", 3.5]]));
    expect(timingsById([{ line_id: "S02_L01", duration_sec: 2 }])).toEqual(new Map([["S02_L01", 2]]));
  });

  it("a recorded shot holds its whole line: past 12 s up to the 20 s motion limit, never cut", () => {
    const shot = { durationSec: 1.5 } as Parameters<typeof shotDuration>[0];
    expect(shotDuration(shot, { voiceDuration: 4, voiceOffset: 0.3 })).toBeCloseTo(4.7);
    expect(shotDuration(shot, { voiceDuration: 13.5, voiceOffset: 0.3 })).toBeCloseTo(14.2);
    expect(shotDuration(shot, { voiceDuration: 25, voiceOffset: 0.3 })).toBe(20);
    expect(shotDuration({ durationSec: 6 } as Parameters<typeof shotDuration>[0], { voiceDuration: 2, voiceOffset: 0.3 })).toBe(6);
  });
});

// ---------- end to end with the scripted crew ----------

let storage: string;
const created: string[] = [];
beforeAll(async () => {
  storage = await fs.mkdtemp(path.join(os.tmpdir(), "fixed-narration-test-"));
  process.env.STORAGE_ROOT = storage;
});
afterAll(async () => {
  await prisma.project.deleteMany({ where: { id: { in: created } } });
  await fs.rm(storage, { recursive: true, force: true });
});

// line 1 is long text over short audio: READING_SPEED fires, so the Editor is asked, and must not rewrite it
const LONG = "春の午後、喫茶ひだまりの窓から、やわらかな日が差しこみ、カウンターの古いラジオが静かに鳴っています。";
const SHOTS: NarrationShot[] = [
  { lines: [{ id: "S01_L01", text: LONG, pauseAfter: 0.5, wav: tone(2.0) }] },
  { lines: [{ id: "S02_L01", text: "老紳士は、手紙を読みました。", pauseAfter: 0.5, wav: tone(2.5) }, { id: "S02_L02", text: "「やっと、言えた気がします」。", pauseAfter: 0.5, wav: tone(1.5) }] },
  { lines: [{ id: "S03_L01", text: "帰り道、桜がひとひら落ちました。", pauseAfter: 0.5, wav: tone(3.0) }] },
];

describe("director loop: fixed narration (mock crew)", () => {
  it("voices every shot with the owner's recording, holds it, and never lets the Editor rewrite a line", async () => {
    const editorAsked: string[] = [];
    const base = demoHandler({ criticScores: [9] });
    const handler: MockHandler = (m, o, i) => {
      if (m[0].content.startsWith("ROLE: EDITOR")) {
        editorAsked.push(m[1].content);
        return { edits: [{ index: 1, dialogue: "短くしました。" }], notes: "shortened line 1" };
      }
      return base(m, o, i);
    };
    const p = await prisma.project.create({ data: { name: "fixed-narration-test" } });
    created.push(p.id);
    const deps = { provider: new MockLlmProvider(handler), models: MOCK_MODELS, visionAvailable: true, modelNotes: [], tavily: null, ceiling: DEFAULT_BUDGET };
    const req = { projectId: p.id, story: SHOTS.map((s) => shotText(s, "ja")).join(""), language: "ja", style: "storybook", critic: true, research: false, narrationShots: SHOTS };
    const { runId, budget } = await createRun(req, deps);
    const ctrl = registerRun(runId);
    let summary;
    try {
      summary = await executeRun(runId, req, deps, budget, () => {}, ctrl.signal);
    } finally {
      unregisterRun(runId);
    }
    expect(summary.status).toBe("done");
    expect(summary.shots).toBe(3);
    const frames = await prisma.frame.findMany({ where: { projectId: p.id }, orderBy: { index: "asc" } });
    // the lines, exactly, never rewritten (the Editor was asked and proposed a rewrite)
    expect(editorAsked.length).toBeGreaterThan(0);
    expect(frames.map((f) => f.dialogue)).toEqual(SHOTS.map((s) => shotText(s, "ja")));
    // each shot's voice is its lines + pauses, and the shot holds all of it
    expect(frames.map((f) => f.voiceDuration)).toEqual([2.5, 5, 3.5]);
    for (const f of frames) expect(f.clipDuration!).toBeGreaterThanOrEqual(f.voiceOffset + f.voiceDuration! - 1e-6);
    const steps = await prisma.directorStep.findMany({ where: { runId }, orderBy: { seq: "asc" } });
    expect(steps.some((s) => s.action === "fixed-narration" && /4 line\(s\) over 3 shot\(s\); 3 shot\(s\) carry the owner's recordings/.test(s.outputSummary ?? ""))).toBe(true);
    const voices = steps.filter((s) => s.role === "dialogue" && s.action === "voice");
    expect(voices.map((s) => s.model)).toEqual([OWNER_VOICE, OWNER_VOICE, OWNER_VOICE]);
    expect(voices[1].outputSummary).toMatch(/Owner narration S02_L01 2.5s \+ S02_L02 1.5s \(5s with pauses; levelled -?[\d.]+→-1[78](\.\d)? LUFS, -?[\d.]+→-1[78](\.\d)? LUFS\)/);
    // owner recordings clear the publication rule; no VOICE_OVERRUN
    expect(publishVerdict(spokenLines(steps.map((s) => ({ ...s, model: s.model }))), new Set()).publishable).toBe(true);
    const lint = steps.filter((s) => s.role === "editor" && s.action === "lint").at(-1);
    expect(lint?.output ?? "").not.toMatch(/VOICE_OVERRUN/);
  }, 120_000);
});

describe("pilot packages → fixed narration", () => {
  it("refuses a package without the owner's recordings unless --draft, and checks timings.json against the WAVs", async () => {
    const { loadPackage } = await import("../scripts/director/pilot");
    // the committed package now carries the owner's recordings (PR #23), so test "no recordings" on a copy without audio/
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pkg-bare-"));
    const bare = path.join(root, "PILOT01_tegami");
    await fs.cp("docs/hackathon/pilot/series.json", path.join(root, "series.json"));
    await fs.cp("docs/hackathon/pilot/PILOT01_tegami", bare, { recursive: true, filter: (src) => !src.replace(/\\/g, "/").includes("/audio") });
    expect(() => loadPackage(bare, false)).toThrow(/no recording for S01_L01/);
    const draft = loadPackage(bare, true);
    expect(draft.shots).toHaveLength(7);
    expect(draft.missing).toHaveLength(8);
    expect(draft.story).toMatch(/^SERIES ひだまり人生劇場\.\nHost: Haru-san/);
    expect(draft.story).toMatch(/\n【喫茶ひだまりの店内、春の午後。.*】春の午後、喫茶ひだまりの窓から/);
    await fs.rm(root, { recursive: true, force: true });
    // the real recordings load completely and agree with the owner's timings.json
    for (const p of ["PILOT01_tegami", "PILOT02_umeboshi", "PILOT03_tsukimi", "SHOWCASE_furin"]) {
      const real = loadPackage(`docs/hackathon/pilot/${p}`, false);
      expect(real.missing).toEqual([]);
      expect(real.mismatched).toEqual([]);
    }
    // a package with recordings: every line carries its WAV, a timings.json disagreement is reported
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pkg-"));
    await fs.cp("docs/hackathon/pilot/PILOT03_tsukimi", dir, { recursive: true });
    await fs.mkdir(`${dir}/audio`, { recursive: true });
    const ids = JSON.parse(await fs.readFile(`${dir}/production.json`, "utf8")).scenes.flatMap((s: { lines: { id: string }[] }) => s.lines.map((l) => l.id)) as string[];
    for (const id of ids) await fs.writeFile(`${dir}/audio/${id}.wav`, tone(2));
    await fs.writeFile(`${dir}/audio/timings.json`, JSON.stringify({ [ids[0]]: 2.0, [ids[1]]: 3.0 }));
    const full = loadPackage(dir, false);
    expect(full.missing).toEqual([]);
    expect(full.shots.flatMap((s) => s.lines).every((l) => "wav" in l && l.wav)).toBe(true);
    expect(full.mismatched).toEqual([`${ids[1]}: WAV 2.00 s, timings.json 3.00 s`]);
    await fs.rm(dir, { recursive: true, force: true });
  });
});
