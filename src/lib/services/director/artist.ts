import { prisma } from "@/lib/db";
import { AppError } from "@/lib/services/apiError";
import { renderArtwork, sanitizeSvg } from "@/lib/services/svgRenderer";
import { writeFrameArtwork, writeFrameMotion } from "@/lib/services/frameWrites";
import { motionSpecSchema } from "@/lib/validation/motionSchema";
import { MAX_SVG_BYTES } from "@/lib/config/limits";
import { callModel, recordStep, throwIfCancelled, type DirectorContext } from "@/lib/services/director/context";
import { artistSystem, artistUser } from "@/lib/services/director/prompts";
import { artPattern, buildShotMotion, type AmbientLayer } from "@/lib/services/director/camera";
import { extractJsonBlock, extractSvgFragment, isNearlyBlank, meanBrightness, minSubjectPct, missingRefs, NIGHT_WORDS, visibleHeightPct, withoutUses } from "@/lib/services/director/svgTools";
import { zodIssues, type Plan, type ShotPlan } from "@/lib/services/director/schemas";
import type { Frame } from "@/generated/prisma/client";

export interface Drawing {
  readonly svg: string;
  readonly ambient: AmbientLayer | null;
  /** Still render of the painting (critic input, before/after snapshots). */
  readonly png: Buffer;
  /** Measured framing/lighting facts (the text critic's ground truth); `problems` is empty when every gate passed. */
  readonly checks?: { readonly problems: readonly string[]; readonly facts: readonly string[] };
}

export interface DrawOutcome {
  readonly drawing: Drawing | null;
  /** LLM calls spent (1 = first try accepted). */
  readonly attempts: number;
  readonly lastError: string | null;
}

/**
 * Mechanical clean-up (like stripping fences): motion tracks only take #rgb /
 * #rrggbb, but models love "#ffffff80" to fade. Drop the alpha pair; every
 * other value goes to motionSpecSchema untouched.
 */
/**
 * Deterministic normalisation of the two track mistakes real runs showed:
 * #rrggbbaa colours (tracks take 6-digit hex) and a track-level `ease`
 * (ease belongs to each key: it is copied onto keys that lack one).
 */
function normalizeTrack(track: unknown): unknown {
  if (!track || typeof track !== "object" || !Array.isArray((track as { keys?: unknown }).keys)) return track;
  const { ease, ...t } = track as { keys: Array<Record<string, unknown>>; ease?: unknown };
  const keys = t.keys.map((k, i) => {
    let key = typeof k?.v === "string" && /^#[0-9a-fA-F]{8}$/.test(k.v) ? { ...k, v: k.v.slice(0, 7) } : k;
    if (typeof ease === "string" && i > 0 && key && typeof key === "object" && key.ease === undefined) key = { ...key, ease };
    return key;
  });
  return { ...t, keys };
}

const errText = (e: unknown) => (e instanceof AppError ? `${e.message}${e.hint ? ` ${e.hint}` : ""}` : e instanceof Error ? e.message : String(e));

/**
 * Validate one Artist reply WITHOUT touching the database: sanitizer,
 * dangling references, ambient layer through motionSpecSchema, a real
 * render, and a blank-frame check. Throws the repair feedback on failure.
 */
export async function validateDrawing(
  text: string,
  opts: {
    castDefs: string;
    symbols: readonly string[];
    aspectRatio: string;
    shot: ShotPlan;
    index: number;
    canvas: { w: number; h: number };
    fps: number;
    /** Cast ids of kind "character" (framing checks). */
    characters?: readonly string[];
    /** Quality checks on (off for the last repair attempt, so a shot is never lost to framing alone). */
    strict?: boolean;
  },
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
      ambient = { shapes: Array.isArray(r.shapes) ? r.shapes.slice(0, 12) : [], tracks: Array.isArray(r.tracks) ? r.tracks.slice(0, 12).map(normalizeTrack) : [] } as AmbientLayer;
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
  const checks = await qualityGates(svg, png, opts);
  if (opts.strict !== false && checks.problems.length) throw new Error(`Framing/lighting check failed: ${checks.problems.join("; ")}.`);
  return { svg, ambient, png, checks };
}

/**
 * Deterministic framing/lighting gates, measured on the RENDER (not the
 * markup), so transforms and groups cannot hide a tiny character:
 *  - every character of the shot's cast is visible,
 *  - the biggest one is tall enough for the shot type,
 *  - a night scene is actually dark.
 */
async function qualityGates(
  svg: string,
  png: Buffer,
  opts: { castDefs: string; aspectRatio: string; shot: ShotPlan; characters?: readonly string[]; canvas: { w: number; h: number } },
): Promise<{ problems: string[]; facts: string[] }> {
  const problems: string[] = [];
  const facts: string[] = [];
  const inShot = opts.shot.cast.filter((id) => opts.characters?.includes(id));
  let biggest = 0;
  for (const id of inShot) {
    const stripped = withoutUses(svg, id);
    if (stripped === svg) {
      problems.push(`#${id} is in this shot but not placed: add <use href="#${id}" …/>`);
      continue;
    }
    const pct = await visibleHeightPct(png, await renderArtwork(opts.castDefs, stripped, opts.aspectRatio, "1K"));
    if (pct === 0) problems.push(`#${id} is placed but not visible (off-canvas or covered)`);
    else facts.push(`#${id} visible, ${pct}% of the frame height`);
    biggest = Math.max(biggest, pct);
  }
  const need = minSubjectPct(opts.shot.shotType);
  if (inShot.length && biggest > 0) {
    if (biggest < need) {
      problems.push(
        `the main character is only ${biggest}% of the frame height as rendered; a "${opts.shot.shotType}" needs at least ${need}% (use height="${Math.round((need / 100) * opts.canvas.h)}" or more with width = height × 2/3, and no shrinking transform${need >= 75 ? "; let the canvas crop the legs" : ""})`,
      );
    } else facts.push(`main character size OK for a ${opts.shot.shotType} (${biggest}% ≥ ${need}%)`);
  }
  const lum = await meanBrightness(png);
  if (NIGHT_WORDS.test(opts.shot.description)) {
    if (lum > 120) problems.push(`this is a night/dark scene but the frame's mean brightness is ${lum}/255 (should be ≤ 120): add a full-canvas <rect width="${opts.canvas.w}" height="${opts.canvas.h}" fill="#0b1330" fill-opacity="0.45"/> over the set BEFORE the characters, and warm glows around the light sources`);
    else facts.push(`night lighting OK (mean brightness ${lum}/255)`);
  }
  return { problems, facts };
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
        characters: opts.plan.cast.filter((c) => c.kind === "character").map((c) => c.id),
        strict: attempt < maxAttempts - 1,
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
  // Shots are drawn in parallel, but a commit rewrites the project's shared defs
  // and renders against them: one commit per project at a time.
  const prev = commitLocks.get(ctx.projectId) ?? Promise.resolve();
  const run = prev.then(() => commitShotLocked(ctx, opts));
  const tail = run.catch(() => undefined);
  commitLocks.set(ctx.projectId, tail);
  try {
    return await run;
  } finally {
    if (commitLocks.get(ctx.projectId) === tail) commitLocks.delete(ctx.projectId);
  }
}

const commitLocks = new Map<string, Promise<unknown>>();

async function commitShotLocked(
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
