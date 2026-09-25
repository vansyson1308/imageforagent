import { prisma } from "@/lib/db";
import { AppError } from "@/lib/services/apiError";
import { renderArtwork, sanitizeSvg } from "@/lib/services/svgRenderer";
import { saveBuffer, toPosix } from "@/lib/services/storage";
import { callModel, recordStep, throwIfCancelled, type DirectorContext } from "@/lib/services/director/context";
import { castSystem, castUser } from "@/lib/services/director/prompts";
import { castSheetFrame, extractSvgFragment, isNearlyBlank, symbolIds } from "@/lib/services/director/svgTools";
import type { CastMember, Plan } from "@/lib/services/director/schemas";

export interface CastLibrary {
  readonly defs: string;
  readonly symbols: string[];
  /** true when the Artist's library failed every attempt and placeholders were used. */
  readonly placeholder: boolean;
}

export const snapshotPath = (projectId: string, runId: string, name: string) => toPosix(`${projectId}/director/${runId}/${name}`);

/**
 * Validate a library: sanitizer (defs rules), one <symbol> per cast id with
 * a viewBox, and a real render of the cast sheet that is not blank.
 * Returns the rendered sheet PNG. Throws an Error whose message is the repair
 * feedback for the Artist.
 */
export async function validateLibrary(defs: string, cast: readonly CastMember[], canvas: { w: number; h: number }, aspectRatio: string): Promise<Buffer> {
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

/** Cast (Super): Bible → <symbol> library, validated + repaired, saved to the project. */
export async function runCast(ctx: DirectorContext, plan: Plan, aspectRatio: string): Promise<CastLibrary> {
  const system = castSystem(ctx.canvas, ctx.options.style);
  const baseUser = castUser(plan);
  let user = baseUser;
  let defs = "";
  let sheet: Buffer | null = null;
  for (let attempt = 0; attempt <= ctx.budget.budget.maxRepairs; attempt++) {
    throwIfCancelled(ctx);
    const out = await callModel(ctx, { role: "cast", action: attempt === 0 ? "defs" : "defs:repair", system, user, attempt, maxTokens: 16000, temperature: 0.5 });
    defs = extractSvgFragment(out.text);
    try {
      sheet = await validateLibrary(defs, plan.cast, ctx.canvas, aspectRatio);
      break;
    } catch (e) {
      const problem = e instanceof Error ? e.message : String(e);
      await recordStep(ctx, { role: "cast", model: out.model, action: "defs:invalid", attempt, summary: "Library rejected", error: problem });
      user = `${baseUser}\n\nYour previous library was rejected: ${problem}\nReturn the complete corrected library.`;
      sheet = null;
    }
  }
  let placeholder = false;
  if (!sheet) {
    placeholder = true;
    defs = placeholderLibrary(plan.cast, ctx.canvas);
    sheet = await renderArtwork(defs, castSheetFrame(plan.cast.map((c) => c.id), ctx.canvas), aspectRatio, "1K");
  }
  const sheetPath = snapshotPath(ctx.projectId, ctx.runId, "cast-sheet.png");
  await saveBuffer(sheetPath, sheet);
  await prisma.project.update({ where: { id: ctx.projectId }, data: { artworkDefs: defs } });
  await recordStep(ctx, {
    role: "cast",
    model: placeholder ? "placeholder" : ctx.models.mid,
    action: "library",
    summary: placeholder
      ? `Library failed ${ctx.budget.budget.maxRepairs + 1} attempts; using placeholder symbols for ${plan.cast.length} cast members`
      : `Library ready: ${plan.cast.length} symbols (${Math.round(Buffer.byteLength(defs) / 1024)} KB)`,
    imagePath: sheetPath,
    error: placeholder ? "cast library invalid after all repairs" : null,
  });
  return { defs, symbols: symbolIds(defs), placeholder };
}
