import { LlmError } from "@/lib/providers/types";
import { saveBuffer } from "@/lib/services/storage";
import { callJson, recordStep, ReplyInvalidError, type DirectorContext } from "@/lib/services/director/context";
import { criticSystem, criticUser, lookSystem, lookUser } from "@/lib/services/director/prompts";
import { critiqueSchema, lookSchema, type Critique, type Look, type ShotPlan } from "@/lib/services/director/schemas";
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
 * Critic (D33): when a vision model is available it LOOKS at the render first
 * (with the engine's measured checks) and reports what is visible; then
 * Nemotron Nano SCORES the frame from those observations + the measurements +
 * the SVG. Nemotron keeps the critic role; the vision model adds eyes. Token
 * Factory serves no NVIDIA vision model today (D15), so the eyes are an open
 * VLM, labelled in the trace and UI. Without one, Nano scores in text mode.
 * If the vision model rejects image input, the run switches to text mode and
 * records that switch. A critic failure never blocks the film (critique: null).
 */
export async function critiqueShot(ctx: DirectorContext, opts: { shot: ShotPlan; index: number; drawing: Drawing; round: number }): Promise<CritiqueOutcome> {
  const { uri, jpeg } = await toJpegDataUri(opts.drawing.png);
  const imagePath = snapshotPath(ctx.projectId, ctx.runId, `f${String(opts.index).padStart(2, "0")}-r${opts.round}.jpg`);
  await saveBuffer(imagePath, jpeg);
  const base = { role: "critic" as const, shotIndex: opts.index, attempt: opts.round, temperature: 0.2, thinking: false, imagePath };
  const checks = checksText(opts.drawing);
  let look: Look | null = null;
  if (ctx.visionAvailable && ctx.models.vision) {
    try {
      look = await callJson(ctx, { ...base, action: "look", model: ctx.models.vision, maxTokens: 700, system: lookSystem(), user: lookUser({ shot: opts.shot, index: opts.index, checks }), images: [uri] }, lookSchema, "frame_look", 1);
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
      } else if (!(e instanceof ReplyInvalidError || e instanceof LlmError)) {
        throw e;
      }
    }
  }
  const mode: "vision" | "text" = look ? "vision" : "text";
  try {
    const stats = `svg ${Math.round(Buffer.byteLength(opts.drawing.svg) / 1024)} KB, ${(opts.drawing.svg.match(/<(path|rect|circle|ellipse|polygon)\b/g) ?? []).length} shapes${opts.drawing.ambient ? `, ambient ${opts.drawing.ambient.shapes.length} shapes/${opts.drawing.ambient.tracks.length} tracks` : ""}. ${await compositionStats(opts.drawing.svg, opts.drawing.png, ctx.canvas)}.${checks}`;
    const lookText = look ? [`Sees: ${look.sees.join("; ") || "—"}.`, `Visible problems: ${look.problems.join("; ") || "none"}.`, `Matches the shot: ${look.matchesShot ? "yes" : "NO"}.`].join("\n") : undefined;
    const critique = await callJson(
      ctx,
      { ...base, action: opts.round === 0 ? "critique" : "re-critique", model: ctx.models.fast, maxTokens: 1200, system: criticSystem("text"), user: criticUser({ shot: opts.shot, index: opts.index, svgExcerpt: opts.drawing.svg.slice(0, 6000), stats, look: lookText }) },
      critiqueSchema,
      "critique",
      1,
    );
    await noteScore(ctx, opts.index, critique, mode, imagePath);
    return { critique, mode, imagePath };
  } catch (e) {
    if (e instanceof ReplyInvalidError || e instanceof LlmError) return { critique: null, mode, imagePath };
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
    model: ctx.models.fast,
    action: "score",
    shotIndex: index,
    score: c.score,
    summary: `${mode} critic ${c.score}/10 · ${c.verdict}${mode === "vision" ? ` (${ctx.models.vision} looked, ${ctx.models.fast} scored)` : ""}${c.issues[0] ? ` · ${c.issues[0]}` : ""}`,
    output: JSON.stringify(c),
    imagePath,
  });
}

/** The revision instruction handed back to the Artist. */
export function fixesText(c: Critique): string {
  return [`Critic score ${c.score}/10.`, ...c.issues.map((i) => `Issue: ${i}`), ...c.fixes.map((f) => `Fix: ${f}`)].join("\n");
}
