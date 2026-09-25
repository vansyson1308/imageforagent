import { prisma } from "@/lib/db";
import { AppError } from "@/lib/services/apiError";
import { renderArtwork, sanitizeSvg } from "@/lib/services/svgRenderer";
import { writeFrameArtwork, writeFrameMotion } from "@/lib/services/frameWrites";
import { motionSpecSchema } from "@/lib/validation/motionSchema";
import { MAX_SVG_BYTES } from "@/lib/config/limits";
import { callModel, recordStep, throwIfCancelled, type DirectorContext } from "@/lib/services/director/context";
import { artistSystem, artistUser } from "@/lib/services/director/prompts";
import { artPattern, buildShotMotion, type AmbientLayer } from "@/lib/services/director/camera";
import { extractJsonBlock, extractSvgFragment, isNearlyBlank, missingRefs } from "@/lib/services/director/svgTools";
import { zodIssues, type Plan, type ShotPlan } from "@/lib/services/director/schemas";
import type { Frame } from "@/generated/prisma/client";

export interface Drawing {
  readonly svg: string;
  readonly ambient: AmbientLayer | null;
  /** Still render of the painting (critic input, before/after snapshots). */
  readonly png: Buffer;
}

export interface DrawOutcome {
  readonly drawing: Drawing | null;
  /** LLM calls spent (1 = first try accepted). */
  readonly attempts: number;
  readonly lastError: string | null;
}

const errText = (e: unknown) => (e instanceof AppError ? `${e.message}${e.hint ? ` ${e.hint}` : ""}` : e instanceof Error ? e.message : String(e));

/**
 * Validate one Artist reply WITHOUT touching the database: sanitizer,
 * dangling references, ambient layer through motionSpecSchema, a real
 * render, and a blank-frame check. Throws the repair feedback on failure.
 */
export async function validateDrawing(
  text: string,
  opts: { castDefs: string; symbols: readonly string[]; aspectRatio: string; shot: ShotPlan; index: number; canvas: { w: number; h: number }; fps: number },
): Promise<Drawing> {
  const svg = extractSvgFragment(text);
  if (!svg) throw new Error("No SVG fragment found. Put the frame inside a ```svg block.");
  try {
    sanitizeSvg(svg, "frame");
  } catch (e) {
    throw new Error(errText(e));
  }
  const available = new Set([...opts.symbols, ...[...opts.castDefs.matchAll(/\bid\s*=\s*["']([^"']+)["']/g)].map((m) => m[1])]);
  const missing = missingRefs(svg, available);
  if (missing.length) {
    throw new Error(`Unknown reference(s): ${missing.map((m) => `#${m}`).join(", ")}. Available library symbols: ${opts.symbols.map((s) => `#${s}`).join(", ") || "none"}.`);
  }
  let ambient: AmbientLayer | null = null;
  if (opts.shot.mode === "motion") {
    let raw: unknown;
    try {
      raw = extractJsonBlock(text);
    } catch (e) {
      throw new Error(`The \`\`\`json ambient block is not valid JSON: ${errText(e)}`);
    }
    if (raw && typeof raw === "object") {
      const r = raw as { shapes?: unknown; tracks?: unknown };
      ambient = { shapes: Array.isArray(r.shapes) ? r.shapes.slice(0, 12) : [], tracks: Array.isArray(r.tracks) ? r.tracks.slice(0, 12) : [] } as AmbientLayer;
      const probe = motionSpecSchema.safeParse(
        buildShotMotion({ index: opts.index, shotType: opts.shot.shotType, duration: opts.shot.durationSec, fps: opts.fps, canvas: opts.canvas, background: "#000000", ambient }),
      );
      if (!probe.success) throw new Error(`Ambient layer invalid — ${zodIssues(probe.error).replace(/scene\.shapes\.(\d+)/g, (_, n: string) => `shapes[${Number(n) - 1}]`)}`);
    }
  }
  let png: Buffer;
  try {
    png = await renderArtwork(opts.castDefs, svg, opts.aspectRatio, "1K");
  } catch (e) {
    throw new Error(errText(e));
  }
  if (await isNearlyBlank(png)) throw new Error("The frame renders as one flat colour. Draw the background, the characters and the details.");
  return { svg, ambient, png };
}

/** Artist (Super): draw → validate → repair (≤ maxRepairs) using the validator's hint. */
export async function drawShot(
  ctx: DirectorContext,
  opts: {
    plan: Plan;
    shot: ShotPlan;
    index: number;
    castDefs: string;
    symbols: readonly string[];
    aspectRatio: string;
    feedback?: string | null;
    previous?: string | null;
    round: number;
  },
): Promise<DrawOutcome> {
  const system = artistSystem(ctx.canvas, ctx.options.style);
  let feedback = opts.feedback ?? null;
  let previous = opts.previous ?? null;
  let lastError: string | null = null;
  const maxAttempts = ctx.budget.budget.maxRepairs + 1;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    throwIfCancelled(ctx);
    const action = attempt === 0 ? (opts.round === 0 ? "draw" : "revise") : "repair";
    const out = await callModel(ctx, {
      role: "artist",
      action,
      system,
      user: artistUser({ plan: opts.plan, shot: opts.shot, index: opts.index, symbols: opts.symbols, feedback, previous, canvas: ctx.canvas }),
      shotIndex: opts.index,
      attempt,
      maxTokens: 12000,
      temperature: 0.5,
    });
    try {
      const drawing = await validateDrawing(out.text, {
        castDefs: opts.castDefs,
        symbols: opts.symbols,
        aspectRatio: opts.aspectRatio,
        shot: opts.shot,
        index: opts.index,
        canvas: ctx.canvas,
        fps: ctx.options.fps,
      });
      return { drawing, attempts: attempt + 1, lastError: null };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      await recordStep(ctx, { role: "artist", model: out.model, action: `${action}:invalid`, shotIndex: opts.index, attempt, summary: "Frame rejected by the engine", error: lastError });
      previous = extractSvgFragment(out.text) || out.text.slice(0, 4000);
      feedback = `${opts.feedback ? `${opts.feedback}\n` : ""}ENGINE ERROR: ${lastError}`;
    }
  }
  return { drawing: null, attempts: maxAttempts, lastError };
}

/** Shot duration: the plan's length, stretched to hold the spoken line (+ tail). */
export function shotDuration(shot: ShotPlan, frame: Pick<Frame, "voiceDuration" | "voiceOffset">): number {
  const voiceEnd = frame.voiceDuration ? frame.voiceOffset + frame.voiceDuration + 0.4 : 0;
  return Math.min(12, Math.max(shot.durationSec, voiceEnd));
}

/**
 * Persist a drawing as an animated shot: the painting goes into the project
 * defs as `art-fN` and the motion spec (camera move + ambient layer) renders
 * the clip. Fallbacks, all recorded in the trace: ambient rejected by the
 * engine → camera move only; defs over the size limit or clip failure →
 * plain still.
 */
export async function commitShot(
  ctx: DirectorContext,
  opts: { frame: Frame; shot: ShotPlan; index: number; drawing: Drawing; castDefs: string; patterns: Map<number, string>; background: string },
): Promise<{ frame: Frame; kind: "clip" | "still"; note: string | null }> {
  throwIfCancelled(ctx);
  ctx.budget.check();
  const { index, drawing } = opts;
  opts.patterns.set(index, artPattern(index, drawing.svg, ctx.canvas));
  const defs = [opts.castDefs, ...[...opts.patterns.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p)].join("\n");
  const duration = shotDuration(opts.shot, opts.frame);
  if (Buffer.byteLength(defs, "utf8") <= MAX_SVG_BYTES * 0.92) {
    await prisma.project.update({ where: { id: ctx.projectId }, data: { artworkDefs: defs } });
    const attempts: Array<AmbientLayer | null> = drawing.ambient ? [drawing.ambient, null] : [null];
    let note: string | null = null;
    for (const ambient of attempts) {
      const motion = buildShotMotion({ index, shotType: opts.shot.shotType, duration, fps: ctx.options.fps, canvas: ctx.canvas, background: opts.background, ambient });
      try {
        const r = await writeFrameMotion(opts.frame.id, motion);
        return { frame: r.frame, kind: "clip", note };
      } catch (e) {
        note = `clip ${ambient ? "with ambient layer" : ""} failed: ${errText(e)}`;
      }
    }
    opts.patterns.delete(index);
    await prisma.project.update({ where: { id: ctx.projectId }, data: { artworkDefs: [opts.castDefs, ...[...opts.patterns.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p)].join("\n") } });
    const frame = await writeFrameArtwork(opts.frame.id, drawing.svg);
    return { frame, kind: "still", note };
  }
  opts.patterns.delete(index);
  const frame = await writeFrameArtwork(opts.frame.id, drawing.svg);
  return { frame, kind: "still", note: "project library near the 512 KB limit — shot kept as a still" };
}
