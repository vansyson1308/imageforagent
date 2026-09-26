/**
 * Generate the showcase films with REAL Nemotron runs and publish them to
 * public/showcase/<slug>/ (film.mp4, poster.jpg, trace.json) +
 * public/showcase/index.json, with logs in docs/hackathon/evidence/.
 *
 *   npm run director:showcase -- --base https://<host> --passcode <p>   # drive a hosted app
 *   npm run director:showcase -- --base http://localhost:3000           # a local `npm run dev` with NEBIUS_API_KEY
 *   … [--only lantern] [--max-shots 8] [--max-usd 0.6]
 *
 * Refuses to run against the mock crew: showcase films must be real.
 */
import "./env";
import { mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { StudioClient, type SseEvent } from "./client";
import { appendLedger, assertSpendUnder } from "./ledger";

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

  for (const s of SHOWCASE_STORIES) {
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
        runId = await client.direct(pid, { story: s.story, language: s.language, style: s.style, maxShots, maxUsd, critic: true, research: false }, (e) => {
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
    const dir = `public/showcase/${s.slug}`;
    mkdirSync(dir, { recursive: true });
    const film = await client.download(`/api/projects/${pid}/film.mp4`);
    writeFileSync(`${dir}/film.mp4`, film);
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
    };
    index.films = [...index.films.filter((f) => f.slug !== s.slug), entry];
    writeFileSync(indexPath, JSON.stringify(index, null, 2));
    console.log(`✔ ${s.slug}: ${film.length} bytes, $${trace.costUsd.toFixed(4)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
