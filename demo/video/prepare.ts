/**
 * Build-time assets for the demo video, all derived from narration.json:
 *   _work/cards/{title,arch,eval,end}.png   1920×1080 cards (sharp, SVG → PNG)
 *   _work/narration.wav                     voice-over placed at each segment's start
 *                                           (espeak-ng offline TTS, or demo/video/voice/<id>.wav overrides)
 *   director_demo.en.srt                    English subtitles (same timings)
 *   _work/plan.json                         scene durations for build.sh
 *   npx tsx demo/video/prepare.ts [--dry-run]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { synthesizeSpeech } from "@/lib/services/tts";
import { decodeWav, encodeWav, audioDuration, type AudioBuffer } from "@/lib/services/audio/wav";
import { mixTimeline } from "@/lib/services/audio/mix";
import { buildTimedSrt } from "@/lib/services/srtBuilder";

const DIR = "demo/video";
const WORK = `${DIR}/_work`;
const dry = process.argv.includes("--dry-run");

interface Segment {
  id: string;
  scene: string;
  start: number;
  end: number;
  text: string;
}
const narrationFile = process.argv.includes("--narration") ? process.argv[process.argv.indexOf("--narration") + 1] : "narration.json";
const narration = JSON.parse(readFileSync(`${DIR}/${narrationFile}`, "utf8")) as { voice: string; speed: number; srt?: string; segments: Segment[]; scenes?: Array<{ scene: string; duration: number }> };
const pending = narration.segments.filter((s) => s.text.includes("{{PENDING"));
if (pending.length && !dry) throw new Error(`${narrationFile}: ${pending.map((s) => s.id).join(", ")} still have {{PENDING}} text. Fill them from EVAL_RESULTS.md / PILOT.md first.`);

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const W = 1920;
const H = 1080;
const DEMO_URL = process.env.DEMO_URL ?? "https://studio-production-049c.up.railway.app";
const REPO = "github.com/vansyson1308/imageforagent";

function frame(inner: string): string {
  const stamp = dry
    ? `<rect x="0" y="${H - 64}" width="${W}" height="64" fill="#b8441b"/><text x="${W / 2}" y="${H - 22}" font-size="30" font-weight="700" fill="#fff" text-anchor="middle">DRY RUN: open slots or test inputs. NOT FOR UPLOAD</text>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="DejaVu Sans, Helvetica, Arial, sans-serif"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b5cf6"/><stop offset="1" stop-color="#ec4899"/></linearGradient></defs><rect width="${W}" height="${H}" fill="#0d0d0f"/>${inner}${stamp}</svg>`;
}

async function card(name: string, svg: string): Promise<void> {
  await sharp(Buffer.from(svg)).png().toFile(`${WORK}/cards/${name}.png`);
}

async function main() {
  mkdirSync(`${WORK}/cards`, { recursive: true });

  await card(
    "title",
    frame(
      `<rect x="160" y="300" width="96" height="96" rx="24" fill="url(#g)"/>` +
        `<text x="290" y="370" font-size="84" font-weight="700" fill="#ececf1">Storyboard Studio Director</text>` +
        `<text x="160" y="500" font-size="54" fill="#ececf1">Type a story. Get a film. No image generator.</text>` +
        `<text x="160" y="590" font-size="36" fill="#8b8b98">A crew of NVIDIA Nemotron models on Nebius Token Factory</text>` +
        `<text x="160" y="640" font-size="36" fill="#8b8b98">writes the whole film as code; the engine measures every render.</text>` +
        `<text x="160" y="760" font-size="30" fill="#76b900">Ultra · Super · Nano</text>`,
    ),
  );

  const archSvg = process.argv.includes("--arch") ? process.argv[process.argv.indexOf("--arch") + 1] : "docs/media/director-architecture.svg";
  const arch = await sharp(readFileSync(archSvg)).resize(1800).png().toBuffer();
  await sharp({ create: { width: W, height: H, channels: 4, background: "#fcfcfb" } })
    .composite([{ input: arch, top: Math.round((H - (arch.length ? (await sharp(arch).metadata()).height! : 0)) / 2), left: 60 }, ...(dry ? [{ input: Buffer.from(frame("").replace('<rect width="1920" height="1080" fill="#0d0d0f"/>', "")), top: 0, left: 0 }] : [])])
    .png()
    .toFile(`${WORK}/cards/arch.png`);

  // v2: a stats card from an owner/QC-approved data file (--eval-card), instead of the chart
  let evalReveal: { segment: string; at: string[] } | null = null;
  const evalCardPath = process.argv.includes("--eval-card") ? process.argv[process.argv.indexOf("--eval-card") + 1] : null;
  if (evalCardPath) {
    const c = JSON.parse(readFileSync(evalCardPath, "utf8")) as { title: string; headline: { value: string; label: string; sub: string; was: string; wasLabel: string }; rows: Array<[string, string]>; link: string; reveal?: { segment: string; at: string[] } };
    // stage k shows: 0 the title · 1 + the headline · 2.. + one row each · last + the link (QC 2026-10-19: revealed with the narration)
    const stages = 2 + c.rows.length;
    for (let k = 0; k < stages; k++) {
      const head =
        k >= 1
          ? `<text x="160" y="420" font-size="200" font-weight="700" fill="#ececf1">${esc(c.headline.value)}</text>` +
            `<text x="760" y="330" font-size="40" fill="#8b8b98">vs</text>` +
            `<text x="840" y="420" font-size="120" font-weight="700" fill="#8b8b98">${esc(c.headline.was)}</text>` +
            `<text x="160" y="490" font-size="36" fill="#ececf1">${esc(c.headline.label)}</text>` +
            `<text x="160" y="540" font-size="32" fill="#8b8b98">${esc(c.headline.sub)} · ${esc(c.headline.was)} = ${esc(c.headline.wasLabel)}</text>`
          : "";
      const rows = c.rows
        .slice(0, Math.max(0, k - 1))
        .map(([v, l], i) => `<text x="160" y="${660 + i * 90}" font-size="56" font-weight="700" fill="#76b900">${esc(v)}</text><text x="420" y="${660 + i * 90}" font-size="38" fill="#ececf1">${esc(l)}</text>`)
        .join("");
      const link = k === stages - 1 ? `<text x="160" y="${660 + c.rows.length * 90 + 30}" font-size="30" fill="#8b8b98">${esc(c.link)}</text>` : "";
      await card(k === stages - 1 ? "eval" : `eval-${k}`, frame(`<text x="160" y="190" font-size="38" fill="#8b8b98">${esc(c.title)}</text>` + head + rows + link));
    }
    evalReveal = c.reveal ?? null;
  }
  const chartPath = process.argv.includes("--chart") ? process.argv[process.argv.indexOf("--chart") + 1] : "docs/hackathon/eval/chart.png";
  if (evalCardPath) {
    // the stats card above is the eval card
  } else if (existsSync(chartPath)) {
    const chart = await sharp(chartPath).resize({ width: 1800 }).png().toBuffer();
    const meta = await sharp(chart).metadata();
    await sharp({ create: { width: W, height: H, channels: 4, background: "#fcfcfb" } })
      .composite([{ input: chart, top: Math.round((H - meta.height!) / 2), left: 60 }, ...(dry ? [{ input: Buffer.from(frame("").replace('<rect width="1920" height="1080" fill="#0d0d0f"/>', "")), top: 0, left: 0 }] : [])])
      .png()
      .toFile(`${WORK}/cards/eval.png`);
  } else {
    if (!dry) throw new Error(`${chartPath} is missing: run the benchmark (npm run director:bench) before building the final video.`);
    await card("eval", frame(`<text x="${W / 2}" y="${H / 2}" font-size="48" fill="#8b8b98" text-anchor="middle">[eval chart appears here after npm run director:bench]</text>`));
  }

  await card(
    "end",
    frame(
      `<text x="${W / 2}" y="380" font-size="72" font-weight="700" fill="#ececf1" text-anchor="middle">Storyboard Studio Director</text>` +
        `<text x="${W / 2}" y="480" font-size="40" fill="#ececf1" text-anchor="middle">${esc(DEMO_URL)}</text>` +
        `<text x="${W / 2}" y="550" font-size="40" fill="#8b8b98" text-anchor="middle">${esc(REPO)} · MIT license</text>` +
        `<text x="${W / 2}" y="660" font-size="32" fill="#76b900" text-anchor="middle">Built on NVIDIA Nemotron · Nebius Token Factory · Tavily</text>`,
    ),
  );

  // Voice-over: one WAV per segment (override: demo/video/voice/<id>.wav), placed at its start time
  const clips: Array<{ audio: AudioBuffer; start: number; role: "dialogue"; end: number }> = [];
  const durations = new Map<string, number>();
  const report: string[] = [];
  for (const s of narration.segments) {
    const override = `${DIR}/voice/${s.id}.wav`;
    // an open slot (dry run only) is read by espeak-ng, so a dry run needs no Piper voice installed
    const pendingSlot = s.text.includes("{{PENDING");
    const wav = existsSync(override) && !pendingSlot ? readFileSync(override) : await synthesizeSpeech(pendingSlot ? "Pending." : s.text, pendingSlot ? "en" : narration.voice, narration.speed);
    const audio = decodeWav(wav);
    const d = audioDuration(audio);
    durations.set(s.id, d);
    const room = s.end - s.start;
    report.push(`${s.id}: ${d.toFixed(1)}s of ${room}s${d > room ? "  ⚠ OVERRUNS: shorten the line or the speed" : ""}`);
    clips.push({ audio, start: s.start + 0.3, role: "dialogue", end: s.end });
  }
  const total = narration.segments[narration.segments.length - 1].end;
  const mix = mixTimeline(clips, { duration: total, targetLufs: -16, peakDb: -1 });
  writeFileSync(`${WORK}/narration.wav`, encodeWav(mix.audio, 16));
  mkdirSync(path.dirname(`${DIR}/${narration.srt ?? "director_demo.en.srt"}`), { recursive: true });
  writeFileSync(`${DIR}/${narration.srt ?? "director_demo.en.srt"}`, buildTimedSrt(narration.segments.map((s) => ({ description: s.text, startSec: s.start + 0.3, durationSec: s.end - s.start - 0.5 }))));

  const scenes: Array<{ scene: string; duration: number }> = [];
  if (narration.scenes) {
    // an explicit layout: scene cuts need not fall on narration boundaries (the voice keeps its own timing)
    scenes.push(...narration.scenes.map((x) => ({ ...x })));
    const sum = scenes.reduce((a, x) => a + x.duration, 0);
    if (Math.abs(sum - total) > 1e-6) throw new Error(`scenes add up to ${sum}s, the narration to ${total}s`);
  } else {
    for (const s of narration.segments) {
      const last = scenes[scenes.length - 1];
      if (last && last.scene === s.scene) last.duration += s.end - s.start;
      else scenes.push({ scene: s.scene, duration: s.end - s.start });
    }
  }
  // the eval card's reveal times, from the narration: each phrase's position in its line × the line's spoken length
  if (evalReveal) {
    const seg = narration.segments.find((x) => x.id === evalReveal!.segment)!;
    const spoken = durations.get(seg.id) ?? seg.end - seg.start;
    const sceneStart = scenes.slice(0, scenes.findIndex((x) => x.scene === "eval")).reduce((a, x) => a + x.duration, 0);
    const at = evalReveal.at.map((phrase) => {
      const i = seg.text.indexOf(phrase);
      if (i < 0) throw new Error(`eval reveal: "${phrase}" is not in ${seg.id}`);
      return Math.round((seg.start + 0.3 + (spoken * i) / seg.text.length - sceneStart) * 100) / 100;
    });
    writeFileSync(`${WORK}/eval-stages.json`, JSON.stringify({ starts: [0, ...at] }, null, 2));
  }
  writeFileSync(`${WORK}/plan.json`, JSON.stringify({ total, scenes }, null, 2));
  console.log(report.join("\n"));
  console.log(`scenes: ${scenes.map((s) => `${s.scene} ${s.duration}s`).join(" · ")} = ${total}s`);
  if (report.some((r) => r.includes("OVERRUNS"))) process.exitCode = 2;
}

main().catch((e) => {
  console.error(path.basename(__filename), e);
  process.exit(1);
});
