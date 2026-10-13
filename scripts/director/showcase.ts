/**
 * Generate the showcase films with REAL Nemotron runs and publish them to
 * public/showcase/<slug>/ (film.mp4, poster.jpg, trace.json) +
 * public/showcase/index.json, with logs in docs/hackathon/evidence/.
 *
 *   npm run director:showcase -- --base https://<host> --passcode <p>   # drive a hosted app
 *   npm run director:showcase -- --base http://localhost:3000           # a local `npm run dev` with NEBIUS_API_KEY
 *   … [--only lantern] [--max-shots 8] [--max-usd 0.6] [--set v2] [--remaster 2K@24]
 *   … --refilm v2-kite=<projectId>[,…]   # re-assemble a published film from its project (no model call; D43)
 *   … --set v2 --cast-from v2-furin=<previewRunId>[,…]   # a take on an APPROVED cast-only preview's cast (owner 2026-10-12)
 *   … --set v2 --only v2-tegami --redo v2-tegami=<projectId>:<takeRunId>:5[+7] [--redo-notes notes.json]   # redraw only those shots of a take (D84, ≤ 2 redos per shot; QC notes D86)
 *
 * v2 (owner QC 2026-10-10): `--set v2` films the 11-line narrated tellings in
 * showcaseStories.ts with research on, checks the run against the publish gate
 * (publishGate.ts) and, when it passes, writes a BY-EYE candidate to
 * docs/hackathon/evidence/byeye/<slug>-<runId>/ (every frame + checklist.md).
 * Nothing is published until a person has ticked the checklist:
 *   … --set v2 --publish v2-kite=<projectId>   # publish a candidate whose checklist says PASS
 *   … --set v2 --sheet v2-kite=<projectId>:<runId>   # a finished take's sheet (+ checklist when it passes), off-plan re-judged from stored verdicts (D89), no model call
 *
 * Refuses to run against the mock crew: showcase films must be real.
 */
import "./env";
import { mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync, readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { StudioClient, type SseEvent } from "./client";
import { appendLedger, assertSpendUnder } from "./ledger";
import sharp from "sharp";
import { SHOWCASE_V2, setsBrief } from "./showcaseStories";
import { checklistProblems, checklistTemplate, criticOverride, criticProblems, durationWindow, measuredProblems, recognitionOverride, recognitionProblems, voiceProblems } from "@/lib/services/director/publishGate";
import { loadPackage } from "./pilot";
import { appendCredits, probe, readVoiceCredit } from "./credits";
import { contactSheet } from "./contactSheet";
import { tmpdir } from "node:os";
import { filmCredits, type CreditStep } from "@/lib/services/director/filmCredits";
import { heroProp } from "@/lib/services/director/plan";
import { rejudgeOffPlan, storedVerdicts } from "@/lib/services/director/fidelity";
import type { Plan } from "@/lib/services/director/schemas";

export const SHOWCASE_STORIES = [
  {
    slug: "tea-house",
    language: "en",
    style: "storybook",
    story:
      "Every morning for forty years, Grandma Hoa opened her tiny tea house by the lake in Hanoi and poured two cups: one for herself, one for her husband who used to sit by the window. Her granddaughter Lan visits on a rainy day and asks why. Grandma tells her about the first morning they met, when he spilled tea on her book of poems. Lan sits in the window seat and drinks the second cup. For the first time in years, Grandma laughs.",
  },
  {
    slug: "den-long",
    language: "vi",
    style: "papercut",
    story:
      "Đêm Trung thu, bé Tí làm một chiếc đèn ông sao bằng giấy kiếng đỏ nhưng nến cứ tắt vì gió. Các bạn trong xóm rước đèn đi qua, chỉ mình Tí đứng ở hiên nhà. Ông nội lặng lẽ mang ra chiếc chụp đèn cũ bằng tre của ông ngày bé, lắp vào che gió. Ngọn nến sáng trở lại. Tí chạy theo đoàn rước đèn dưới trăng tròn, ông đứng ở cổng mỉm cười.",
  },
  {
    slug: "kitsune",
    language: "ja",
    style: "ink",
    story:
      "雪の森に、小さな狐が住んでいました。狐は毎晩、村の灯りを遠くから見ていました。ある夜、迷子の子どもが森で泣いていました。狐は尻尾に小さな火をともし、子どもを村まで案内しました。次の朝、村の門の前に、狐のための油揚げがひとつ置いてありました。",
  },
] as const;

/**
 * v2 showcase (SPEC v2 WP4.7): the three one-click sample stories (EN/VI/JA)
 * told at film length (11 narrated lines, 45–90 s; owner QC 2026-10-10).
 * Published as `v2-<key>` with version "v2"; the v1 films stay.
 */
/**
 * The Japanese showcase is the Hidamari pilot PILOT01 tegami (owner 2026-10-12, D77; fūrin dropped): a 9:16 Short
 * made from the owner's package (fixed narration in the owner's recordings, adult figures, its settings as the brief).
 */
const PILOT_SHOWCASE: Record<string, string> = { "v2-tegami": "PILOT01_tegami" };

type V2Story = { slug: string; language: string; style: string; story: string; brief: string; narration: readonly string[]; aspect?: "9:16"; figure?: "adult"; pilot?: string };

function pilotStory(slug: string, folder: string): V2Story {
  const pkg = loadPackage(`docs/hackathon/pilot/${folder}`, true);
  const lines = pkg.production.scenes.flatMap((sc) => sc.lines.map((l) => l.text));
  return { slug, language: pkg.meta.language, style: pkg.meta.style, story: lines.join(""), brief: pkg.story, narration: lines, aspect: pkg.meta.aspectRatio === "9:16" ? "9:16" : undefined, figure: "adult", pilot: folder };
}

export const SHOWCASE_STORIES_V2: V2Story[] = [
  ...SHOWCASE_V2.filter((s) => s.slug !== "v2-furin").map((s) => ({ slug: s.slug, language: s.language, style: s.style, story: s.lines.join(s.language === "ja" ? "" : " "), brief: setsBrief(s), narration: s.lines })),
  ...Object.entries(PILOT_SHOWCASE).map(([slug, folder]) => pilotStory(slug, folder)),
];

/** The film's format: a pilot Short is 9:16 (contact sheet, credits, the 30–60 s window, D78). */
const aspectOf = (slug: string): "16:9" | "9:16" => (SHOWCASE_STORIES_V2.find((x) => x.slug === slug)?.aspect === "9:16" ? "9:16" : "16:9");

const argv = process.argv.slice(2);
const arg = (k: string, d = "") => {
  const i = argv.indexOf(k);
  return i >= 0 ? (argv[i + 1] ?? d) : d;
};

async function main() {
  const base = arg("--base", "http://localhost:3000");
  const only = arg("--only");
  const maxShots = Number(arg("--max-shots", "8"));
  const maxUsd = Number(arg("--max-usd", "0.6"));
  const set = arg("--set", "v1");
  const stories = set === "v2" ? SHOWCASE_STORIES_V2 : SHOWCASE_STORIES;
  const spent = assertSpendUnder();
  console.log(`ledger spend so far: $${spent.toFixed(4)}`);
  const client = new StudioClient({ base, passcode: arg("--passcode") || process.env.DEMO_PASSCODE });
  await client.unlock();
  const meta = await client.json<{ director: { provider: string } }>("GET", "/api/meta");
  if (meta.director.provider !== "nemotron") throw new Error(`Refusing: the server's Director provider is "${meta.director.provider}". Showcase films must come from real Nemotron runs.`);

  mkdirSync("public/showcase", { recursive: true });
  mkdirSync("docs/hackathon/evidence", { recursive: true });
  const indexPath = "public/showcase/index.json";
  const index: { films: Array<Record<string, unknown>> } = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")) : { films: [] };

  if (arg("--refilm")) {
    for (const pair of arg("--refilm").split(",")) {
      const [slug, pid] = pair.split("=");
      const entry = index.films.find((f) => f.slug === slug);
      if (!entry || !pid) throw new Error(`--refilm ${pair}: no published film "${slug}" or no project id`);
      const dir = `public/showcase/${slug}`;
      writeFileSync(`${dir}/film.mp4`, await client.download(`/api/projects/${pid}/film.mp4`));
      const published = JSON.parse(readFileSync(`${dir}/trace.json`, "utf8")) as { steps?: CreditStep[] };
      await appendCredits(`${dir}/film.mp4`, aspectOf(slug), filmCredits(published.steps ?? [], { voiceCredit: readVoiceCredit(packageDir(slug)) }));
      spawnSync("ffmpeg", ["-loglevel", "error", "-y", "-ss", "2", "-i", `${dir}/film.mp4`, "-frames:v", "1", "-q:v", "3", `${dir}/poster.jpg`]);
      const [fw, fh, rate] = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v", "-show_entries", "stream=width,height,r_frame_rate", "-of", "csv=p=0", `${dir}/film.mp4`], { encoding: "utf8" }).stdout.trim().split(",");
      const [n, d] = (rate ?? "0/1").split("/").map(Number);
      entry.remastered = `${fw}×${fh} @ ${Math.round(n / (d || 1))} fps film (shots re-rendered at 2K @ 24 fps from the same SVG, no model call; re-assembled ${new Date().toISOString().slice(0, 10)}, D43)`;
      console.log(`✔ ${slug}: ${entry.remastered}`);
    }
    writeFileSync(indexPath, JSON.stringify(index, null, 2));
    return;
  }

  // --sheet slug=projectId:runId[,…]: the contact sheet + credit frame (and checklist when it passes) of a finished take, no model call
  if (arg("--sheet")) {
    for (const pair of arg("--sheet").split(",")) {
      const [slug, ids] = pair.split("=");
      const [pid, runId] = (ids ?? "").split(":");
      const trace = rejudged(await withTakeSteps(client, pid, await client.json<Trace>("GET", `/api/projects/${pid}/director/runs/${runId}`)));
      const failed = [...measuredProblems(trace.status, trace.summary, aspectOf(slug)), ...voiceProblems((trace.steps ?? []) as Parameters<typeof voiceProblems>[0])];
      console.log(`${failed.length ? "✘" : "◐"} ${slug}: ${await writeCandidate(client, slug, pid, runId, trace, criticProblems(trace.summary), failed)}/`);
    }
    return;
  }

  if (arg("--publish")) {
    await publishChecked(client, arg("--publish"), base, index, indexPath);
    return;
  }

  for (const s of stories) {
    if (only && s.slug !== only) continue;
    assertSpendUnder();
    const log = `${tmpdir()}/showcase-${s.slug}-${Date.now()}.log`;
    writeFileSync(log, `# ${new Date().toISOString()} ${base} ${s.slug}\n`);
    // A dropped stream cancels the run server-side (no orphan runs): retry once on a fresh project
    let pid = "";
    let runId = "";
    let done: SseEvent | null = null;
    // D84: a redo redraws only the named shots of a finished take, on that take's project (one attempt: no fresh project)
    const redoSpec = arg("--redo").split(",").map((p) => p.split("=")).find(([k]) => k === s.slug)?.[1];
    const redo = redoSpec ? (([p, r, shots]) => ({ pid: p, runId: r, shots: (shots ?? "").split("+").map(Number).filter((n) => n > 0) }))(redoSpec.split(":")) : null;
    if (redo && (!redo.pid || !redo.runId || !redo.shots.length)) throw new Error(`--redo ${s.slug}=${redoSpec}: expected <projectId>:<takeRunId>:<shot>[+<shot>]`);
    // QC's by-eye notes for the redone shots (D86): --redo-notes <file.json> with {"<shot>": "<note>"}
    const redoNotes = redo && arg("--redo-notes") ? (JSON.parse(readFileSync(arg("--redo-notes"), "utf8")) as Record<string, string>) : null;
    for (let attempt = 0; attempt < (redo ? 1 : 2) && !done; attempt++) {
      let streamed = 0;
      try {
        pid = redo ? redo.pid : await client.createProject(`Showcase · ${s.slug}`);
        console.log(`▶ ${s.slug} (${s.language}) project ${pid}${attempt ? " (retry)" : ""}${redo ? ` — redo of take ${redo.runId}, shot(s) ${redo.shots.join(", ")}` : ""}`);
        const v2 = "narration" in s ? { ...narrationOf(s.slug, s.narration), research: arg("--research", "on") === "on" } : { maxShots, research: false };
        // reuse the approved preview's cast verbatim: its run id per slug (the take's log prints the symbol hashes)
        const castFromRun = arg("--cast-from").split(",").map((p) => p.split("=")).find(([k]) => k === s.slug)?.[1];
        // engine edits on that cast (D77): --edits "v2-kite=kite:starred:star:patched[,…]" (prop:state:op[:on] or prop:single)
        const castEdits = arg("--edits")
          .split(",")
          .filter(Boolean)
          .map((e) => (e.includes("=") ? e.split("=") : [s.slug, e]))
          .filter(([k]) => k === s.slug)
          .map(([, spec]) => {
            const [prop, a, b, on] = spec.split(":");
            return b ? { prop, state: a, op: b, ...(on && { on }) } : { prop, op: a };
          });
        const pilot = "pilot" in s && s.pilot ? { aspectRatio: "9:16", figure: "adult" } : {};
        // the v2 tellings send their SETS brief before the story (the published story stays the lines alone); a pilot's brief is its whole package story
        const story = "brief" in s ? ("pilot" in s && s.pilot ? s.brief : `${s.brief}\n\n${s.story}`) : s.story;
        // a v2 film is held to its format's floor + 1 s for the transitions' overlap (D79): 46 s for 16:9, 31 s for a 9:16 Short
        const floor = "narration" in s ? { minFilmSec: durationWindow(aspectOf(s.slug)).min + 1 } : {};
        const body = redo
          ? { story, language: s.language, style: s.style, maxUsd, critic: true, research: false, ...pilot, ...floor, redoRun: redo.runId, redoShots: redo.shots, ...(redoNotes && { redoNotes }) }
          : { story, language: s.language, style: s.style, maxUsd, critic: true, ...v2, ...pilot, ...floor, ...(castFromRun && { castFromRun }), ...(castEdits.length && { castEdits }) };
        runId = await client.direct(pid, body, (e) => {
          appendFileSync(log, JSON.stringify(e) + "\n");
          if (e.type === "step") {
            const st = e.step as { role: string; action: string; shotIndex: number | null; score: number | null; costUsd: number; error: string | null };
            streamed += st.costUsd;
            console.log(`  ${st.role.padEnd(10)} ${st.action.padEnd(16)} ${st.shotIndex ?? ""} ${st.score ?? ""} $${st.costUsd.toFixed(5)} ${st.error ? "⚠ " + st.error.slice(0, 80) : ""}`);
            if (/^(cast-from-run|cast-edits|recognize:carried|plan:cast-locked|pad-holds|redo)$/.test(st.action)) console.log(`    ${(e.step as { summary?: string }).summary ?? ""}`);
          }
          if (e.type === "done") done = e;
        });
      } catch (e) {
        console.log(`  stream failed: ${String(e).slice(0, 120)}`);
        appendLedger({ script: "showcase-dropped", label: s.slug, model: "crew", tokensIn: 0, tokensOut: 0, costUsd: streamed });
        appendFileSync(log, `# stream failed: ${String(e).slice(0, 300)}\n`);
      }
    }
    if (!runId) continue;
    const trace = await withTakeSteps(
      client,
      pid,
      await client.json<Record<string, unknown> & { costUsd: number; tokensIn: number; tokensOut: number; bible: { title: string; logline: string } | null; summary: Record<string, unknown>; models: Record<string, string>; provider: string; status: string }>("GET", `/api/projects/${pid}/director/runs/${runId}`),
    );
    appendLedger({ script: redo ? "showcase-redo" : "showcase", label: s.slug, model: "crew", tokensIn: trace.tokensIn, tokensOut: trace.tokensOut, costUsd: trace.costUsd });
    // a take on an approved preview's cast: every reused symbol's hash, to compare with the preview sheet's
    const reused = ((trace.steps ?? []) as Array<{ action: string; output?: string | null }>).find((st) => st.action === "cast-from-run");
    if (reused?.output) {
      const r = JSON.parse(reused.output) as { sourceRunId: string; hashes: Array<{ id: string; sha: string }> };
      const lines = [`# cast reused from preview run ${r.sourceRunId}:`, ...r.hashes.map((h) => `#   #${h.id} ${h.sha}`)];
      appendFileSync(log, `${lines.join("\n")}\n`);
      console.log(lines.map((l) => l.replace(/^# ?/, "  ")).join("\n"));
    }
    // each take keeps its own trace and log (the published films' showcase-<slug>-trace.json are fixtures, never overwritten)
    const takeDir = `docs/hackathon/evidence/takes/${s.slug}-${runId}`;
    mkdirSync(takeDir, { recursive: true });
    writeFileSync(`${takeDir}/trace.json`, JSON.stringify(trace, null, 2));
    writeFileSync(`${takeDir}/take.log`, readFileSync(log, "utf8"));
    if (!done || trace.status !== "done") {
      console.log(`✘ ${s.slug}: status ${trace.status}. Kept the trace as evidence and skipped publishing.`);
      continue;
    }
    if (set === "v2") {
      // v2: the measured gates block; critic shortfalls go to the by-eye candidate (owner + QC may approve past them); nothing is published from here
      const problems = [...measuredProblems(trace.status, trace.summary, aspectOf(s.slug)), ...voiceProblems((trace.steps ?? []) as Parameters<typeof voiceProblems>[0])];
      if (problems.length) {
        const dir = await writeCandidate(client, s.slug, pid, runId, trace, criticProblems(trace.summary), problems);
        console.log(`✘ ${s.slug}: ${problems.join("; ")}. Kept the trace as evidence and skipped publishing; contact sheet + credit frame for QC in ${dir}/`);
        continue;
      }
      const critic = criticProblems(trace.summary);
      const recognition = recognitionProblems(trace.summary);
      const dir = await writeCandidate(client, s.slug, pid, runId, trace, critic);
      console.log(`◐ ${s.slug}: passed the measured gates${critic.length ? ` (critic: ${critic.join("; ")})` : " and the critic"}${recognition.length ? ` (recognition: ${recognition.join("; ")})` : ""}. Look at every frame and fill ${dir}/checklist.md, then: --set v2 --publish ${s.slug}=${pid}`);
      continue;
    }
    await publish(client, { slug: s.slug, language: s.language, story: s.story }, pid, trace, base, set, index, indexPath);
  }
}

/**
 * A film with an owner package (docs/hackathon/pilot/SHOWCASE_<name>/, e.g. fūrin) is narrated by the owner's
 * recordings once they are all there (fixed narration, D59); until then its lines go as plain narration and the
 * film can't be published (voiceProblems: the JA demo voice is non-commercial).
 */
const packageDir = (slug: string) => (PILOT_SHOWCASE[slug] ? `docs/hackathon/pilot/${PILOT_SHOWCASE[slug]}` : `docs/hackathon/pilot/SHOWCASE_${slug.replace(/^v2-/, "")}`);

function narrationOf(slug: string, lines: readonly string[]): { narration: readonly string[] } | { narrationShots: ReturnType<typeof loadPackage>["shots"] } {
  const dir = packageDir(slug);
  if (!existsSync(`${dir}/audio`)) return { narration: lines };
  const pkg = loadPackage(dir, true);
  if (pkg.missing.length) {
    console.log(`  ${dir}: ${pkg.missing.length} line(s) not recorded yet, narrating with the demo voice (not publishable)`);
    return { narration: lines };
  }
  for (const m of pkg.mismatched) console.log(`  ⚠ ${m}`);
  console.log(`  ${dir}: the owner's recordings narrate every line`);
  return { narrationShots: pkg.shots };
}

/**
 * D84: a redo's trace holds only its own steps; the film's research, voices and every other shot come from the take it
 * redid (and that take's own take, for a second redo). The credits and the voice checks read the whole chain, take first.
 */
async function withTakeSteps<T extends { summary: Record<string, unknown>; steps?: unknown }>(client: StudioClient, pid: string, trace: T): Promise<T> {
  let steps = (trace.steps ?? []) as unknown[];
  let src = (trace.summary.redoOf as { sourceRunId?: string } | undefined)?.sourceRunId;
  for (let hop = 0; src && hop < 6; hop++) {
    const t = await client.json<{ summary: Record<string, unknown>; steps?: unknown[] }>("GET", `/api/projects/${pid}/director/runs/${src}`);
    steps = [...(t.steps ?? []), ...steps];
    src = (t.summary?.redoOf as { sourceRunId?: string } | undefined)?.sourceRunId;
  }
  return { ...trace, steps };
}

/**
 * D89 (owner + QC 2026-10-13): a finished run's off-plan shots re-judged from the critic's stored verdicts
 * under today's fidelity rules — no model call. Cleared shots leave `offPlan` and are recorded in `rejudged`.
 */
function rejudged<T extends { summary: Record<string, unknown>; steps?: unknown; bible?: unknown }>(trace: T): T {
  const off = (trace.summary.offPlan ?? []) as number[];
  const shots = (trace.bible as Plan | null)?.shots;
  if (!off.length || !shots) return trace;
  const r = rejudgeOffPlan({
    offPlan: off,
    shots,
    setTimes: new Map(Object.entries((trace.summary.castSetTimes ?? {}) as Record<string, string>)),
    approvedSet: typeof trace.summary.castFromRun === "string",
    verdicts: storedVerdicts((trace.steps ?? []) as Parameters<typeof storedVerdicts>[0]),
  });
  if (!r.cleared.length) return trace;
  for (const c of r.cleared) console.log(`  re-judged shot ${c.shot}: on-plan under D89 (${c.note})`);
  const prior = (trace.summary.rejudged ?? []) as Array<{ shot: number }>;
  return { ...trace, summary: { ...trace.summary, offPlan: r.offPlan, rejudged: [...prior.filter((p) => !r.cleared.some((c) => c.shot === p.shot)), ...r.cleared.map((c) => ({ ...c, rule: "D89" }))] } };
}

type Trace = Record<string, unknown> & { costUsd: number; tokensIn: number; tokensOut: number; bible: { title: string; logline: string } | null; summary: Record<string, unknown>; models: Record<string, string>; provider: string; status: string; id?: string };

/** The by-eye candidate: every frame (JPEG, 1280 wide) and a checklist prefilled with what the run measured. */
async function writeCandidate(client: StudioClient, slug: string, pid: string, runId: string, trace: Trace, critic: readonly string[] = [], failed: readonly string[] = []): Promise<string> {
  // a take that fails a measured gate still gets its contact sheet + credit frame for QC (owner 2026-10-12), never a checklist
  const dir = failed.length ? `docs/hackathon/evidence/takes/${slug}-${runId}` : `docs/hackathon/evidence/byeye/${slug}-${runId}`;
  mkdirSync(dir, { recursive: true });
  const project = await client.json<{ frames: Array<{ index: number; imageUrl: string | null; dialogue: string | null; shotType: string | null; description: string | null }> }>("GET", `/api/projects/${pid}`);
  const health = await client.json<{ commit: string }>("GET", "/api/health");
  const plan = trace.bible as Plan | null;
  const scores = (trace.summary.shotScores ?? {}) as Record<number, number | null>;
  const actions = (trace.summary.actionNotes ?? {}) as Record<number, string>;
  const shots = [];
  for (const f of project.frames) {
    const name = `f${String(f.index).padStart(2, "0")}.jpg`;
    if (f.imageUrl) writeFileSync(`${dir}/${name}`, await sharp(await client.download(f.imageUrl)).resize({ width: 1280 }).jpeg({ quality: 82 }).toBuffer());
    const p = plan?.shots[f.index - 1];
    shots.push({
      index: f.index,
      beat: f.dialogue ?? p?.description ?? f.description ?? "",
      image: name,
      measured: `${p?.shotType ?? f.shotType ?? "?"} · cast ${p?.cast.map((c) => `#${c}`).join(" ") ?? "?"} · critic ${scores[f.index] ?? "n/a"}/10${actions[f.index] ? ` · critic's action note: ${actions[f.index]}` : ""} · plan: ${(p?.description ?? "").slice(0, 200)}`,
    });
  }
  // what the viewer said about each drawing of the key object stays on the checklist (D77), recognised or not
  const seen = ((trace.summary.propRecognition ?? []) as Array<{ symbol: string; ok: boolean | null; saw: string }>).map((r) => `#${r.symbol}: ${r.ok === true ? "recognised" : r.ok === false ? "NOT recognised" : "not checked"} — the viewer said "${r.saw}"`);
  const recognition = recognitionProblems(trace.summary).length ? seen : [];
  if (failed.length) writeFileSync(`${dir}/problems.md`, [`# ${slug} · run ${runId} · NOT a candidate (measured gates)`, "", ...failed.map((x) => `- ${x}`), ...critic.map((x) => `- critic: ${x}`), ...seen.map((x) => `- recognition: ${x}`), ""].join("\n"));
  else writeFileSync(`${dir}/checklist.md`, checklistTemplate({ slug, projectId: pid, runId, commit: health.commit.slice(0, 7), hero: plan ? heroProp(plan) : null, shots, critic, recognition }));
  // the contact sheet: every shot on one image, for the owner's by-eye QC
  const tiles = shots.filter((sh) => existsSync(`${dir}/${sh.image}`)).map((sh) => ({ image: `${dir}/${sh.image}`, label: `${String(sh.index).padStart(2, "0")} · ${sh.measured.split(" · ")[0]} · critic ${scores[sh.index] ?? "n/a"}/10` }));
  writeFileSync(`${dir}/contact.jpg`, await contactSheet(tiles, { aspect: aspectOf(slug), title: `${slug} · ${plan?.title ?? ""} · run ${runId} · ${health.commit.slice(0, 7)}` }));
  // one frame of the credit card exactly as publishing would append it (the film itself stays on the server until publish)
  const preview = `${tmpdir()}/${slug}-${runId}-preview.mp4`;
  writeFileSync(preview, await client.download(`/api/projects/${pid}/film.mp4?v=${runId}`));
  const filmSec = probe(preview).dur;
  await appendCredits(preview, aspectOf(slug), filmCredits((trace.steps ?? []) as CreditStep[], { voiceCredit: readVoiceCredit(packageDir(slug)) }));
  const total = probe(preview).dur;
  spawnSync("ffmpeg", ["-loglevel", "error", "-y", "-ss", (total - 1.5).toFixed(2), "-i", preview, "-frames:v", "1", "-vf", "scale=1280:-2", "-q:v", "3", `${dir}/credits.jpg`]);
  rmSync(preview, { force: true });
  writeFileSync(`${dir}/candidate.json`, JSON.stringify({ slug, projectId: pid, runId, commit: health.commit, filmSec, withCreditsSec: total, summary: trace.summary }, null, 2));
  return dir;
}

async function publish(client: StudioClient, s: { slug: string; language: string; story: string }, pid: string, trace: Trace, base: string, set: string, index: { films: Array<Record<string, unknown>> }, indexPath: string, byEye?: string): Promise<void> {
  const dir = `public/showcase/${s.slug}`;
  mkdirSync(dir, { recursive: true });
  // --remaster 2K@24: the same drawings re-rendered sharper and smoother, no model call
  const rm = arg("--remaster").match(/^(1K|2K|4K)@(\d{2})$/);
  let remastered: string | null = null;
  if (rm) {
    const r = await client.remaster(pid, { resolution: rm[1] as "1K" | "2K" | "4K", fps: Number(rm[2]) });
    remastered = `${rm[1]} @ ${rm[2]} fps (${r.clips} clips, ${r.stills} stills re-rendered from the same SVG, no model call)`;
    console.log(`  remastered: ${remastered}`);
  }
  const film = await client.download(`/api/projects/${pid}/film.mp4`);
  writeFileSync(`${dir}/film.mp4`, film);
  // every published film ends with its credits, read from the trace: the owner's voice (decision A1), VAIS-1000, Nemotron on Nebius, Tavily
  await appendCredits(`${dir}/film.mp4`, aspectOf(s.slug), filmCredits((trace.steps ?? []) as CreditStep[], { voiceCredit: readVoiceCredit(packageDir(s.slug)) }));
  // the label states what the published file IS (measured), not what was asked for
  const probe = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v", "-show_entries", "stream=width,height,r_frame_rate", "-of", "csv=p=0", `${dir}/film.mp4`], { encoding: "utf8" }).stdout.trim();
  const [fw, fh, rate] = probe.split(",");
  if (rm && probe) {
    const [n, d] = (rate ?? "0/1").split("/").map(Number);
    const fps = Math.round(n / (d || 1));
    remastered = `${fw}×${fh} @ ${fps} fps film (shots re-rendered at ${rm[1]} @ ${rm[2]} fps from the same SVG, no model call)`;
    if (fps !== Number(rm[2])) console.log(`  ⚠ the film is ${fps} fps, the remaster asked for ${rm[2]}`);
  }
  spawnSync("ffmpeg", ["-loglevel", "error", "-y", "-ss", "2", "-i", `${dir}/film.mp4`, "-frames:v", "1", "-q:v", "3", `${dir}/poster.jpg`]);
  writeFileSync(`${dir}/trace.json`, JSON.stringify(trace, null, 2));
  const entry = {
    slug: s.slug,
    title: trace.bible?.title ?? s.slug,
    language: s.language,
    logline: trace.bible?.logline ?? "",
    story: s.story,
    film: `/showcase/${s.slug}/film.mp4`,
    poster: `/showcase/${s.slug}/poster.jpg`,
    aspect: aspectOf(s.slug),
    trace: `/showcase/${s.slug}/trace.json`,
    models: trace.models,
    provider: trace.provider,
    summary: trace.summary,
    createdAt: new Date().toISOString(),
    source: path.basename(base),
    version: set,
    ...(remastered && { remastered }),
    ...(byEye && { byEye }),
  };
  index.films = [...index.films.filter((f) => f.slug !== s.slug), entry];
  writeFileSync(indexPath, JSON.stringify(index, null, 2));
  console.log(`✔ ${s.slug}: ${film.length} bytes, $${trace.costUsd.toFixed(4)}`);
}

/** --publish slug=pid: publish a v2 candidate only when its by-eye checklist passes. */
async function publishChecked(client: StudioClient, pairs: string, base: string, index: { films: Array<Record<string, unknown>> }, indexPath: string): Promise<void> {
  for (const pair of pairs.split(",")) {
    const [slug, pid] = pair.split("=");
    const story = SHOWCASE_STORIES_V2.find((x) => x.slug === slug);
    if (!story || !pid) throw new Error(`--publish ${pair}: unknown slug or no project id`);
    const root = "docs/hackathon/evidence/byeye";
    const dirs = (existsSync(root) ? readdirSync(root) : []).map((d) => `${root}/${d}`).filter((d) => d.split("/").pop()!.startsWith(`${slug}-`) && existsSync(`${d}/candidate.json`) && JSON.parse(readFileSync(`${d}/candidate.json`, "utf8")).projectId === pid);
    // a redo leaves several candidates on one project: the one the owner and QC signed PASS is the film
    const passed = dirs.filter((d) => existsSync(`${d}/checklist.md`) && /^Verdict: PASS\b/m.test(readFileSync(`${d}/checklist.md`, "utf8")));
    if (passed.length > 1) throw new Error(`--publish ${pair}: more than one PASS candidate for that project (${passed.join(", ")})`);
    const dir = passed[0] ?? dirs[0];
    if (!dir) throw new Error(`--publish ${pair}: no by-eye candidate for that project in ${root}/`);
    const cand = JSON.parse(readFileSync(`${dir}/candidate.json`, "utf8")) as { runId: string };
    const trace = rejudged(await withTakeSteps(client, pid, await client.json<Trace>("GET", `/api/projects/${pid}/director/runs/${cand.runId}`)));
    const md = readFileSync(`${dir}/checklist.md`, "utf8");
    // measured gates always block; the critic's scores block unless the owner and QC approved the film by eye
    const critic = criticProblems(trace.summary);
    const problems = [
      ...measuredProblems(trace.status, trace.summary, aspectOf(slug)),
      ...voiceProblems((trace.steps ?? []) as Parameters<typeof voiceProblems>[0]),
      ...checklistProblems(md, Number(trace.summary.shots ?? 0)),
      ...(critic.length && !criticOverride(md) ? [`critic: ${critic.join("; ")} (needs "Critic override: APPROVED by owner … and QC …" in the checklist)`] : []),
      ...(recognitionProblems(trace.summary).length && !recognitionOverride(md) ? [`recognition: ${recognitionProblems(trace.summary).join("; ")} (needs "Recognition override: APPROVED by owner … and QC …" in the checklist)`] : []),
    ];
    if (problems.length) {
      console.log(`✘ ${slug}: not published. ${problems.join("; ")}`);
      continue;
    }
    await publish(client, story, pid, trace, base, "v2", index, indexPath, `${dir}/checklist.md`);
  }
}

if (process.argv[1]?.endsWith("showcase.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
