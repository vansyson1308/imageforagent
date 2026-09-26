import { prisma } from "@/lib/db";
import { AppError } from "@/lib/services/apiError";
import { renderArtwork, sanitizeSvg } from "@/lib/services/svgRenderer";
import { saveBuffer, toPosix } from "@/lib/services/storage";
import { callModel, recordStep, throwIfCancelled, type DirectorContext } from "@/lib/services/director/context";
import { castRepairUser, castSystem, castUser } from "@/lib/services/director/prompts";
import sharp from "sharp";
import { castSheetFrame, extractJsonBlock, extractSvgFragment, isNearlyBlank, missingRefs, neededExtras, normalizeSet, opaquePieces, splitLibrary, symbolIds, symbolInfo, transparentShare } from "@/lib/services/director/svgTools";
import { buildDoll, dollSchema } from "@/lib/services/director/dollKit";
import { zodIssues } from "@/lib/services/director/schemas";
import type { CastMember, Plan } from "@/lib/services/director/schemas";

export interface CastLibrary {
  readonly defs: string;
  readonly symbols: string[];
  /** true when the Artist's library failed every attempt and placeholders were used. */
  readonly placeholder: boolean;
}

export const snapshotPath = (projectId: string, runId: string, name: string) => toPosix(`${projectId}/director/${runId}/${name}`);

/**
 * Quality problems of ONE cast member's symbol (empty = accepted): present,
 * scalable, references resolve, sized for its kind (sets fill 16:9, characters
 * stand in 2:3), detailed enough, and — for sets — measured on a render to
 * cover the whole frame. Messages are repair feedback for the Artist.
 */
export async function symbolProblems(
  member: CastMember,
  symbol: string | undefined,
  extras: ReadonlyMap<string, string>,
  canvas: { w: number; h: number },
  aspectRatio: string,
  known: ReadonlySet<string> = new Set(),
): Promise<string[]> {
  const id = member.id;
  if (!symbol) return [`#${id} is missing: add <symbol id="${id}" viewBox="…">`];
  if (!/^<symbol\b[^>]*viewBox\s*=/.test(symbol)) return [`#${id} has no viewBox (it would not scale)`];
  const dangling = missingRefs(symbol, new Set([...extras.keys(), ...known]));
  if (dangling.length) return [`#${id} references undefined ${dangling.map((d) => `#${d}`).join(", ")}: declare those gradients in the same reply`];
  const s = symbolInfo(symbol).get(id);
  if (!s) return [`#${id} has an unreadable viewBox`];
  const problems: string[] = [];
  const aspect = s.w / s.h;
  const frameAspect = canvas.w / canvas.h;
  if (member.kind === "set" && Math.abs(aspect - frameAspect) > frameAspect * 0.12) problems.push(`#${id} is a set: its viewBox must be "0 0 ${canvas.w} ${canvas.h}" (got ${s.w}×${s.h}), otherwise it cannot fill the frame`);
  if (member.kind === "character" && (aspect < 0.5 || aspect > 0.85)) problems.push(`#${id} is a character: its viewBox must be "0 0 400 600" (got ${s.w}×${s.h})`);
  const min = member.kind === "set" ? 15 : member.kind === "character" ? 12 : 5;
  if (s.shapes < min) problems.push(`#${id} has only ${s.shapes} shapes; draw at least ${min} (${member.kind === "set" ? "sky, far, middle and near layers, light sources" : member.kind === "character" ? "hair, face with eyes/brows/mouth, clothes in 2-3 tones, arms, hands, legs, shoes" : "the object's parts and highlights"})`);
  if (member.kind === "character" && !problems.length) {
    const alone = await renderArtwork([...neededExtras(symbol, extras).values(), symbol].join("\n"), `<use href="#${id}" x="0" y="0" width="720" height="1080"/>`, aspectRatio, "1K").catch(() => null);
    if (alone) {
      const meta = await sharp(alone).metadata();
      const crop = await sharp(alone).extract({ left: 0, top: 0, width: Math.round(((meta.width ?? 1024) * 720) / canvas.w), height: meta.height ?? 576 }).png().toBuffer();
      const pieces = await opaquePieces(crop);
      const big = pieces.filter((p) => p >= 0.04);
      if (big.length >= 2) problems.push(`#${id} falls apart into ${big.length} separate pieces (${big.map((p) => `${Math.round(p * 100)}%`).join(", ")} of the figure): head, neck, body, arms and legs must overlap so the character is one connected shape`);
    }
  }
  if (member.kind === "set" && !problems.length) {
    const alone = await renderArtwork([...neededExtras(symbol, extras).values(), symbol].join("\n"), `<use href="#${id}" x="0" y="0" width="${canvas.w}" height="${canvas.h}"/>`, aspectRatio, "1K").catch(() => null);
    const clear = alone ? await transparentShare(alone) : 1;
    if (clear > 0.03) problems.push(`#${id} leaves ${Math.round(clear * 100)}% of the frame transparent: start the set with a full-bleed sky/wall <rect width="${canvas.w}" height="${canvas.h}" fill="…"/> and draw the ground to the bottom edge`);
  }
  return problems;
}

/**
 * Validate a whole library: sanitizer (defs rules), one <symbol> per cast id
 * with a viewBox, per-symbol quality gates when `strict`, and a real render of
 * the cast sheet that is not blank. Returns the rendered sheet PNG. Throws an
 * Error whose message is the repair feedback for the Artist.
 */
export async function validateLibrary(defs: string, cast: readonly CastMember[], canvas: { w: number; h: number }, aspectRatio: string, strict = true): Promise<Buffer> {
  if (!defs) throw new Error("The reply contained no SVG markup.");
  try {
    sanitizeSvg(defs, "defs");
  } catch (e) {
    throw new Error(e instanceof AppError ? `${e.message} ${e.hint ?? ""}`.trim() : String(e));
  }
  const have = new Set(symbolIds(defs));
  const missing = cast.map((c) => c.id).filter((id) => !have.has(id));
  if (missing.length) throw new Error(`Missing <symbol> for: ${missing.join(", ")}. Every cast id needs <symbol id="<id>" viewBox="…">.`);
  const noViewBox = [...defs.matchAll(/<symbol\b([^>]*)>/g)].filter((m) => !/viewBox\s*=/.test(m[1])).map((m) => m[1].match(/id\s*=\s*["']([^"']+)/)?.[1] ?? "?");
  if (noViewBox.length) throw new Error(`Symbols without viewBox (they would not scale): ${noViewBox.join(", ")}.`);
  if (strict) {
    const { symbols, extras } = splitLibrary(defs);
    const problems: string[] = [];
    for (const c of cast) problems.push(...(await symbolProblems(c, symbols.get(c.id), extras, canvas, aspectRatio, have)));
    if (problems.length) throw new Error(`Library too simple or mis-sized: ${problems.join("; ")}.`);
  }
  let png: Buffer;
  try {
    png = await renderArtwork(defs, castSheetFrame(cast.map((c) => c.id), canvas), aspectRatio, "1K");
  } catch (e) {
    throw new Error(e instanceof AppError ? `${e.message} ${e.hint ?? ""}`.trim() : String(e));
  }
  if (await isNearlyBlank(png)) throw new Error("The cast sheet renders blank — shapes are missing, transparent or outside the viewBox.");
  return png;
}

/** Deterministic stand-in symbols so a film can still be made when the library keeps failing. */
export function placeholderLibrary(cast: readonly CastMember[], canvas: { w: number; h: number }): string {
  return cast
    .map((c) => {
      const [a, b = a, d = b] = c.colors;
      if (c.kind === "set") {
        return `<symbol id="${c.id}" viewBox="0 0 ${canvas.w} ${canvas.h}"><rect width="${canvas.w}" height="${canvas.h}" fill="${a}"/><rect y="${Math.round(canvas.h * 0.78)}" width="${canvas.w}" height="${Math.round(canvas.h * 0.22)}" fill="${b}"/></symbol>`;
      }
      if (c.kind === "prop") {
        return `<symbol id="${c.id}" viewBox="0 0 400 400"><rect x="80" y="140" width="240" height="260" rx="40" fill="${a}"/><circle cx="200" cy="120" r="70" fill="${b}"/></symbol>`;
      }
      return `<symbol id="${c.id}" viewBox="0 0 400 600"><rect x="110" y="230" width="180" height="300" rx="80" fill="${a}"/><circle cx="200" cy="150" r="95" fill="${b}"/><circle cx="170" cy="140" r="10" fill="${d}"/><circle cx="235" cy="140" r="10" fill="${d}"/><rect x="130" y="520" width="50" height="80" rx="20" fill="${d}"/><rect x="220" y="520" width="50" height="80" rx="20" fill="${d}"/></symbol>`;
    })
    .join("\n");
}

interface Candidate {
  readonly symbol: string;
  readonly extras: Map<string, string>;
  readonly attempt: number;
  readonly problems: readonly string[];
}

/** Rename paint-server ids that collide with an earlier attempt's (different) definition. */
function namespaced(c: Candidate, taken: ReadonlyMap<string, string>): { symbol: string; extras: Map<string, string> } {
  let symbol = c.symbol;
  let defs = [...c.extras.entries()];
  for (const [id, def] of c.extras) {
    if (!taken.has(id) || taken.get(id) === def) continue;
    const next = `${id}-a${c.attempt}`;
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const swap = (m: string) => m.replace(new RegExp(`(#)${esc}(?=["')\\s])`, "g"), `$1${next}`).replace(new RegExp(`(\\bid\\s*=\\s*["'])${esc}(["'])`, "g"), `$1${next}$2`);
    symbol = swap(symbol);
    defs = defs.map(([k, v]) => [k === id ? next : k, swap(v)]);
  }
  return { symbol, extras: new Map(defs) };
}

/**
 * Cast (Super): Bible → <symbol> library. Symbols are accepted ONE BY ONE:
 * a repair turn redraws only the members that failed their gate, so good work
 * is never thrown away. A member still failing after the last repair uses its
 * best attempt (sets normalised to cover the frame), else a placeholder.
 */
export async function runCast(ctx: DirectorContext, plan: Plan, aspectRatio: string): Promise<CastLibrary> {
  const system = castSystem(ctx.canvas, ctx.options.style);
  const accepted = new Map<string, Candidate>();
  const best = new Map<string, Candidate>();
  let pending: CastMember[] = [...plan.cast];
  let problems: string[] = [];
  for (let attempt = 0; attempt <= ctx.budget.budget.maxRepairs && pending.length; attempt++) {
    throwIfCancelled(ctx);
    const user = attempt === 0 ? castUser(plan) : castRepairUser(plan, pending, [...accepted.keys()], problems);
    const out = await callModel(ctx, { role: "cast", action: attempt === 0 ? "defs" : "defs:repair", system, user, attempt, maxTokens: 16000, temperature: 0.5 });
    // Human characters come as doll specs (```json {"dolls": {...}}); the engine draws them
    const dolls = new Map<string, string>();
    const dollProblems: string[] = [];
    try {
      const raw = extractJsonBlock(out.text) as { dolls?: Record<string, unknown> } | null;
      for (const [id, spec] of Object.entries(raw?.dolls ?? {})) {
        const member = pending.find((c) => c.id === id && c.kind === "character");
        if (!member) continue;
        const r = dollSchema.safeParse(spec);
        if (r.success) dolls.set(id, buildDoll(id, r.data));
        else dollProblems.push(`#${id} doll spec invalid: ${zodIssues(r.error)}`);
      }
    } catch (e) {
      dollProblems.push(`the \`\`\`json dolls block is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
    const drawn = extractSvgFragment(out.text);
    const defs = [drawn, ...dolls.values()].filter(Boolean).join("\n");
    let parsed: ReturnType<typeof splitLibrary>;
    try {
      if (!defs) throw new Error(dollProblems[0] ?? "The reply contained no SVG markup.");
      sanitizeSvg(defs, "defs");
      parsed = splitLibrary(defs);
    } catch (e) {
      problems = [e instanceof AppError ? `${e.message} ${e.hint ?? ""}`.trim() : e instanceof Error ? e.message : String(e)];
      await recordStep(ctx, { role: "cast", model: out.model, action: "defs:invalid", attempt, summary: "Library rejected", error: problems[0] });
      continue;
    }
    problems = [...dollProblems];
    const known = new Set([...accepted.keys(), ...parsed.symbols.keys()]);
    for (const c of pending) {
      const symbol = parsed.symbols.get(c.id);
      const found = await symbolProblems(c, symbol, parsed.extras, ctx.canvas, aspectRatio, known);
      if (!symbol) {
        problems.push(...found);
        continue;
      }
      const cand: Candidate = { symbol, extras: neededExtras(symbol, parsed.extras), attempt, problems: found };
      if (!found.length) accepted.set(c.id, cand);
      else {
        problems.push(...found);
        const prev = best.get(c.id);
        if (!prev || found.length <= prev.problems.length) best.set(c.id, cand);
      }
    }
    pending = plan.cast.filter((c) => !accepted.has(c.id));
    if (pending.length) {
      await recordStep(ctx, {
        role: "cast",
        model: out.model,
        action: "defs:invalid",
        attempt,
        summary: `Kept ${accepted.size}/${plan.cast.length} symbols; redrawing ${pending.map((c) => c.id).join(", ")}`,
        error: `Library too simple or mis-sized: ${problems.join("; ")}.`,
      });
    }
  }

  // Assemble: accepted → best effort (sets normalised) → placeholder
  const extras = new Map<string, string>();
  const symbols: string[] = [];
  const fallback: string[] = [];
  const placeholders: string[] = [];
  for (const c of plan.cast) {
    const cand = accepted.get(c.id) ?? best.get(c.id);
    if (!cand) {
      placeholders.push(c.id);
      symbols.push(placeholderLibrary([c], ctx.canvas));
      continue;
    }
    const { symbol, extras: own } = namespaced(cand, extras);
    for (const [k, v] of own) if (!extras.has(k)) extras.set(k, v);
    if (accepted.has(c.id)) symbols.push(symbol);
    else {
      fallback.push(c.id);
      symbols.push(c.kind === "set" ? normalizeSet(symbol, c.colors[0] ?? "#20243a") : symbol);
    }
  }
  let defs = [...extras.values(), ...symbols].join("\n");
  let sheet: Buffer;
  let placeholder = placeholders.length === plan.cast.length;
  try {
    sheet = await validateLibrary(defs, plan.cast, ctx.canvas, aspectRatio, false);
  } catch (e) {
    await recordStep(ctx, { role: "cast", model: "engine", action: "defs:invalid", summary: "Assembled library rejected", error: e instanceof Error ? e.message : String(e) });
    placeholder = true;
    placeholders.splice(0, placeholders.length, ...plan.cast.map((c) => c.id));
    fallback.length = 0;
    defs = placeholderLibrary(plan.cast, ctx.canvas);
    sheet = await renderArtwork(defs, castSheetFrame(plan.cast.map((c) => c.id), ctx.canvas), aspectRatio, "1K");
  }
  const sheetPath = snapshotPath(ctx.projectId, ctx.runId, "cast-sheet.png");
  await saveBuffer(sheetPath, sheet);
  await prisma.project.update({ where: { id: ctx.projectId }, data: { artworkDefs: defs } });
  const notes = [fallback.length ? `best effort for ${fallback.join(", ")}` : "", placeholders.length ? `placeholders for ${placeholders.join(", ")}` : ""].filter(Boolean).join("; ");
  await recordStep(ctx, {
    role: "cast",
    model: placeholder ? "placeholder" : ctx.models.mid,
    action: "library",
    summary: placeholder
      ? `Library failed ${ctx.budget.budget.maxRepairs + 1} attempts; using placeholder symbols for ${plan.cast.length} cast members`
      : `Library ready: ${plan.cast.length} symbols (${Math.round(Buffer.byteLength(defs) / 1024)} KB)${notes ? ` — ${notes}` : ""}`,
    imagePath: sheetPath,
    error: placeholder ? "cast library invalid after all repairs" : placeholders.length ? `placeholders used for ${placeholders.join(", ")}` : null,
  });
  return { defs, symbols: symbolIds(defs), placeholder };
}
