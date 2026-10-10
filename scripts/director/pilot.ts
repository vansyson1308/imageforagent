/**
 * Hidamari pilot (SPEC v2 WP5.2): episodes of the owner's channel
 * 「ひだまり人生劇場」 made in series mode on a running Studio (normally the
 * hosted demo, with DEMO_PASSCODE from the environment, never printed).
 *
 *   DEMO_PASSCODE=… npx tsx scripts/director/pilot.ts [--base …] [--episodes 1,2,3] [--series <id>] [--owner-wavs <dir>] [--media <dir>]
 *
 * - Reads ONLY docs/hackathon/eval/pilot-prompts.json (the owner's final OK
 *   turns the proposals into that file; BLOCKERS O4). Refuses without it.
 * - Episode 1 creates the series from its run; later episodes reuse it
 *   (the host and tea room are copied, pixel-identical; D35).
 * - --owner-wavs <dir>: the owner's recordings `ep<N>-F<NN>.wav` replace those
 *   lines (the per-line WAV path).
 * - An episode is marked publishable only when no line is left in a
 *   non-commercial voice (pilotPolicy.ts). Drafts are fine for review.
 * - Writes docs/hackathon/evidence/pilot-ep<N>.json (real numbers only:
 *   wall, USD, shots, the series symbol hashes, publishability); the films go
 *   to --media (not committed: the episodes belong to the owner).
 */
import "./env";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { StudioClient, type SseEvent } from "./client";
import { appendLedger, assertSpendUnder } from "./ledger";
import { publishVerdict, spokenLines } from "@/lib/services/director/pilotPolicy";
import { symbolHash } from "@/lib/services/director/series";
import { symbolIds } from "@/lib/services/director/svgTools";

const argv = process.argv.slice(2);
const arg = (k: string, d = "") => {
  const i = argv.indexOf(k);
  return i >= 0 ? (argv[i + 1] ?? d) : d;
};

interface Story {
  readonly id: string;
  readonly language: string;
  readonly shots: number;
  readonly style?: string;
  readonly story: string;
}

const SERIES_NAME = "ひだまり人生劇場";

async function main() {
  const base = arg("--base", "https://studio-production-049c.up.railway.app");
  const file = "docs/hackathon/eval/pilot-prompts.json";
  if (!existsSync(file)) throw new Error(`${file} is missing: the owner's final OK on the stories creates it (BLOCKERS O4). Proposals: docs/hackathon/eval/pilot-prompts.proposed.json`);
  const stories = JSON.parse(readFileSync(file, "utf8")) as Story[];
  const wanted = arg("--episodes") ? arg("--episodes").split(",").map(Number) : stories.map((_, i) => i + 1);
  const wavDir = arg("--owner-wavs");
  const media = arg("--media");
  let seriesId = arg("--series") || null;
  const client = new StudioClient({ base, passcode: process.env.DEMO_PASSCODE });
  await client.unlock();

  for (const n of wanted) {
    const s = stories[n - 1];
    if (!s) throw new Error(`no story for episode ${n}`);
    if (n > 1 && !seriesId) throw new Error("episode 2+ needs the series: run episode 1 first, or pass --series <id>");
    assertSpendUnder();
    const pid = await client.createProject(`Hidamari ep${n}`);
    const t0 = Date.now();
    let summary: Record<string, unknown> | null = null;
    const runId = await client.direct(pid, { story: s.story, language: s.language, style: s.style ?? "storybook", maxShots: s.shots, critic: true, research: false, ...(seriesId && { seriesId }) }, (e: SseEvent) => {
      if (e.type === "done") summary = e.summary as Record<string, unknown> | null;
    });
    const wallSec = Math.round((Date.now() - t0) / 1000);
    if (!summary) throw new Error(`episode ${n}: run ${runId} ended without a summary`);
    const trace = await client.json<{ costUsd: number; steps: Array<{ role: string; action: string; shotIndex: number | null; model: string; error?: string | null }> }>("GET", `/api/projects/${pid}/director/runs/${runId}`);
    appendLedger({ script: "pilot", label: `ep${n}:${runId}`, model: "crew", tokensIn: Number((summary as { tokens?: number }).tokens ?? 0), tokensOut: 0, costUsd: trace.costUsd });
    if (n === 1 && !seriesId) {
      const saved = await client.json<{ id: string; members: string[] }>("POST", "/api/series", { runId, name: SERIES_NAME });
      seriesId = saved.id;
      console.log(`series ${SERIES_NAME} (${saved.id}): recurring ${saved.members.join(", ")}`);
    }
    // the owner's recordings replace the matching lines
    const project = await client.json<{ artworkDefs: string; frames: Array<{ id: string; index: number; dialogue: string | null; voiceOffset?: number }> }>("GET", `/api/projects/${pid}`);
    const recorded = new Set<number>();
    if (wavDir) {
      for (const f of project.frames) {
        const wav = path.join(wavDir, `ep${n}-F${String(f.index).padStart(2, "0")}.wav`);
        if (!f.dialogue || !existsSync(wav)) continue;
        await client.json("PUT", `/api/frames/${f.id}/dialogue`, { text: f.dialogue, wav: readFileSync(wav).toString("base64"), offset: f.voiceOffset ?? 0.3 });
        recorded.add(f.index);
      }
    }
    const verdict = publishVerdict(spokenLines(trace.steps), recorded);
    // every base symbol (not posed variants): the recurring members' hashes must match across episodes
    const hashes = Object.fromEntries(symbolIds(project.artworkDefs).filter((id) => !id.includes("--")).map((id) => [id, symbolHash(project.artworkDefs, id)]));
    const sum = summary as Record<string, unknown>;
    const evidence = {
      at: new Date().toISOString(),
      base,
      episode: n,
      story: s.id,
      runId,
      projectId: pid,
      seriesId,
      wallSec,
      usd: trace.costUsd,
      shots: `${sum.rendered}/${sum.shots}`,
      filmSec: sum.durationSec,
      gateFailures: sum.gateFailures ?? 0,
      seriesSymbolSha256: hashes,
      ownerRecordedLines: [...recorded],
      publishable: verdict.publishable,
      blockingLines: verdict.blocking,
      ownerEdits: null,
      note: "ownerEdits and the owner's own words are filled in by the owner, never by the agent",
    };
    mkdirSync("docs/hackathon/evidence", { recursive: true });
    writeFileSync(`docs/hackathon/evidence/pilot-ep${n}.json`, JSON.stringify(evidence, null, 2) + "\n");
    if (media) {
      mkdirSync(media, { recursive: true });
      writeFileSync(path.join(media, `hidamari-ep${n}${verdict.publishable ? "" : ".DRAFT-not-for-publication"}.mp4`), await client.download(`/api/projects/${pid}/film.mp4?v=${runId}`));
    }
    console.log(`ep${n}: ${evidence.shots} shots · ${wallSec}s · $${trace.costUsd.toFixed(4)} · series ${seriesId} · ${verdict.publishable ? "publishable" : `DRAFT (${verdict.blocking.length} line(s) in a non-commercial voice)`}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
