import { prisma } from "@/lib/db";
import { AppError } from "@/lib/services/apiError";
import { renderArtwork, sanitizeSvg } from "@/lib/services/svgRenderer";
import { writeFrameArtwork, writeFrameMotion } from "@/lib/services/frameWrites";
import { motionSpecSchema } from "@/lib/validation/motionSchema";
import { MAX_SVG_BYTES } from "@/lib/config/limits";
import { callModel, recordStep, throwIfCancelled, type DirectorContext } from "@/lib/services/director/context";
import { artistSystem, artistUser } from "@/lib/services/director/prompts";
import { artPattern, buildShotMotion, type AmbientLayer } from "@/lib/services/director/camera";
import { actingLayer, attachHeldProps, speakerId } from "@/lib/services/director/acting";
import type { KitSpec } from "@/lib/services/director/cast";
import { lipCurvesOf } from "@/lib/services/clipService";
import { shotTime } from "@/lib/services/director/fidelity";
import { applyPlacement, badPaints, coveredShare, minPropArea, visibleArea, extractJsonBlock, extractSvgFragment, fixPaints, isNearlyBlank, meanBrightness, minSubjectPct, missingRefs, NIGHT_WORDS, plainPlacement, reframePlacement, tintUnderFigures, upToUse, visibleBox, visibleExtent, withoutUses } from "@/lib/services/director/svgTools";
import { closeUpProblem, edgeCuts, emptyFrameProblem, EXIT_ENTRY_WORDS, figureLight, GATE, measureFrame, OVER_SHOULDER, type EdgeSide, nearDuplicateProblem, readableSetProblem, similarity, thumb, withoutInherited, type Box, type FrameMeasure } from "@/lib/services/director/frameGates";
import { zodIssues, type Plan, type ShotPlan } from "@/lib/services/director/schemas";
import type { Frame } from "@/generated/prisma/client";

export interface Drawing {
  readonly svg: string;
  readonly ambient: AmbientLayer | null;
  /** Still render of the painting (critic input, before/after snapshots). */
  readonly png: Buffer;
  /** Measured framing/lighting facts (the text critic's ground truth); `problems` is empty when every gate passed. */
  readonly checks?: { readonly problems: readonly string[]; readonly facts: readonly string[] };
  /** 32×18 grey thumbnail of the painting (near-duplicate gate between neighbouring shots). */
  readonly thumb?: Buffer;
}

/** An already accepted neighbouring shot (near-duplicate gate). */
export interface Neighbour {
  readonly index: number;
  readonly thumb: Buffer;
}

export interface DrawOutcome {
  readonly drawing: Drawing | null;
  /** LLM calls spent (1 = first try accepted). */
  readonly attempts: number;
  readonly lastError: string | null;
}

/**
 * Deterministic normalisation of the track mistakes real runs showed:
 * #rrggbbaa colours (tracks take 6-digit hex), a track-level `ease` (ease
 * belongs to each key: it is copied onto keys that lack one), and keys with
 * no time or no value (bench v2 repro: `keys.2.t: expected number`), which
 * are dropped; a track left with fewer than 2 keys is dropped (null). Every
 * other value goes to motionSpecSchema untouched.
 */
function normalizeTrack(track: unknown): unknown {
  if (!track || typeof track !== "object" || !Array.isArray((track as { keys?: unknown }).keys)) return track;
  const { ease, ...t } = track as { keys: Array<Record<string, unknown>>; ease?: unknown };
  const keys = t.keys.map((k, i) => {
    let key = typeof k?.v === "string" && /^#[0-9a-fA-F]{8}$/.test(k.v) ? { ...k, v: k.v.slice(0, 7) } : k;
    if (typeof ease === "string" && i > 0 && key && typeof key === "object" && key.ease === undefined) key = { ...key, ease };
    return key;
  });
  const timed = keys.filter((k) => k && typeof k === "object" && typeof k.t === "number" && Number.isFinite(k.t) && k.v !== undefined);
  if (timed.length < keys.length && timed.length < 2) return null;
  return { ...t, keys: timed };
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
    sets?: readonly string[];
    /** Cast ids of kind "prop" (the prop gate, held props). */
    props?: readonly string[];
    /** Kit specs of the kit-built characters (held props go to their hands). */
    kits?: ReadonlyMap<string, KitSpec>;
    /** Quality checks on (off for the last repair attempt, so a shot is never lost to framing alone). */
    strict?: boolean;
    /** Accepted neighbouring shots (index ± 1) for the near-duplicate gate. */
    neighbours?: readonly Neighbour[];
  },
): Promise<Drawing> {
  let svg = extractSvgFragment(text);
  if (!svg) throw new Error("No SVG fragment found. Put the frame inside a ```svg block.");
  // an unresolvable paint renders BLACK: strict attempts get it back to fix, the lenient one is repaired with a neutral colour
  const bad = badPaints(svg);
  if (bad.length && opts.strict !== false) throw new Error(`Unresolvable paint value(s) ${bad.map((b) => `"${b}"`).join(", ")} render BLACK: write url(#gradient-id) exactly (and declare the gradient in <defs>), or use a plain #rrggbb colour.`);
  if (bad.length) svg = fixPaints(svg, "#9aa3ad");
  // a kit character in the hold pose holds the shot's prop (owner QC 2026-10-10): the engine puts it in the hands
  const held = opts.kits && opts.props?.length ? attachHeldProps(svg, opts.shot, opts.kits, opts.props) : { svg, notes: [] };
  svg = held.svg;
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
      // Last (lenient) attempt: keep the shot and drop the broken ambient layer (the camera move stays)
      if (opts.strict === false) raw = null;
      else throw new Error(`The \`\`\`json ambient block is not valid JSON: ${errText(e)}`);
    }
    if (raw && typeof raw === "object") {
      const r = raw as { shapes?: unknown; tracks?: unknown };
      ambient = { shapes: Array.isArray(r.shapes) ? r.shapes.slice(0, 12) : [], tracks: Array.isArray(r.tracks) ? r.tracks.slice(0, 12).map(normalizeTrack).filter((x) => x !== null) : [] } as unknown as AmbientLayer;
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
  let checks = await qualityGates(svg, png, opts);
  checks.facts.push(...held.notes);
  // sprint c: a tint drawn over the figures and a figure cut by a side of the frame are the engine's to fix (re-measured, every gate again)
  if (checks.cuts.length || checks.dim.length) {
    const fixed = await edgeAndLightFixes(svg, checks, opts);
    if (fixed) {
      fixed.checks.facts.push(...held.notes);
      svg = fixed.svg;
      png = fixed.png;
      checks = fixed.checks;
    }
  }
  // D45: when the only problems are the main figure's size/headroom and it is placed plainly, the engine frames it (re-measured, every gate again)
  const placed = checks.subject && checks.problems.length && checks.problems.every((p) => REFRAMABLE.some((r) => r.test(p))) ? plainPlacement(svg, checks.subject.id) : null;
  if (placed && checks.subject) {
    const to = reframePlacement(placed, checks.subject.box, opts.canvas, { closeUp: minSubjectPct(opts.shot.shotType) >= 75, minPct: minSubjectPct(opts.shot.shotType) });
    const svg2 = applyPlacement(svg, placed, to);
    const png2 = await renderArtwork(opts.castDefs, svg2, opts.aspectRatio, "1K");
    const checks2 = await qualityGates(svg2, png2, opts);
    if (checks2.problems.length === 0) {
      checks2.facts.push(`framed by the engine: #${checks.subject.id} ${Math.round(placed.w)}×${Math.round(placed.h)} at (${Math.round(placed.x)}, ${Math.round(placed.y)}) → ${to.w}×${to.h} at (${to.x}, ${to.y}) (was: ${checks.problems.join("; ")})`);
      svg = svg2;
      png = png2;
      checks = checks2;
    }
  }
  const small = await thumb(png);
  if (!opts.shot.intentionalRepeat) {
    for (const n of opts.neighbours ?? []) {
      if (Math.abs(n.index - opts.index) !== 1) continue;
      const sim = similarity(small, n.thumb);
      const p = nearDuplicateProblem(sim, n.index, opts.shot.shotType);
      if (p) checks.problems.push(p);
      else checks.facts.push(`composition differs from shot ${n.index} (similarity ${Math.round(sim * 100)}%)`);
    }
  }
  if (opts.strict !== false && checks.problems.length) throw new Error(`Framing/lighting check failed: ${checks.problems.join("; ")}.`);
  return { svg, ambient, png, checks, thumb: small };
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
  opts: { castDefs: string; aspectRatio: string; shot: ShotPlan; characters?: readonly string[]; sets?: readonly string[]; props?: readonly string[]; canvas: { w: number; h: number } },
): Promise<{ problems: string[]; facts: string[]; subject: { id: string; box: Box } | null; cuts: { id: string; sides: EdgeSide[] }[]; dim: string[] }> {
  const problems: string[] = [];
  const facts: string[] = [];
  const cuts: { id: string; sides: EdgeSide[] }[] = [];
  const dim: string[] = [];
  const lum = await meanBrightness(png);
  const night = NIGHT_WORDS.test(`${opts.shot.scene} ${opts.shot.description}`);
  const dark = night || lum < GATE.darkFrame;
  const wide = minSubjectPct(opts.shot.shotType) <= 25;
  const edgeOk = EXIT_ENTRY_WORDS.test(opts.shot.description) || OVER_SHOULDER.test(`${opts.shot.shotType} ${opts.shot.description}`);
  let subjectId: string | null = null;
  const inShot = opts.shot.cast.filter((id) => opts.characters?.includes(id));
  // Size targets are the kit-built figures (people, animals); drawn "others" (swarms, spirits) only need to be visible
  const isKit = (id: string) => opts.castDefs.includes(`id="${id}-torso"`) || opts.castDefs.includes(`id="${id}-fur"`);
  const kitIds = new Set(inShot.filter(isKit));
  const filmHasKit = (opts.characters ?? []).some(isKit);
  let biggest = 0;
  let subject: Box | null = null;
  for (const id of inShot) {
    const stripped = withoutUses(svg, id);
    if (stripped === svg) {
      problems.push(`#${id} is in this shot but not placed: add <use href="#${id}" …/> (or its posed variant)`);
      continue;
    }
    const without = await renderArtwork(opts.castDefs, stripped, opts.aspectRatio, "1K");
    const { pct, touchesTop } = await visibleExtent(png, without);
    if (pct === 0) problems.push(`#${id} is placed but not visible (off-canvas or covered)`);
    else if (touchesTop) problems.push(`#${id}'s head is cut off by the top edge of the frame: move it down so the whole head is inside (y ≥ 0); in a close-up let the canvas crop the legs at the bottom, never the head`);
    else facts.push(`#${id} visible, ${pct}% of the frame height, head fully in frame`);
    // a kit figure's face hidden by something drawn after it (a prop held up, another character in front)
    const upTo = pct > 0 && kitIds.has(id) ? upToUse(svg, id) : null;
    if (upTo && upTo.length < svg.length) {
      const alone = await renderArtwork(opts.castDefs, upTo, opts.aspectRatio, "1K");
      const cover = await coveredShare(png, alone, await renderArtwork(opts.castDefs, withoutUses(upTo, id), opts.aspectRatio, "1K"));
      if (cover && cover.head >= GATE.maxFaceCover && cover.head - cover.rest >= 0.15) {
        problems.push(`#${id}'s face is covered by something drawn after it (${Math.round(cover.head * 100)}% of the head hidden): move that prop or character aside so the face shows (a held prop goes at chest or hand height, beside the head), or draw it before #${id}`);
      }
    }
    const box = pct > 0 ? await visibleBox(png, without) : null;
    // the figures the framing rules are about: kit people/animals (or every character in a film without kits)
    if (box && (kitIds.has(id) || !filmHasKit)) {
      // edge crop (owner QC 2026-10-10): no character cut by the frame unless the plan has it leave or enter
      const sides = edgeCuts(box, wide);
      if (sides.length && edgeOk) facts.push(`#${id} cut by the ${sides.join(" and ")} edge (the plan has an exit/entry or over-the-shoulder framing: allowed)`);
      else if (sides.length) {
        cuts.push({ id, sides });
        problems.push(
          `#${id} is cut by the ${sides.join(" and ")} edge of the frame (only ${Math.round((box.x1 - box.x0) * 100)}% of the frame wide is visible): move it inside so the whole figure shows${sides.includes("bottom") ? " (in a wide shot the feet stay in frame: make it smaller or move it up)" : ""}; a character is cut by the frame only when the shot has it leave or enter`,
        );
      }
      // night readability: a figure in a dark frame keeps its own light and stands out from what is behind it
      if (dark) {
        const light = await figureLight(png, without);
        if (light && (light.lum < GATE.nightFigureLum || light.contrast < GATE.nightFigureContrast)) {
          dim.push(id);
          problems.push(
            `#${id} is hard to see in this dark frame (figure brightness ${light.lum}/255, contrast ${light.contrast} against what is behind it; needs ≥ ${GATE.nightFigureLum} and ≥ ${GATE.nightFigureContrast}): draw the night tint BEFORE the characters, never over them, and put a warm light (lantern glow, window light, fire) behind or beside #${id}`,
          );
        } else if (light) facts.push(`#${id} readable in the dark (brightness ${light.lum}/255, contrast ${light.contrast})`);
      }
    }
    if ((kitIds.has(id) || kitIds.size === 0) && pct > biggest) {
      biggest = pct;
      subject = box;
      subjectId = id;
    }
  }
  // The shot's props are in it and story-sized (owner QC 2026-10-10): measured as the pixels each one adds
  const propsInShot = opts.shot.cast.filter((id) => opts.props?.includes(id));
  const minArea = minPropArea(opts.shot.shotType);
  for (const id of propsInShot) {
    const stripped = withoutUses(svg, id);
    if (stripped === svg) {
      problems.push(`#${id} (a key prop of this shot) is not placed: add <use href="#${id}" …/> where the action needs it`);
      continue;
    }
    const area = await visibleArea(png, await renderArtwork(opts.castDefs, stripped, opts.aspectRatio, "1K"));
    const side = Math.round(Math.sqrt((minArea / 0.6) * opts.canvas.w * opts.canvas.h));
    if (area < minArea) problems.push(`#${id} (a key prop) shows only ${(area * 100).toFixed(2)}% of the frame; a "${opts.shot.shotType}" needs at least ${(minArea * 100).toFixed(2)}% so the story object reads (use width/height ≈ ${side} or more, in front of the set, not hidden behind a character)`);
    else facts.push(`#${id} visible, ${(area * 100).toFixed(2)}% of the frame`);
  }
  // Measured on the BACKGROUND (every character removed): flat blocks the set is made of
  let background = svg;
  for (const id of opts.characters ?? []) background = withoutUses(background, id);
  const bgAll = await measureFrame(background === svg ? png : await renderArtwork(opts.castDefs, background, opts.aspectRatio, "1K"));
  // blocks that come from the Cast's set symbol are not the Artist's to fix (sets are gated at cast time)
  const setUses = [...svg.matchAll(/<use\b[^>]*>/g)].map((m) => m[0]).filter((u) => opts.sets?.includes(u.match(/href\s*=\s*["']#([^"']+)/)?.[1] ?? ""));
  const bg: FrameMeasure & { inheritedShare?: number } = setUses.length && bgAll.blockShare > GATE.maxBlockShare ? withoutInherited(bgAll, await measureFrame(await renderArtwork(opts.castDefs, setUses.map((u) => (u.endsWith("/>") ? u : `${u}</use>`)).join(""), opts.aspectRatio, "1K"))) : bgAll;
  const unreadable = readableSetProblem(bg, opts.canvas);
  if (unreadable) problems.push(unreadable);
  else facts.push("set readable (no stray flat blocks)");
  if ((bg.inheritedShare ?? 0) > 0.01) facts.push(`${Math.round((bg.inheritedShare ?? 0) * 100)}% flat blocks come from the set symbol itself (not counted against this shot)`);
  const empty = emptyFrameProblem(await measureFrame(png));
  if (empty) problems.push(empty);
  if (subject && minSubjectPct(opts.shot.shotType) >= 75) {
    const cu = closeUpProblem(bg, subject, opts.canvas);
    if (cu) problems.push(cu);
    else facts.push("close-up framing OK (head in the upper band, real background behind it)");
  }
  // A shot whose only characters are drawn "others" (a swarm, a spirit) in a film with kit figures: half the size rule
  const need = Math.round(minSubjectPct(opts.shot.shotType) * (kitIds.size === 0 && filmHasKit ? 0.5 : 1));
  if (inShot.length && biggest > 0) {
    if (biggest < need) {
      problems.push(
        `the main character is only ${biggest}% of the frame height as rendered; a "${opts.shot.shotType}" needs at least ${need}% (use height="${Math.round((need / 100) * opts.canvas.h)}" or more with width = height × 2/3, and no shrinking transform${need >= 75 ? "; let the canvas crop the legs" : ""})`,
      );
    } else facts.push(`main character size OK for a ${opts.shot.shotType} (${biggest}% ≥ ${need}%)`);
  }
  // Every shot shows its set (owner QC 2026-10-10: no shot without a set)
  const setsInShot = opts.shot.cast.filter((id) => opts.sets?.includes(id));
  if (setsInShot.length && setsInShot.every((id) => withoutUses(svg, id) === svg)) {
    problems.push(`the shot's set ${setsInShot.map((id) => `#${id}`).join(" / ")} is not placed: start the frame with <use href="#${setsInShot[0]}" x="0" y="0" width="${opts.canvas.w}" height="${opts.canvas.h}"/>`);
  }
  // A set is a background: used full-frame, never as a small picture on top of another set
  for (const m of svg.matchAll(/<use\b([^>]*)>/g)) {
    const id = m[1].match(/href\s*=\s*["']#([^"']+)/)?.[1];
    if (!id || !opts.sets?.includes(id)) continue;
    const w = Number(m[1].match(/\bwidth\s*=\s*["']?([\d.]+)/)?.[1] ?? opts.canvas.w);
    if (w < opts.canvas.w * 0.9) problems.push(`#${id} is a set (a background), but it is placed ${Math.round(w)} wide like an object: use it full-frame <use href="#${id}" x="0" y="0" width="${opts.canvas.w}" height="${opts.canvas.h}"/> as the first element, and only one set per shot`);
  }
  if (night) {
    if (lum > 120) problems.push(`this is a night/dark scene but the frame's mean brightness is ${lum}/255 (should be ≤ 120): add a full-canvas <rect width="${opts.canvas.w}" height="${opts.canvas.h}" fill="#0b1330" fill-opacity="0.45"/> over the set BEFORE the characters, and warm glows around the light sources`);
    else facts.push(`night lighting OK (mean brightness ${lum}/255)`);
  } else if (shotTime(opts.shot) === "day" && lum < 60) {
    problems.push(`this is a daytime scene but the frame's mean brightness is only ${lum}/255 (should be ≥ 60): remove dark overlays over the set and use a day sky`);
  }
  return { problems, facts, subject: subject && subjectId && kitIds.has(subjectId) ? { id: subjectId, box: subject } : null, cuts, dim };
}

type GateOpts = Parameters<typeof qualityGates>[2] & { kits?: ReadonlyMap<string, KitSpec>; props?: readonly string[] };
type Gates = Awaited<ReturnType<typeof qualityGates>>;

/**
 * Engine fixes for two measured failures (owner QC 2026-10-10): a full-frame
 * tint drawn over dim figures moves under them, and a plainly placed figure
 * cut by the left or right edge slides inside (4% of the frame per step, until
 * its whole visible box is ≥ 1% from the edge). Kept only when the re-measured
 * frame has fewer problems.
 */
async function edgeAndLightFixes(svg: string, checks: Gates, opts: GateOpts): Promise<{ svg: string; png: Buffer; checks: Gates } | null> {
  let out = svg;
  const notes: string[] = [];
  if (checks.dim.length) {
    const t = tintUnderFigures(out, opts.characters ?? [], opts.canvas);
    if (t) {
      out = t.svg;
      notes.push(t.note);
    }
  }
  for (const c of checks.cuts) {
    if (c.sides.length !== 1 || c.sides[0] === "bottom") continue;
    const placed = plainPlacement(out, c.id);
    if (!placed) continue;
    const without = await renderArtwork(opts.castDefs, withoutUses(out, c.id), opts.aspectRatio, "1K");
    const dir = c.sides[0] === "left" ? 1 : -1;
    for (let k = 1; k <= 6; k++) {
      const cand = applyPlacement(out, placed, { x: Math.round(placed.x + dir * k * 0.04 * opts.canvas.w), y: placed.y, w: placed.w, h: placed.h });
      const box = await visibleBox(await renderArtwork(opts.castDefs, cand, opts.aspectRatio, "1K"), without);
      if (box && box.x0 >= 0.01 && box.x1 <= 0.99) {
        out = cand;
        notes.push(`#${c.id} moved ${k * 4}% of the frame ${dir > 0 ? "right" : "left"} (the ${c.sides[0]} edge cut it)`);
        break;
      }
    }
  }
  if (out === svg) return null;
  // a held prop follows its holder's hands
  if (opts.kits && opts.props?.length) out = attachHeldProps(out, opts.shot, opts.kits, opts.props).svg;
  const png = await renderArtwork(opts.castDefs, out, opts.aspectRatio, "1K");
  const after = await qualityGates(out, png, opts);
  if (after.problems.length >= checks.problems.length) return null;
  after.facts.push(`fixed by the engine: ${notes.join("; ")} (was: ${checks.problems.filter((p) => !after.problems.includes(p)).join("; ")})`);
  return { svg: out, png, checks: after };
}

/** Problems the engine can fix itself by moving the main figure (its size and headroom), D45. */
const REFRAMABLE = [/^the main character is only \d+% of the frame height/, /^in this close-up the subject's head starts/];

/** The kind of an engine rejection, numbers removed (the same problem measured slightly differently is the same kind). */
export function errorKind(message: string): string {
  return message.replace(/#[0-9a-f]{3,8}\b/gi, "#").replace(/-?\d+(\.\d+)?/g, "N").slice(0, 160);
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
    /** Accepted neighbouring shots, read fresh on every attempt (shots are drawn in parallel). */
    neighbours?: () => Neighbour[];
    /** which posed symbol each kit character uses in this shot */
    actingBrief?: string;
    /** kit specs (held props go to the hands of a character in the hold pose) */
    kits?: ReadonlyMap<string, KitSpec>;
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
      user: artistUser({ plan: opts.plan, shot: opts.shot, index: opts.index, symbols: opts.symbols, feedback, previous, canvas: ctx.canvas, actingBrief: opts.actingBrief }),
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
        sets: opts.plan.cast.filter((c) => c.kind === "set").map((c) => c.id),
        props: opts.plan.cast.filter((c) => c.kind === "prop").map((c) => c.id),
        kits: opts.kits,
        strict: attempt < maxAttempts - 1,
        neighbours: opts.neighbours?.(),
      });
      return { drawing, attempts: attempt + 1, lastError: null };
    } catch (e) {
      const prevKind = lastError ? errorKind(lastError) : null;
      lastError = e instanceof Error ? e.message : String(e);
      await recordStep(ctx, { role: "artist", model: out.model, action: `${action}:invalid`, shotIndex: opts.index, attempt, summary: "Frame rejected by the engine", error: lastError });
      // the same measured gate failure twice in a row: another strict repair won't fix it, go to the lenient last attempt
      // (only gate failures: the lenient attempt accepts those; hard errors keep every repair)
      if (/^Framing\/lighting check failed/.test(lastError) && prevKind === errorKind(lastError) && attempt < maxAttempts - 2) attempt = maxAttempts - 2;
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
export interface CommitActing {
  readonly kits: ReadonlyMap<string, KitSpec>;
  readonly plan: Plan;
}

export async function commitShot(
  ctx: DirectorContext,
  opts: { frame: Frame; shot: ShotPlan; index: number; drawing: Drawing; castDefs: string; patterns: Map<number, string>; background: string; acting?: CommitActing },
): Promise<{ frame: Frame; kind: "clip" | "still"; note: string | null; acting?: string[] }> {
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
  opts: { frame: Frame; shot: ShotPlan; index: number; drawing: Drawing; castDefs: string; patterns: Map<number, string>; background: string; acting?: CommitActing },
): Promise<{ frame: Frame; kind: "clip" | "still"; note: string | null; acting?: string[] }> {
  throwIfCancelled(ctx);
  ctx.budget.check();
  const { index, drawing } = opts;
  const duration = shotDuration(opts.shot, opts.frame);
  // Acting (WP4.1): blinks, lip-sync for the speaker, walkers as step layers
  let painting = drawing.svg;
  let acting: AmbientLayer | null = null;
  let actingNotes: string[] = [];
  let walkPatterns: string[] = [];
  if (opts.acting && opts.acting.kits.size) {
    const speaker = speakerId(opts.acting.plan, opts.shot);
    const lip = speaker ? await lipCurvesOf(opts.frame, ctx.options.fps, duration) : undefined;
    const a = actingLayer({
      index,
      svg: drawing.svg,
      kits: opts.acting.kits,
      duration,
      fps: ctx.options.fps,
      canvas: ctx.canvas,
      lip: speaker && lip ? { who: speaker, open: lip.open, fps: lip.fps, offset: lip.offset } : null,
      maxShapes: 30 - (drawing.ambient?.shapes.length ?? 0),
      maxTracks: 40 - (drawing.ambient?.tracks.length ?? 0),
    });
    if (a.layer.shapes.length) {
      painting = a.svg;
      acting = a.layer;
      actingNotes = a.summary;
      walkPatterns = a.walks.flatMap((w) => w.patterns);
    }
  }
  const merge = (x: AmbientLayer | null, y: AmbientLayer | null): AmbientLayer | null => (!x ? y : !y ? x : { shapes: [...x.shapes, ...y.shapes], tracks: [...x.tracks, ...y.tracks] });
  opts.patterns.set(index, [artPattern(index, painting, ctx.canvas), ...walkPatterns].join("\n"));
  const defs = [opts.castDefs, ...[...opts.patterns.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p)].join("\n");
  if (Buffer.byteLength(defs, "utf8") <= MAX_SVG_BYTES * 0.92) {
    await prisma.project.update({ where: { id: ctx.projectId }, data: { artworkDefs: defs } });
    // try everything; then without the Artist's ambient layer; then camera only (the painting still has walkers removed only while acting rides along)
    const attempts: Array<{ layer: AmbientLayer | null; acting: boolean }> = [
      ...(drawing.ambient || acting ? [{ layer: merge(drawing.ambient, acting), acting: !!acting }] : []),
      ...(drawing.ambient && acting ? [{ layer: acting, acting: true }] : []),
      { layer: null, acting: false },
    ];
    let note: string | null = null;
    for (const attempt of attempts) {
      if (!attempt.acting && walkPatterns.length) {
        // without the acting layer the walker must be back in the painting
        opts.patterns.set(index, artPattern(index, drawing.svg, ctx.canvas));
        await prisma.project.update({ where: { id: ctx.projectId }, data: { artworkDefs: [opts.castDefs, ...[...opts.patterns.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p)].join("\n") } });
      }
      const motion = buildShotMotion({ index, shotType: opts.shot.shotType, duration, fps: ctx.options.fps, canvas: ctx.canvas, background: opts.background, ambient: attempt.layer });
      try {
        const r = await writeFrameMotion(opts.frame.id, motion);
        return { frame: r.frame, kind: "clip", note, acting: attempt.acting ? actingNotes : [] };
      } catch (e) {
        note = `clip ${attempt.layer ? (attempt.acting ? "with acting" : "with ambient layer") : ""} failed: ${errText(e)}`;
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
