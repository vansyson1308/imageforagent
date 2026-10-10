/**
 * Generate the showcase films with REAL Nemotron runs and publish them to
 * public/showcase/<slug>/ (film.mp4, poster.jpg, trace.json) +
 * public/showcase/index.json, with logs in docs/hackathon/evidence/.
 *
 *   npm run director:showcase -- --base https://<host> --passcode <p>   # drive a hosted app
 *   npm run director:showcase -- --base http://localhost:3000           # a local `npm run dev` with NEBIUS_API_KEY
 *   … [--only lantern] [--max-shots 8] [--max-usd 0.6] [--set v2] [--remaster 2K@24]
 *   … --refilm v2-kite=<projectId>[,…]   # re-assemble a published film from its project (no model call; D43)
 *
 * v2 (owner QC 2026-10-10): `--set v2` films the 11-line narrated tellings in
 * showcaseStories.ts with research on, checks the run against the publish gate
 * (publishGate.ts) and, when it passes, writes a BY-EYE candidate to
 * docs/hackathon/evidence/byeye/<slug>-<runId>/ (every frame + checklist.md).
 * Nothing is published until a person has ticked the checklist:
 *   … --set v2 --publish v2-kite=<projectId>   # publish a candidate whose checklist says PASS
 *
 * Refuses to run against the mock crew: showcase films must be real.
 */
import "./env";
import { mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { StudioClient, type SseEvent } from "./client";
import { appendLedger, assertSpendUnder } from "./ledger";
import sharp from "sharp";
import { SHOWCASE_V2 } from "./showcaseStories";
import { checklistProblems, checklistTemplate, publishProblems, voiceProblems } from "@/lib/services/director/publishGate";
import { loadPackage } from "./pilot";
import { heroProp } from "@/lib/services/director/plan";
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
export const SHOWCASE_STORIES_V2 = SHOWCASE_V2.map((s) => ({ slug: s.slug, language: s.language, style: s.style, story: s.lines.join(s.language === "ja" ? "" : " "), narration: s.lines }));

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
      spawnSync("ffmpeg", ["-loglevel", "error", "-y", "-ss", "2", "-i", `${dir}/film.mp4`, "-frames:v", "1", "-q:v", "3", `${dir}/poster.jpg`]);
      const [fw, fh, rate] = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v", "-show_entries", "stream=width,height,r_frame_rate", "-of", "csv=p=0", `${dir}/film.mp4`], { encoding: "utf8" }).stdout.trim().split(",");
      const [n, d] = (rate ?? "0/1").split("/").map(Number);
      entry.remastered = `${fw}×${fh} @ ${Math.round(n / (d || 1))} fps film (shots re-rendered at 2K @ 24 fps from the same SVG, no model call; re-assembled ${new Date().toISOString().slice(0, 10)}, D43)`;
      console.log(`✔ ${slug}: ${entry.remastered}`);
    }
    writeFileSync(indexPath, JSON.stringify(index, null, 2));
    return;
  }

  if (arg("--publish")) {
    await publishChecked(client, arg("--publish"), base, index, indexPath);
    return;
  }

  for (const s of stories) {
    if (only && s.slug !== only) continue;
    assertSpendUnder();
    const log = `docs/hackathon/evidence/showcase-${s.slug}.log`;
    writeFileSync(log, `# ${new Date().toISOString()} ${base} ${s.slug}\n`);
    // A dropped stream cancels the run server-side (no orphan runs): retry once on a fresh project
    let pid = "";
    let runId = "";
    let done: SseEvent | null = null;
    for (let attempt = 0; attempt < 2 && !done; attempt++) {
      let streamed = 0;
      try {
        pid = await client.createProject(`Showcase · ${s.slug}`);
        console.log(`▶ ${s.slug} (${s.language}) project ${pid}${attempt ? " (retry)" : ""}`);
        const v2 = "narration" in s ? { ...narrationOf(s.slug, s.narration), research: arg("--research", "on") === "on" } : { maxShots, research: false };
        runId = await client.direct(pid, { story: s.story, language: s.language, style: s.style, maxUsd, critic: true, ...v2 }, (e) => {
          appendFileSync(log, JSON.stringify(e) + "\n");
          if (e.type === "step") {
            const st = e.step as { role: string; action: string; shotIndex: number | null; score: number | null; costUsd: number; error: string | null };
            streamed += st.costUsd;
            console.log(`  ${st.role.padEnd(10)} ${st.action.padEnd(16)} ${st.shotIndex ?? ""} ${st.score ?? ""} $${st.costUsd.toFixed(5)} ${st.error ? "⚠ " + st.error.slice(0, 80) : ""}`);
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
    const trace = await client.json<Record<string, unknown> & { costUsd: number; tokensIn: number; tokensOut: number; bible: { title: string; logline: string } | null; summary: Record<string, unknown>; models: Record<string, string>; provider: string; status: string }>(
      "GET",
      `/api/projects/${pid}/director/runs/${runId}`,
    );
    appendLedger({ script: "showcase", label: s.slug, model: "crew", tokensIn: trace.tokensIn, tokensOut: trace.tokensOut, costUsd: trace.costUsd });
    writeFileSync(`docs/hackathon/evidence/showcase-${s.slug}-trace.json`, JSON.stringify(trace, null, 2));
    if (!done || trace.status !== "done") {
      console.log(`✘ ${s.slug}: status ${trace.status}. Kept the trace as evidence and skipped publishing.`);
      continue;
    }
    if (set === "v2") {
      // v2: the automatic publish gate, then a by-eye candidate; nothing is published from here
      const problems = [...publishProblems(trace.status, trace.summary), ...voiceProblems((trace.steps ?? []) as Parameters<typeof voiceProblems>[0])];
      if (problems.length) {
        console.log(`✘ ${s.slug}: ${problems.join("; ")}. Kept the trace as evidence and skipped publishing.`);
        continue;
      }
      const dir = await writeCandidate(client, s.slug, pid, runId, trace);
      console.log(`◐ ${s.slug}: passed the automatic gate. Look at every frame and fill ${dir}/checklist.md, then: --set v2 --publish ${s.slug}=${pid}`);
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
function narrationOf(slug: string, lines: readonly string[]): { narration: readonly string[] } | { narrationShots: ReturnType<typeof loadPackage>["shots"] } {
  const dir = `docs/hackathon/pilot/SHOWCASE_${slug.replace(/^v2-/, "")}`;
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

type Trace = Record<string, unknown> & { costUsd: number; tokensIn: number; tokensOut: number; bible: { title: string; logline: string } | null; summary: Record<string, unknown>; models: Record<string, string>; provider: string; status: string; id?: string };

/** The by-eye candidate: every frame (JPEG, 1280 wide) and a checklist prefilled with what the run measured. */
async function writeCandidate(client: StudioClient, slug: string, pid: string, runId: string, trace: Trace): Promise<string> {
  const dir = `docs/hackathon/evidence/byeye/${slug}-${runId}`;
  mkdirSync(dir, { recursive: true });
  const project = await client.json<{ frames: Array<{ index: number; imageUrl: string | null; dialogue: string | null; shotType: string | null; description: string | null }> }>("GET", `/api/projects/${pid}`);
  const health = await client.json<{ commit: string }>("GET", "/api/health");
  const plan = trace.bible as Plan | null;
  const scores = (trace.summary.shotScores ?? {}) as Record<number, number | null>;
  const shots = [];
  for (const f of project.frames) {
    const name = `f${String(f.index).padStart(2, "0")}.jpg`;
    if (f.imageUrl) writeFileSync(`${dir}/${name}`, await sharp(await client.download(f.imageUrl)).resize({ width: 1280 }).jpeg({ quality: 82 }).toBuffer());
    const p = plan?.shots[f.index - 1];
    shots.push({
      index: f.index,
      beat: f.dialogue ?? p?.description ?? f.description ?? "",
      image: name,
      measured: `${p?.shotType ?? f.shotType ?? "?"} · cast ${p?.cast.map((c) => `#${c}`).join(" ") ?? "?"} · critic ${scores[f.index] ?? "n/a"}/10 · plan: ${(p?.description ?? "").slice(0, 200)}`,
    });
  }
  writeFileSync(`${dir}/checklist.md`, checklistTemplate({ slug, projectId: pid, runId, commit: health.commit.slice(0, 7), hero: plan ? heroProp(plan) : null, shots }));
  writeFileSync(`${dir}/candidate.json`, JSON.stringify({ slug, projectId: pid, runId, commit: health.commit, summary: trace.summary }, null, 2));
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
    const dir = (existsSync(root) ? readdirSync(root) : []).map((d) => `${root}/${d}`).find((d) => d.split("/").pop()!.startsWith(`${slug}-`) && existsSync(`${d}/candidate.json`) && JSON.parse(readFileSync(`${d}/candidate.json`, "utf8")).projectId === pid);
    if (!dir) throw new Error(`--publish ${pair}: no by-eye candidate for that project in ${root}/`);
    const cand = JSON.parse(readFileSync(`${dir}/candidate.json`, "utf8")) as { runId: string };
    const trace = await client.json<Trace>("GET", `/api/projects/${pid}/director/runs/${cand.runId}`);
    const problems = [...publishProblems(trace.status, trace.summary), ...voiceProblems((trace.steps ?? []) as Parameters<typeof voiceProblems>[0]), ...checklistProblems(readFileSync(`${dir}/checklist.md`, "utf8"), Number(trace.summary.shots ?? 0))];
    if (problems.length) {
      console.log(`✘ ${slug}: not published. ${problems.join("; ")}`);
      continue;
    }
    await publish(client, story, pid, trace, base, "v2", index, indexPath, `${dir}/checklist.md`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
