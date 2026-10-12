/**
 * Cast-only preview of the showcase films (owner 2026-10-12): the Director plans, the Cast draws
 * the library, the hero-prop recognition gate runs, and the run stops — no shot is drawn. One
 * sheet per film shows every state of the key object and every set, each rendered ALONE, for the
 * owner's by-eye approval before any full take is spent.
 *
 *   DEMO_PASSCODE=… npm run director:preview -- --base https://<host> [--only v2-kite] [--out <dir>]
 *   … --pilot PILOT01_tegami   # a Hidamari owner package instead (9:16, fixed narration, adult figures)
 *   … --resheet v2-kite=<projectId>:<runId>   # rebuild a sheet from a finished preview (no model call)
 *   … --cast-from v2-kite=<runId> --edits "v2-kite=kite:torn:tear,kite:patched:patch"
 *       # a preview on an approved preview's cast with engine edits (D77: tear/patch a state on the approved
 *       # base; "<prop>:single" keeps one look); the edited preview is the one a full take reuses
 *
 * The operator passcode comes from the environment only (never a CLI argument: process lists,
 * shell history). Output: docs/hackathon/evidence/preview-<date>/<slug>-sheet.jpg (+ -trace.json,
 * -hashes.json, .log). Each tile is labelled with a short sha256 of its symbol: a full take run with
 * `--cast-from <slug>=<runId>` prints the same hashes when it reuses this cast.
 */
import "./env";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { StudioClient } from "./client";
import { appendLedger, assertSpendUnder } from "./ledger";
import { contactSheet, type SheetTile } from "./contactSheet";
import { SHOWCASE_V2, setsBrief } from "./showcaseStories";
import { loadPackage } from "./pilot";
import { renderArtwork } from "@/lib/services/svgRenderer";
import { heroSymbols, renderAlone } from "@/lib/services/director/recognize";
import { normalizeStates } from "@/lib/services/director/plan";
import { castHashes } from "@/lib/services/director/series";
import { timedSetId } from "@/lib/services/director/fidelity";
import type { Plan } from "@/lib/services/director/schemas";

const argv = process.argv.slice(2);
const arg = (k: string, d = "") => {
  const i = argv.indexOf(k);
  return i >= 0 ? (argv[i + 1] ?? d) : d;
};

type Recognition = { symbol: string; state: string | null; ok: boolean | null; saw: string; redraws: number };
type Trace = { id: string; status: string; costUsd: number; tokensIn: number; tokensOut: number; bible: Plan | null; summary: { propRecognition?: Recognition[] } };

async function main() {
  const base = arg("--base", "http://localhost:3000");
  const only = arg("--only");
  const day = new Date().toISOString().slice(0, 10);
  // --out <dir>: a later round the same day must not overwrite an earlier round's evidence
  const out = arg("--out") || `docs/hackathon/evidence/preview-${day}`;
  mkdirSync(out, { recursive: true });
  console.log(`ledger spend so far: $${assertSpendUnder().toFixed(4)}`);
  if (argv.includes("--passcode")) throw new Error("Pass the operator passcode in DEMO_PASSCODE, not on the command line.");
  const client = new StudioClient({ base, passcode: process.env.DEMO_PASSCODE });
  await client.unlock();
  // --resheet <slug>=<projectId>:<runId>[,…]: rebuild sheets from finished preview runs (no model call)
  const resheet = new Map(arg("--resheet").split(",").filter(Boolean).map((p) => p.split("=") as [string, string]));
  // the films to preview: the showcase stories, or one Hidamari owner package (--pilot PILOT01_tegami)
  const pilot = arg("--pilot");
  const films: Array<{ slug: string; aspect: "16:9" | "9:16"; request: Record<string, unknown> }> = pilot
    ? [(() => {
        const pkg = loadPackage(`docs/hackathon/pilot/${pilot}`, false);
        const aspect = pkg.meta.aspectRatio === "9:16" ? "9:16" : "16:9";
        return { slug: pilot, aspect, request: { story: pkg.story, language: pkg.meta.language, style: pkg.meta.style, aspectRatio: aspect, figure: "adult", narrationShots: pkg.shots, critic: true, research: false } };
      })()]
    : SHOWCASE_V2.map((s) => ({ slug: s.slug, aspect: "16:9" as const, request: { story: `${setsBrief(s)}\n\n${s.lines.join(s.language === "ja" ? "" : " ")}`, language: s.language, style: s.style, critic: true, research: true, narration: s.lines } }));
  // --cast-from slug=runId[,…] and --edits slug=prop:state:op|prop:single[,…] (D77)
  const castFrom = new Map(arg("--cast-from").split(",").filter(Boolean).map((p) => p.split("=") as [string, string]));
  const edits = new Map<string, Array<{ prop: string; state?: string; op: string }>>();
  for (const e of arg("--edits").split(",").filter(Boolean)) {
    const [slug, spec] = e.includes("=") ? e.split("=") : [only, e];
    const [prop, a, b] = spec.split(":");
    edits.set(slug, [...(edits.get(slug) ?? []), b ? { prop, state: a, op: b } : { prop, op: a }]);
  }
  for (const s of films) {
    if (only && s.slug !== only) continue;
    if (castFrom.has(s.slug)) s.request = { ...s.request, castFromRun: castFrom.get(s.slug), ...(edits.get(s.slug) && { castEdits: edits.get(s.slug) }) };
    if (resheet.size && !resheet.has(s.slug)) continue;
    const canvas = s.aspect === "9:16" ? { w: 1080, h: 1920 } : { w: 1920, h: 1080 };
    assertSpendUnder();
    const log = `${out}/${s.slug}.log`;
    const again = resheet.get(s.slug)?.split(":");
    if (!again) writeFileSync(log, `# ${new Date().toISOString()} ${base} ${s.slug} (cast-only preview)\n`);
    const pid = again?.[0] ?? (await client.createProject(`Preview · ${s.slug}`));
    console.log(`▶ ${s.slug} project ${pid}${again ? " (re-sheet, no model call)" : ""}`);
    // the same story, brief and narration lines the full take sends, so the plan is planned the same way
    const runId = again?.[1] ?? await client.direct(pid, { ...s.request, maxUsd: 0.3, stopAfter: "cast" }, (e) => {
      appendFileSync(log, JSON.stringify(e) + "\n");
      if (e.type === "step") {
        const st = e.step as { role: string; action: string; costUsd: number; summary?: string; error: string | null };
        if (/recognize|prop-states|library|stop-after|anatomy|cast-edits|cast-from-run/.test(st.action)) console.log(`  ${st.role.padEnd(8)} ${st.action.padEnd(20)} ${(st.summary ?? "").slice(0, 110)}${st.error ? ` ⚠ ${st.error.slice(0, 80)}` : ""}`);
      }
    });
    const trace = await client.json<Trace>("GET", `/api/projects/${pid}/director/runs/${runId}`);
    if (!again) appendLedger({ script: "preview", label: s.slug, model: "crew", tokensIn: trace.tokensIn, tokensOut: trace.tokensOut, costUsd: trace.costUsd });
    writeFileSync(`${out}/${s.slug}-trace.json`, JSON.stringify(trace, null, 2));
    if (trace.status !== "done" || !trace.bible) {
      console.log(`✘ ${s.slug}: status ${trace.status}`);
      continue;
    }
    const plan = normalizeStates(trace.bible);
    const project = await client.json<{ artworkDefs: string }>("GET", `/api/projects/${pid}`);
    const defs = project.artworkDefs;
    const rec = new Map((trace.summary.propRecognition ?? []).map((r) => [r.symbol, r]));
    const hashes = castHashes(plan.cast, defs);
    const sha = new Map(hashes.map((h) => [h.id, h.sha]));
    writeFileSync(`${out}/${s.slug}-hashes.json`, JSON.stringify({ runId, projectId: pid, hashes }, null, 2));
    const tiles: SheetTile[] = [];
    // every state of the key object, alone (what the viewer saw), with the viewer's name for it
    for (const t of heroSymbols(plan)) {
      const r = rec.get(t.symbol);
      const verdict = r ? (r.ok === true ? "recognised" : r.ok === false ? "NOT recognised" : "not checked") : "not checked";
      const png = await renderAlone(defs, t.symbol, s.aspect, canvas);
      tiles.push({ image: await sharp(png).resize(1080, 1080).png().toBuffer(), label: `${verdict === "recognised" ? "OK" : verdict === "NOT recognised" ? "NOT OK" : "unchecked"} #${t.symbol} ${sha.get(t.symbol) ?? ""} "${r?.saw ?? ""}"` });
    }
    // every set, each time of day it is lit for
    for (const c of plan.cast.filter((m) => m.kind === "set")) {
      for (const id of [c.id, timedSetId(c.id, "day"), timedSetId(c.id, "night")]) {
        if (!new RegExp(`id="${id}"`).test(defs)) continue;
        const png = await renderArtwork(defs, `<use href="#${id}" x="0" y="0" width="${canvas.w}" height="${canvas.h}"/>`, s.aspect, "1K");
        tiles.push({ image: png, label: `#${id} ${sha.get(id) ?? ""}` });
      }
    }
    writeFileSync(`${out}/${s.slug}-sheet.jpg`, await contactSheet(tiles, { aspect: s.aspect, title: `${s.slug} · ${plan.title} · cast-only preview · run ${runId}` }));
    console.log(`✔ ${s.slug}: run ${runId}, ${tiles.length} tiles, $${trace.costUsd.toFixed(4)} → ${out}/${s.slug}-sheet.jpg`);
    for (const h of hashes) console.log(`  #${h.id} ${h.sha}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
