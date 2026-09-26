import { LlmError } from "@/lib/providers/types";
import { saveBuffer } from "@/lib/services/storage";
import { callJson, recordStep, ReplyInvalidError, type DirectorContext } from "@/lib/services/director/context";
import { criticSystem, criticUser } from "@/lib/services/director/prompts";
import { critiqueSchema, type Critique, type ShotPlan } from "@/lib/services/director/schemas";
import { compositionStats, toJpegDataUri } from "@/lib/services/director/svgTools";
import { snapshotPath } from "@/lib/services/director/cast";
import type { Drawing } from "@/lib/services/director/artist";

export interface CritiqueOutcome {
  readonly critique: Critique | null;
  readonly mode: "vision" | "text";
  /** Storage path of the exact image the critic judged (before/after in the UI). */
  readonly imagePath: string;
}

/**
 * Critic: scores the rendered painting against the shot description. With a
 * vision model configured it sends the image; Token Factory serves no
 * image-input Nemotron today (DECISIONS D15), so by default it is the TEXT
 * critic: Nano over the SVG, render stats and the engine's measured checks.
 * If a vision model rejects image input, the run switches to TEXT and records
 * that switch as a step. It never switches silently.
 * A critic failure never blocks the film: the outcome is `critique: null`.
 */
export async function critiqueShot(ctx: DirectorContext, opts: { shot: ShotPlan; index: number; drawing: Drawing; round: number }): Promise<CritiqueOutcome> {
  const { uri, jpeg } = await toJpegDataUri(opts.drawing.png);
  const imagePath = snapshotPath(ctx.projectId, ctx.runId, `f${String(opts.index).padStart(2, "0")}-r${opts.round}.jpg`);
  await saveBuffer(imagePath, jpeg);
  const base = { role: "critic" as const, action: opts.round === 0 ? "critique" : "re-critique", shotIndex: opts.index, attempt: opts.round, maxTokens: 1200, temperature: 0.2, thinking: false, imagePath };
  if (ctx.visionAvailable) {
    try {
      const critique = await callJson(ctx, { ...base, system: criticSystem("vision"), user: criticUser({ shot: opts.shot, index: opts.index }), images: [uri] }, critiqueSchema, "critique", 1);
      await noteScore(ctx, opts.index, critique, "vision", imagePath);
      return { critique, mode: "vision", imagePath };
    } catch (e) {
      if (e instanceof LlmError && e.kind === "bad_request") {
        ctx.visionAvailable = false;
        await recordStep(ctx, {
          role: "system",
          model: ctx.models.vision,
          action: "critic:fallback",
          shotIndex: opts.index,
          summary: "Vision model rejected image input — switching the critic to TEXT mode for the rest of the run",
          error: e.message,
        });
      } else if (e instanceof ReplyInvalidError || e instanceof LlmError) {
        return { critique: null, mode: "vision", imagePath };
      } else {
        throw e;
      }
    }
  }
  try {
    const stats = `svg ${Math.round(Buffer.byteLength(opts.drawing.svg) / 1024)} KB, ${(opts.drawing.svg.match(/<(path|rect|circle|ellipse|polygon)\b/g) ?? []).length} shapes${opts.drawing.ambient ? `, ambient ${opts.drawing.ambient.shapes.length} shapes/${opts.drawing.ambient.tracks.length} tracks` : ""}. ${await compositionStats(opts.drawing.svg, opts.drawing.png, ctx.canvas)}.${checksText(opts.drawing)}`;
    const critique = await callJson(
      ctx,
      { ...base, model: ctx.models.fast, system: criticSystem("text"), user: criticUser({ shot: opts.shot, index: opts.index, svgExcerpt: opts.drawing.svg.slice(0, 6000), stats }) },
      critiqueSchema,
      "critique",
      1,
    );
    await noteScore(ctx, opts.index, critique, "text", imagePath);
    return { critique, mode: "text", imagePath };
  } catch (e) {
    if (e instanceof ReplyInvalidError || e instanceof LlmError) return { critique: null, mode: "text", imagePath };
    throw e;
  }
}

/** The engine's measured gate results, stated as authoritative facts for the text critic. */
function checksText(d: Drawing): string {
  if (!d.checks) return "";
  const ok = d.checks.facts.length ? ` PASSED: ${d.checks.facts.join("; ")}.` : "";
  const bad = d.checks.problems.length ? ` FAILED: ${d.checks.problems.join("; ")}.` : "";
  return `\nENGINE CHECKS (measured on the render, authoritative):${ok}${bad}`;
}

async function noteScore(ctx: DirectorContext, index: number, c: Critique, mode: string, imagePath: string): Promise<void> {
  await recordStep(ctx, {
    role: "critic",
    model: mode === "vision" ? ctx.models.vision : ctx.models.fast,
    action: "score",
    shotIndex: index,
    score: c.score,
    summary: `${mode} critic ${c.score}/10 · ${c.verdict}${c.issues[0] ? ` · ${c.issues[0]}` : ""}`,
    output: JSON.stringify(c),
    imagePath,
  });
}

/** The revision instruction handed back to the Artist. */
export function fixesText(c: Critique): string {
  return [`Critic score ${c.score}/10.`, ...c.issues.map((i) => `Issue: ${i}`), ...c.fixes.map((f) => `Fix: ${f}`)].join("\n");
}
