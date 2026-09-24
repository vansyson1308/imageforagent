import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { decodeWav, encodeWav, resample, type AudioBuffer } from "@/lib/services/audio/wav";
import { measureLoudness } from "@/lib/services/audio/loudness";
import { duckGainCurve, mixTimeline } from "@/lib/services/audio/mix";
import { audioLipCurves, sampleLip, textLipCurves } from "@/lib/services/audio/lipsync";

const sine = (freq: number, amp: number, seconds: number, rate = 48000, channels = 1): AudioBuffer => {
  const n = Math.round(seconds * rate);
  const ch = new Float32Array(n);
  for (let i = 0; i < n; i++) ch[i] = amp * Math.sin((2 * Math.PI * freq * i) / rate);
  return { sampleRate: rate, channels: Array.from({ length: channels }, () => Float32Array.from(ch)) };
};

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe("wav codec", () => {
  it("roundtrip 24-bit stereo giữ mẫu (sai số ≤ 1 LSB)", () => {
    const a = sine(440, 0.5, 0.1, 44100, 2);
    const b = decodeWav(encodeWav(a, 24));
    expect(b.sampleRate).toBe(44100);
    expect(b.channels).toHaveLength(2);
    for (let i = 0; i < 100; i++) expect(Math.abs(b.channels[1][i] - a.channels[1][i])).toBeLessThan(2 / 8388608);
  });
  it("đọc WAV do espeak/ffmpeg ghi (data size 0/streaming) không vỡ", () => {
    const buf = encodeWav(sine(200, 0.3, 0.05), 16);
    buf.writeUInt32LE(0, 40); // giả lập header streaming
    expect(decodeWav(buf).channels[0].length).toBe(2400);
  });
  it("resample 22050 → 48000 giữ biên độ + tần số", () => {
    const up = resample(sine(1000, 0.5, 0.5, 22050), 48000);
    expect(up.channels[0].length).toBe(24000);
    let peak = 0;
    let zc = 0;
    for (let i = 2000; i < 22000; i++) {
      peak = Math.max(peak, Math.abs(up.channels[0][i]));
      if ((up.channels[0][i] >= 0) !== (up.channels[0][i - 1] >= 0)) zc++;
    }
    expect(peak).toBeCloseTo(0.5, 2);
    expect(zc / 2 / (20000 / 48000)).toBeCloseTo(1000, -1);
  });
});

describe("loudness BS.1770-4", () => {
  it("sine 997 Hz 0 dBFS mono = −3.01 LUFS (giá trị tham chiếu của chuẩn)", () => {
    const l = measureLoudness(sine(997, 1, 10));
    expect(l.integrated).toBeCloseTo(-3.01, 1);
    expect(l.samplePeak).toBeCloseTo(0, 2);
  });
  it("−20 dBFS stereo = −20 LUFS (hai kênh +3 dB so với mono)", () => {
    expect(measureLoudness(sine(997, 0.1, 10, 48000, 2)).integrated).toBeCloseTo(-20, 1);
  });
  it("im lặng → −∞ (dưới gate tuyệt đối)", () => {
    expect(measureLoudness({ sampleRate: 48000, channels: [new Float32Array(48000 * 2)] }).integrated).toBe(-Infinity);
  });
  it.skipIf(!hasFfmpeg)("khớp ffmpeg ebur128 trên cùng file (±0.1 LU)", () => {
    // Tín hiệu có bậc thang + nhiều tần số để gate tương đối làm việc
    const rate = 48000;
    const n = rate * 12;
    const ch = [new Float32Array(n), new Float32Array(n)];
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      const amp = t < 4 ? 0.3 : t < 8 ? 0.05 : 0.6;
      ch[0][i] = amp * Math.sin(2 * Math.PI * 220 * t) + 0.1 * Math.sin(2 * Math.PI * 3100 * t);
      ch[1][i] = amp * Math.sin(2 * Math.PI * 330 * t);
    }
    const a: AudioBuffer = { sampleRate: rate, channels: ch };
    const dir = mkdtempSync(path.join(tmpdir(), "lufs-"));
    const file = path.join(dir, "x.wav");
    writeFileSync(file, encodeWav(a, 24));
    // ebur128 in kết quả ra stderr — gom qua spawnSync
    const log = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128", "-f", "null", "-"], { encoding: "utf8" }).stderr;
    const ref = Number(/I:\s+(-?[\d.]+) LUFS/.exec(log.slice(log.lastIndexOf("Summary")))![1]);
    expect(measureLoudness(a).integrated).toBeCloseTo(ref, 1);
  });
});

describe("mixer", () => {
  it("ducking: nhạc giảm khi có thoại; loudness về đúng target", () => {
    const music = sine(220, 0.3, 6, 48000, 2);
    const voice = sine(600, 0.5, 2, 22050, 1);
    const r = mixTimeline(
      [
        { audio: music, start: 0, role: "music" },
        { audio: voice, start: 2, role: "dialogue" },
      ],
      { duration: 6, targetLufs: -16, duckDb: 12, peakDb: 0 },
    );
    expect(r.after.integrated).toBeCloseTo(-16, 0);
    const rms = (a: number, b: number) => {
      let e = 0;
      for (let i = Math.round(a * 48000); i < Math.round(b * 48000); i++) e += r.audio.channels[0][i] ** 2;
      return Math.sqrt(e / ((b - a) * 48000));
    };
    // Nhạc không thoại (0–1 s) và sau khi hồi (5.5–6 s) cùng mức
    expect(rms(5.5, 6) / rms(0, 1)).toBeGreaterThan(0.97);
  });
  it("duckGainCurve: xuống sàn khi có thoại, hồi phục < 1.5 s sau khi dứt", () => {
    const rate = 48000;
    const d = new Float32Array(rate * 4);
    for (let i = rate; i < rate * 2; i++) d[i] = 0.3 * Math.sin(i / 7);
    const g = duckGainCurve([d], rate, 12);
    expect(g[Math.round(rate * 0.5)]).toBeCloseTo(1, 3);
    expect(g[Math.round(rate * 1.5)]).toBeCloseTo(10 ** (-12 / 20), 2);
    expect(g[Math.round(rate * 3.4)]).toBeGreaterThan(0.95);
  });
  it("peak cap: không bao giờ vượt trần", () => {
    const r = mixTimeline([{ audio: sine(100, 0.9, 2, 48000, 2), start: 0, role: "dialogue" }], { duration: 2, targetLufs: -5, peakDb: -1 });
    expect(r.after.samplePeak).toBeLessThanOrEqual(-0.99);
  });
  it("limiter: nội dung crest cao vẫn ĐẠT loudness đích, đỉnh không vượt trần", () => {
    // Hợp âm 3 sine + xung trống ngắn — crest factor cao
    const rate = 48000;
    const n = rate * 8;
    const ch = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      ch[i] = 0.15 * (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 277 * t) + Math.sin(2 * Math.PI * 330 * t));
      if (i % rate < 400) ch[i] += 0.9 * Math.sin((2 * Math.PI * 60 * i) / rate);
    }
    const r = mixTimeline([{ audio: { sampleRate: rate, channels: [ch, Float32Array.from(ch)] }, start: 0, role: "dialogue" }], {
      duration: 8,
      targetLufs: -12,
      peakDb: -1,
    });
    expect(r.limited).toBe(true);
    expect(r.after.samplePeak).toBeLessThanOrEqual(-0.999);
    expect(Math.abs(r.after.integrated - -12)).toBeLessThan(0.25);
  });

  it("im lặng tuyệt đối không bị chuẩn hoá thành NaN", () => {
    const r = mixTimeline([], { duration: 1, targetLufs: -16 });
    expect(r.gainDb).toBe(0);
    expect(Number.isNaN(r.audio.channels[0][10])).toBe(false);
  });
});

describe("lipsync", () => {
  it("âm thanh: miệng MỞ khi có tiếng, KHÉP khi im", () => {
    const rate = 22050;
    const ch = new Float32Array(rate * 2);
    for (let i = rate / 2; i < rate; i++) ch[i] = 0.5 * Math.sin((2 * Math.PI * 300 * i) / rate);
    const c = audioLipCurves({ sampleRate: rate, channels: [ch] }, 12);
    expect(sampleLip(c, 0.2).open).toBeLessThan(0.05);
    expect(sampleLip(c, 0.8).open).toBeGreaterThan(0.6);
    expect(sampleLip(c, 1.8).open).toBeLessThan(0.05);
  });
  it("văn bản tiếng Việt: một nhịp mỗi âm tiết, 'i' bẹt, 'u' tròn", () => {
    const c = textLipCurves("đi thu", 1, 24);
    expect(sampleLip(c, 0.25).open).toBeGreaterThan(0.6);
    expect(sampleLip(c, 0.25).wide).toBeGreaterThan(0.7);
    expect(sampleLip(c, 0.75).wide).toBeLessThan(0.2);
    expect(sampleLip(c, 0.5).open).toBeLessThan(0.2); // giữa hai âm tiết
  });
});
