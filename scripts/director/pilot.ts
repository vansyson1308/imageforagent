/**
 * Hidamari pilot (SPEC v2 WP5.2; owner decisions 2026-10-10): animated
 * companion Shorts for the owner's daily channel 「ひだまり人生劇場」, made in
 * series mode on a running Studio (normally the hosted demo, with
 * DEMO_PASSCODE from the environment, never printed).
 *
 *   DEMO_PASSCODE=… npx tsx scripts/director/pilot.ts [--base …] [--episodes 1,2,3] [--series <id>] [--media <dir>] [--draft]
 *
 * - Each episode is an owner package in docs/hackathon/pilot/PILOT0N_<slug>/
 *   (scripts/director/owner-packages.ts): production.json (one scene per
 *   shot), director.json (settings, aspect ratio, the 60 s limit) and the
 *   owner's recordings audio/<line id>.wav + audio/timings.json.
 * - The narration is FIXED before the run (`narrationShots`, D59): each shot
 *   holds its lines' real WAVs + pause_after; neither Ultra nor the Editor
 *   rewrites a line. Without the recordings the script refuses, unless
 *   --draft (the demo TTS speaks the lines; a draft is never publishable).
 * - Episode 1 creates the series from its run; later episodes reuse it
 *   (Haru-san and the kissaten copied pixel-identically; D35).
 * - Publishable only when every line is the owner's recording, the film has
 *   one shot per scene, no VOICE_OVERRUN and fits the format (≤ 60 s).
 * - Writes docs/hackathon/evidence/pilot-ep<N>.json (real numbers only); the
 *   films go to --media (not committed: the episodes belong to the owner).
 */
import "./env";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { StudioClient, type SseEvent } from "./client";
import { appendLedger, assertSpendUnder } from "./ledger";
import { publishVerdict, spokenLines } from "@/lib/services/director/pilotPolicy";
import { productionSchema } from "@/lib/services/director/ownerPackage";
import { timingsById } from "@/lib/services/director/fixedNarration";
import { audioDuration, decodeWav } from "@/lib/services/audio/wav";
import { symbolHash } from "@/lib/services/director/series";
import { symbolIds } from "@/lib/services/director/svgTools";

const argv = process.argv.slice(2);
const arg = (k: string, d = "") => {
  const i = argv.indexOf(k);
  return i >= 0 ? (argv[i + 1] ?? d) : d;
};

const SERIES_NAME = "ひだまり人生劇場";
const ROOT = "docs/hackathon/pilot";

interface DirectorMeta {
  readonly slug: string;
  readonly title: string;
  readonly language: string;
  readonly style: string;
  readonly aspectRatio: string;
  readonly maxSeconds: number | null;
  readonly shots: ReadonlyArray<{ scene: string; setting: string | null; lines: string[] }>;
}

/** An owner package, with its recordings when they are there. */
export function loadPackage(dir: string, draft: boolean) {
  const production = productionSchema.parse(JSON.parse(readFileSync(`${dir}/production.json`, "utf8")));
  const meta = JSON.parse(readFileSync(`${dir}/director.json`, "utf8")) as DirectorMeta;
  const timings = existsSync(`${dir}/audio/timings.json`) ? timingsById(JSON.parse(readFileSync(`${dir}/audio/timings.json`, "utf8"))) : new Map<string, number>();
  const missing: string[] = [];
  const mismatched: string[] = [];
  const shots = production.scenes.map((scene) => ({
    lines: scene.lines.map((l) => {
      const f = `${dir}/audio/${l.id}.wav`;
      if (!existsSync(f)) {
        missing.push(l.id);
        return { id: l.id, text: l.text, pauseAfter: l.pause_after };
      }
      const wav = readFileSync(f);
      const measured = audioDuration(decodeWav(wav));
      const reported = timings.get(l.id);
      if (reported !== undefined && Math.abs(reported - measured) > 0.15) mismatched.push(`${l.id}: WAV ${measured.toFixed(2)} s, timings.json ${reported.toFixed(2)} s`);
      return { id: l.id, text: l.text, pauseAfter: l.pause_after, wav: wav.toString("base64") };
    }),
  }));
  if (missing.length && !draft) throw new Error(`${dir}: no recording for ${missing.join(", ")}. The owner's pipeline writes audio/<line id>.wav; use --draft for a demo-TTS draft (never publishable).`);
  // what Ultra stages: the series brief (host, kissaten, palette), then each shot's setting and its fixed lines
  const series = existsSync(`${path.dirname(dir)}/series.json`) ? (JSON.parse(readFileSync(`${path.dirname(dir)}/series.json`, "utf8")) as Record<string, string>) : null;
  const brief = series ? [`SERIES ${series.name}.`, `Host: ${series.host}`, `Set: ${series.set}`, `Palette: ${series.palette}.`, `Rules: ${series.rules}.`].join("\n") + "\n\n" : "";
  const story = brief + production.scenes.map((s, i) => `【${meta.shots[i]?.setting ?? s.id}】${s.lines.map((l) => l.text).join("")}`).join("\n");
  return { production, meta, shots, story, missing, mismatched };
}

async function main() {
  const base = arg("--base", "https://studio-production-049c.up.railway.app");
  const draft = argv.includes("--draft");
  const folders = existsSync(ROOT) ? readdirSync(ROOT).filter((d) => /^PILOT\d{2}_/.test(d)).sort() : [];
  const wanted = arg("--episodes") ? arg("--episodes").split(",").map(Number) : folders.map((_, i) => i + 1);
  const media = arg("--media");
  let seriesId = arg("--series") || null;
  const client = new StudioClient({ base, passcode: process.env.DEMO_PASSCODE });
  await client.unlock();

  for (const n of wanted) {
    const folder = folders.find((d) => d.startsWith(`PILOT${String(n).padStart(2, "0")}_`));
    if (!folder) throw new Error(`no package for episode ${n} in ${ROOT}/`);
    if (n > 1 && !seriesId) throw new Error("episode 2+ needs the series: run episode 1 first, or pass --series <id>");
    const pkg = loadPackage(path.join(ROOT, folder), draft);
    for (const m of pkg.mismatched) console.log(`⚠ ${folder} ${m}`);
    assertSpendUnder();
    const pid = await client.createProject(`Hidamari ${folder}`);
    const t0 = Date.now();
    let summary: Record<string, unknown> | null = null;
    const runId = await client.direct(
      pid,
      { story: pkg.story, language: pkg.meta.language, style: pkg.meta.style, aspectRatio: pkg.meta.aspectRatio, figure: "adult", narrationShots: pkg.shots, critic: true, research: false, ...(seriesId && { seriesId }) },
      (e: SseEvent) => {
        if (e.type === "done") summary = e.summary as Record<string, unknown> | null;
      },
    );
    const wallSec = Math.round((Date.now() - t0) / 1000);
    if (!summary) throw new Error(`${folder}: run ${runId} ended without a summary`);
    const trace = await client.json<{ costUsd: number; steps: Array<{ role: string; action: string; shotIndex: number | null; model: string; output?: string | null; error?: string | null }> }>("GET", `/api/projects/${pid}/director/runs/${runId}`);
    appendLedger({ script: "pilot", label: `${folder}:${runId}`, model: "crew", tokensIn: Number((summary as { tokens?: number }).tokens ?? 0), tokensOut: 0, costUsd: trace.costUsd });
    if (n === 1 && !seriesId) {
      const saved = await client.json<{ id: string; members: string[] }>("POST", "/api/series", { runId, name: SERIES_NAME });
      seriesId = saved.id;
      console.log(`series ${SERIES_NAME} (${saved.id}): recurring ${saved.members.join(", ")}`);
    }
    const project = await client.json<{ artworkDefs: string; frames: Array<{ id: string; index: number }> }>("GET", `/api/projects/${pid}`);
    const sum = summary as Record<string, unknown>;
    const lint = trace.steps.filter((s) => s.role === "editor" && s.action === "lint").at(-1)?.output ?? "";
    const blockers = [
      ...publishVerdict(spokenLines(trace.steps), new Set()).blocking.map((l) => `shot ${l.shot} spoken by ${l.voice} (non-commercial)`),
      ...(draft && pkg.missing.length ? [`draft: ${pkg.missing.length} line(s) without the owner's recording`] : []),
      ...(project.frames.length !== pkg.production.scenes.length ? [`${project.frames.length} shots for ${pkg.production.scenes.length} scenes`] : []),
      ...(/VOICE_OVERRUN/.test(lint) ? ["VOICE_OVERRUN in the final lint"] : []),
      ...(pkg.meta.maxSeconds && Number(sum.durationSec ?? 0) > pkg.meta.maxSeconds ? [`${Number(sum.durationSec).toFixed(1)} s, over the ${pkg.meta.maxSeconds} s format`] : []),
    ];
    // every base symbol (not posed variants): the recurring members' hashes must match across episodes
    const hashes = Object.fromEntries(symbolIds(project.artworkDefs).filter((id) => !id.includes("--")).map((id) => [id, symbolHash(project.artworkDefs, id)]));
    const evidence = {
      at: new Date().toISOString(),
      base,
      episode: n,
      package: folder,
      runId,
      projectId: pid,
      seriesId,
      wallSec,
      usd: trace.costUsd,
      shots: `${sum.rendered}/${sum.shots}`,
      filmSec: sum.durationSec,
      gateFailures: sum.gateFailures ?? 0,
      seriesSymbolSha256: hashes,
      ownerRecordedLines: pkg.production.scenes.flatMap((s) => s.lines.map((l) => l.id)).filter((id) => !pkg.missing.includes(id)),
      timingsMismatches: pkg.mismatched,
      publishable: blockers.length === 0,
      blockers,
      ownerEdits: null,
      note: "ownerEdits and the owner's own words are filled in by the owner, never by the agent",
    };
    mkdirSync("docs/hackathon/evidence", { recursive: true });
    writeFileSync(`docs/hackathon/evidence/pilot-ep${n}.json`, JSON.stringify(evidence, null, 2) + "\n");
    if (media) {
      mkdirSync(media, { recursive: true });
      writeFileSync(path.join(media, `hidamari-${folder}${evidence.publishable ? "" : ".DRAFT-not-for-publication"}.mp4`), await client.download(`/api/projects/${pid}/film.mp4?v=${runId}`));
    }
    console.log(`${folder}: ${evidence.shots} shots · ${Number(sum.durationSec ?? 0).toFixed(1)} s · ${wallSec}s wall · $${trace.costUsd.toFixed(4)} · series ${seriesId} · ${evidence.publishable ? "publishable" : `DRAFT (${blockers.join("; ")})`}`);
  }
}

if (process.argv[1]?.endsWith("pilot.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
