/**
 * Rebuild a recorded run's frames EXACTLY from its trace, with no model call:
 * the Cast's recorded replies are fed back through the same deterministic
 * library assembly (`runCast` with a replay provider), and each shot's
 * accepted SVG (the artist output right before its last render step) is
 * rendered by the engine. Used to calibrate the v2 frame gates on the real v1
 * failures and to write regression fixtures.
 *
 *   npx tsx scripts/director/replay-frames.ts public/showcase/tea-house/trace.json out/replay/tea-house [--fixtures tests/fixtures/v1-tea-house]
 */
import "./env";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db";
import { MockLlmProvider } from "@/lib/providers/mockLlmProvider";
import { BudgetTracker, DEFAULT_BUDGET } from "@/lib/services/director/budget";
import { runCast } from "@/lib/services/director/cast";
import type { DirectorContext } from "@/lib/services/director/context";
import { planSchema } from "@/lib/services/director/schemas";
import { extractSvgFragment } from "@/lib/services/director/svgTools";
import { LOGICAL_CANVAS, renderArtwork } from "@/lib/services/svgRenderer";

interface Step {
  seq: number;
  role: string;
  action: string;
  shotIndex: number | null;
  output: string | null;
}

async function main() {
  const [tracePath, outDir] = process.argv.slice(2);
  const fx = process.argv.includes("--fixtures") ? process.argv[process.argv.indexOf("--fixtures") + 1] : null;
  if (!tracePath || !outDir) throw new Error("usage: replay-frames.ts <trace.json> <outDir> [--fixtures <dir>]");
  const trace = JSON.parse(readFileSync(tracePath, "utf8")) as { style: string; language: string; bible: unknown; steps: Step[] };
  const steps = [...trace.steps].sort((a, b) => a.seq - b.seq);
  const plan = planSchema.parse(trace.bible);
  const castReplies = steps.filter((s) => s.role === "cast" && (s.action === "defs" || s.action === "defs:repair") && s.output).map((s) => s.output!);
  const project = await prisma.project.create({ data: { name: "replay (temp)" } });
  try {
    const run = await prisma.directorRun.create({ data: { projectId: project.id, story: "replay", models: "{}", config: "{}" } });
    const ctx: DirectorContext = {
      runId: run.id,
      projectId: project.id,
      provider: new MockLlmProvider(castReplies, "replay"),
      models: { strong: "replay", mid: "replay", fast: "replay", vision: "" },
      visionAvailable: false,
      budget: new BudgetTracker(DEFAULT_BUDGET),
      options: { language: trace.language, style: trace.style, critic: false, research: false, fps: 12, minShots: 1, acceptScore: 7 },
      canvas: LOGICAL_CANVAS["16:9"],
      signal: new AbortController().signal,
      emit: () => {},
      seq: 0,
    };
    const library = await runCast(ctx, plan, "16:9");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, "defs.svg"), library.defs);
    if (fx) {
      mkdirSync(fx, { recursive: true });
      writeFileSync(path.join(fx, "defs.svg"), library.defs);
    }
    // accepted drawing per shot = the last artist output before that shot's LAST render step
    const lastRender = new Map<number, number>();
    for (const s of steps) if (s.shotIndex && s.role === "system" && s.action.startsWith("render-")) lastRender.set(s.shotIndex, s.seq);
    for (const [shot, renderSeq] of [...lastRender.entries()].sort((a, b) => a[0] - b[0])) {
      const art = steps.filter((s) => s.shotIndex === shot && s.role === "artist" && s.output && s.seq < renderSeq).at(-1);
      if (!art) continue;
      const svg = extractSvgFragment(art.output!);
      const name = `f${String(shot).padStart(2, "0")}`;
      const png = await renderArtwork(library.defs, svg, "16:9", "1K");
      writeFileSync(path.join(outDir, `${name}.svg`), svg);
      writeFileSync(path.join(outDir, `${name}.png`), png);
      if (fx) writeFileSync(path.join(fx, `${name}.svg`), svg);
      console.log(`shot ${shot}: ${svg.length} chars → ${name}.png`);
    }
  } finally {
    await prisma.project.delete({ where: { id: project.id } }).catch(() => {});
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
