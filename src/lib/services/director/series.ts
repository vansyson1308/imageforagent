import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/services/apiError";
import type { KitSpec } from "@/lib/services/director/cast";
import { castMemberSchema, type CastMember, type Plan } from "@/lib/services/director/schemas";
import { splitLibrary } from "@/lib/services/director/svgTools";
import { z } from "zod";

/**
 * Series mode (SPEC v2 WP5): a daily channel needs the SAME host and set in
 * every episode. A finished run's accepted cast library (symbols + gradients),
 * its kit specs and its voice map are saved as a Series. A new film "in
 * series X" gets the series cast as recurring members: the Director must reuse
 * their ids, their Bible entries are locked, the Cast draws ONLY new guests
 * and sets, and the series symbols are copied verbatim, so the host is
 * pixel-identical across episodes by construction (test-enforced by hash).
 */

export interface SeriesData {
  readonly id: string;
  readonly name: string;
  readonly language: string;
  readonly style: string;
  readonly palette: string[];
  readonly cast: CastMember[];
  readonly library: string;
  readonly kits: Map<string, KitSpec>;
  readonly voices: Record<string, string>;
}

const bibleSchema = z.object({ palette: z.array(z.string()).default([]), cast: z.array(castMemberSchema) });

export function kitsToJson(kits: ReadonlyMap<string, KitSpec>): string {
  return JSON.stringify(Object.fromEntries(kits));
}

export function kitsFromJson(s: string | null | undefined): Map<string, KitSpec> {
  if (!s) return new Map();
  try {
    return new Map(Object.entries(JSON.parse(s) as Record<string, KitSpec>));
  } catch {
    return new Map();
  }
}

/** sha256 of one symbol's markup in a defs library (identity across episodes). */
export function symbolHash(defs: string, id: string): string | null {
  const sym = splitLibrary(defs).symbols.get(id);
  return sym ? createHash("sha256").update(sym).digest("hex") : null;
}

/** Store what a series needs on the run itself (library, kits, voices). */
export async function persistRunCast(runId: string, data: { library?: string; kits?: ReadonlyMap<string, KitSpec>; voices?: Record<string, string> }): Promise<void> {
  await prisma.directorRun.update({
    where: { id: runId },
    data: {
      ...(data.library !== undefined && { library: data.library }),
      ...(data.kits && { kits: kitsToJson(data.kits) }),
      ...(data.voices && { voices: JSON.stringify(data.voices) }),
    },
  });
}

export async function saveSeries(opts: { runId: string; name: string; demoSession: string | null }): Promise<{ id: string; name: string; members: string[] }> {
  const run = await prisma.directorRun.findUnique({ where: { id: opts.runId } });
  if (!run) throw new AppError("NOT_FOUND", "Run not found.");
  if (run.status !== "done" || !run.library || !run.bible) throw new AppError("VALIDATION", "Only a finished run with a cast library can become a series.", "Wait for the film to finish.");
  const bible = bibleSchema.parse(JSON.parse(run.bible));
  const series = await prisma.series.create({
    data: {
      name: opts.name.trim().slice(0, 80) || bible.cast[0]?.name || "My series",
      language: run.language,
      style: run.style,
      bible: JSON.stringify({ palette: bible.palette, cast: bible.cast }),
      library: run.library,
      kits: run.kits ?? "{}",
      voices: run.voices ?? "{}",
      sourceRunId: run.id,
      demoSession: opts.demoSession,
    },
  });
  return { id: series.id, name: series.name, members: bible.cast.map((c) => c.id) };
}

export async function loadSeries(id: string, demoSession: string | null, demoEnabled: boolean): Promise<SeriesData> {
  const s = await prisma.series.findUnique({ where: { id } });
  if (!s || (demoEnabled && s.demoSession !== demoSession)) throw new AppError("NOT_FOUND", "Series not found.");
  const bible = bibleSchema.parse(JSON.parse(s.bible));
  let voices: Record<string, string> = {};
  try {
    voices = JSON.parse(s.voices) as Record<string, string>;
  } catch {
    voices = {};
  }
  return { id: s.id, name: s.name, language: s.language, style: s.style, palette: bible.palette, cast: bible.cast, library: s.library, kits: kitsFromJson(s.kits), voices };
}

export async function listSeries(demoSession: string | null, demoEnabled: boolean) {
  const rows = await prisma.series.findMany({ where: demoEnabled ? { demoSession } : {}, orderBy: { createdAt: "desc" }, select: { id: true, name: true, language: true, style: true, bible: true, createdAt: true } });
  return rows.map((r) => {
    let cast: Array<{ id: string; name: string; kind: string }> = [];
    try {
      cast = (JSON.parse(r.bible) as { cast: Array<{ id: string; name: string; kind: string }> }).cast.map((c) => ({ id: c.id, name: c.name, kind: c.kind }));
    } catch {
      cast = [];
    }
    return { id: r.id, name: r.name, language: r.language, style: r.style, cast, createdAt: r.createdAt };
  });
}

/**
 * A full take that REUSES an approved cast-only preview (owner 2026-10-12): the preview run's
 * whole Bible (ids, looks, prop states), its library (every symbol, state symbols, sets and their
 * lighting variants, kit characters) and its recognition results, verbatim. The take's planner may
 * use only these cast ids; the Cast is not called; the recognition gate is not re-spent.
 */
export interface CastFromRun extends SeriesData {
  readonly sourceRunId: string;
  /** the preview's recognition results, carried over (no re-spend) */
  readonly recognition: ReadonlyArray<{ symbol: string; prop: string; state: string | null; ok: boolean | null; saw: string; redraws: number }>;
  /** the preview's kit sets' times of day, variants included (retimeSets / the fidelity brief) */
  readonly setTimes: ReadonlyMap<string, string>;
}

const previewSummarySchema = z
  .object({
    propRecognition: z.array(z.object({ symbol: z.string(), prop: z.string(), state: z.string().nullable(), ok: z.boolean().nullable(), saw: z.string(), redraws: z.number() })).optional(),
    castSetTimes: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

/** Load a finished run's cast for reuse (operator only, checked by the route). */
export async function loadCastFromRun(runId: string): Promise<CastFromRun> {
  const run = await prisma.directorRun.findUnique({ where: { id: runId } });
  if (!run) throw new AppError("NOT_FOUND", "Run not found.");
  if (run.status !== "done" || !run.library || !run.bible) throw new AppError("VALIDATION", "Only a finished run with a cast library can lend its cast.", "Run a cast-only preview first (stopAfter: cast).");
  const bible = bibleSchema.parse(JSON.parse(run.bible));
  const summary = previewSummarySchema.safeParse(run.summary ? JSON.parse(run.summary) : {});
  const s = summary.success ? summary.data : {};
  return {
    id: run.id,
    sourceRunId: run.id,
    name: `cast of run ${run.id}`,
    language: run.language,
    style: run.style,
    palette: bible.palette,
    cast: bible.cast,
    library: run.library,
    kits: kitsFromJson(run.kits),
    voices: {},
    recognition: s.propRecognition ?? [],
    setTimes: new Map(Object.entries(s.castSetTimes ?? inferSetTimes(bible.cast, run.library))),
  };
}

/**
 * A run from before `castSetTimes` was kept: each kit set's lighting is read back from the variant
 * the library holds (a set with a `--night` variant is lit for day, and the other way round).
 */
export function inferSetTimes(cast: ReadonlyArray<Pick<CastMember, "id" | "kind">>, defs: string): Record<string, string> {
  const has = (id: string) => new RegExp(`\\bid\\s*=\\s*["']${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`).test(defs);
  const out: Record<string, string> = {};
  for (const c of cast.filter((m) => m.kind === "set")) {
    if (has(`${c.id}--night`)) Object.assign(out, { [c.id]: "day", [`${c.id}--night`]: "night" });
    else if (has(`${c.id}--day`)) Object.assign(out, { [c.id]: "night", [`${c.id}--day`]: "day" });
  }
  return out;
}

/**
 * The symbols a reused cast is identified by, each with a short sha256 of its markup: every cast
 * member, each prop state (`<id>--<state>`) and each set lighting variant (`<id>--day|night`) the
 * library holds. The preview sheet and the take's log print the same list (owner 2026-10-12).
 */
export function castHashes(cast: ReadonlyArray<Pick<CastMember, "id" | "kind" | "states">>, defs: string): Array<{ id: string; sha: string }> {
  const ids = cast.flatMap((c) => [c.id, ...(c.states ?? []).map((st) => `${c.id}--${st.id}`), ...(c.kind === "set" ? [`${c.id}--day`, `${c.id}--night`] : [])]);
  return ids.flatMap((id) => {
    const h = symbolHash(defs, id);
    return h ? [{ id, sha: h.slice(0, 12) }] : [];
  });
}

/** The Director's brief for a take that reuses an approved cast: ONLY these ids, these prop states. */
export function castFromRunBrief(cast: readonly CastMember[], palette: readonly string[]): string {
  return [
    "This film REUSES an approved cast (the engine already has every one of them drawn). Use ONLY these cast ids, exactly as written; do not add new characters, props or sets. Keep each one's look.",
    ...cast.map((c) => `- ${c.id} (${c.kind}, "${c.name}"): ${c.look}${c.states?.length ? ` — STATES: ${c.states.map((st) => `"${st.id}" (${st.look})`).join(", ")}; in every shot that shows it, set "propStates": [{"prop": "${c.id}", "state": …}]` : ""}`),
    palette.length ? `Palette: ${palette.join(" ")}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** A plan locked to a reused cast: the cast IS the approved one (Bible entries verbatim), shots keep only its ids. */
export function lockFixedCast(plan: Plan, cast: readonly CastMember[]): { plan: Plan; dropped: string[] } {
  const ids = new Set(cast.map((c) => c.id));
  const dropped = [...new Set([...plan.cast.map((c) => c.id), ...plan.shots.flatMap((s) => s.cast)])].filter((id) => !ids.has(id));
  return { plan: { ...plan, cast: [...cast], shots: plan.shots.map((s) => ({ ...s, cast: s.cast.filter((id) => ids.has(id)) })) }, dropped };
}

/** The Director's brief for an episode: the recurring cast to reuse by id. */
export function seriesBrief(series: SeriesData): string {
  const lines = series.cast.map((c) => `- ${c.id} (${c.kind}, "${c.name}"): ${c.look}`);
  return [
    `This film is an EPISODE of the series "${series.name}". RECURRING CAST: reuse these ids EXACTLY for these characters and sets (the engine already has them, pixel-identical). You may add new guests and new sets with NEW ids.`,
    ...lines,
    `Series palette: ${series.palette.join(" ")}.`,
  ].join("\n");
}

/**
 * Lock the recurring cast into a plan: their Bible entries are the series'
 * (an episode can't redesign the host), and a recurring id used in a shot but
 * missing from the cast list is added back.
 */
export function lockSeriesCast(plan: Plan, series: SeriesData): Plan {
  const byId = new Map(series.cast.map((c) => [c.id, c]));
  const used = new Set(plan.shots.flatMap((s) => s.cast));
  const cast = plan.cast.map((c) => byId.get(c.id) ?? c);
  for (const [id, c] of byId) if (used.has(id) && !cast.some((x) => x.id === id)) cast.push(c);
  return { ...plan, cast };
}

/**
 * Merge an episode's NEW defs after the series library. Paint servers or
 * symbols in the new defs whose id is already taken by the series are
 * renamed (`<id>-ep`), so a guest can't overwrite the host's gradient.
 */
export function mergeLibraries(seriesDefs: string, newDefs: string): string {
  if (!newDefs.trim()) return seriesDefs;
  const taken = new Set([...seriesDefs.matchAll(/\bid\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]));
  let out = newDefs;
  for (const m of newDefs.matchAll(/\bid\s*=\s*["']([^"']+)["']/g)) {
    const id = m[1];
    if (!taken.has(id)) continue;
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`(\\bid\\s*=\\s*["'])${esc}(["'])`, "g"), `$1${id}-ep$2`).replace(new RegExp(`#${esc}(?=["')\\s])`, "g"), `#${id}-ep`);
  }
  return `${seriesDefs}\n${out}`;
}
