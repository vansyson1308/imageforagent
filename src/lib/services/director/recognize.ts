import sharp from "sharp";
import { prisma } from "@/lib/db";
import { LlmError } from "@/lib/providers/types";
import { renderArtwork, sanitizeSvg } from "@/lib/services/svgRenderer";
import { saveBuffer } from "@/lib/services/storage";
import { callJson, callModel, recordStep, ReplyInvalidError, type DirectorContext } from "@/lib/services/director/context";
import { castRecognizeUser, castSystem, nameObjectSystem, nameObjectUser, propCheckSystem, propCheckUser } from "@/lib/services/director/prompts";
import { objectNameSchema, propCheckSchema, type CastMember, type ObjectName, type Plan } from "@/lib/services/director/schemas";
import { heroProp, stateMembers, stateSymbol } from "@/lib/services/director/plan";
import { extractSvgFragment, neededExtras, splitLibrary, symbolIds, toJpegDataUri } from "@/lib/services/director/svgTools";
import { namespaced, snapshotPath, symbolProblems, type CastLibrary } from "@/lib/services/director/cast";

/**
 * Hero-prop recognition gate (owner 2026-10-12, A). Generic, no per-film code: each drawing of
 * the story's key object (every state) is rendered ALONE on a plain background, the vision model
 * names it with no story and no hints, and Nano checks that name against the plan's prop (and
 * state). On a miss the Cast redraws that symbol with what the viewer saw as feedback (at most
 * MAX_REDRAWS times). Every look, check and redraw is a trace step. Without a vision model the
 * gate cannot run: it says so in the trace and reports "not checked" (null), never a pass.
 */

export const MAX_REDRAWS = 2;
/** The plain background the object is shown on. */
export const RECOGNIZE_BACKGROUND = "#f4f1ea";

export interface Recognition {
  /** the symbol checked: the base id (first state, or a prop without states) or `<id>--<state>` */
  readonly symbol: string;
  readonly prop: string;
  readonly state: string | null;
  /** true = named correctly, false = still not after the redraws, null = not checked (no vision model) */
  readonly ok: boolean | null;
  /** what the viewer named it, last look */
  readonly saw: string;
  readonly redraws: number;
}

/** The symbols of the hero prop that a viewer must recognise: the base (= its first state) and each later state. */
export function heroSymbols(plan: Plan): Array<{ symbol: string; member: CastMember; state: { id: string; look: string } | null }> {
  const hero = heroProp(plan);
  const member = plan.cast.find((c) => c.id === hero);
  if (!hero || !member) return [];
  if (!member.states?.length) return [{ symbol: hero, member, state: null }];
  const later = stateMembers({ cast: [member] });
  return [{ symbol: hero, member, state: member.states[0] }, ...member.states.slice(1).map((st, k) => ({ symbol: stateSymbol(hero, st.id), member: later[k], state: st }))];
}

/** One symbol alone, centred on a plain square: what the viewer sees. */
export async function renderAlone(defs: string, symbol: string, aspectRatio: string, canvas: { w: number; h: number }): Promise<Buffer> {
  const side = Math.round(Math.min(canvas.w, canvas.h) * 0.86);
  const x = Math.round((canvas.w - side) / 2);
  const y = Math.round((canvas.h - side) / 2);
  const png = await renderArtwork(defs, `<rect width="${canvas.w}" height="${canvas.h}" fill="${RECOGNIZE_BACKGROUND}"/><use href="#${symbol}" x="${x}" y="${y}" width="${side}" height="${side}"/>`, aspectRatio, "1K");
  const meta = await sharp(png).metadata();
  const W = meta.width ?? 1024;
  const H = meta.height ?? 576;
  const s = Math.min(W, H);
  return sharp(png).extract({ left: Math.round((W - s) / 2), top: Math.round((H - s) / 2), width: s, height: s }).png().toBuffer();
}

/** The library with one symbol replaced (its new gradients added, renamed when an id is taken). */
export function replaceSymbol(defs: string, id: string, symbol: string, extras: ReadonlyMap<string, string>, round = 1): string {
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`<symbol\\b[^>]*\\bid\\s*=\\s*["']${esc}["'][^>]*>[\\s\\S]*?</symbol>`);
  const taken = splitLibrary(defs).extras;
  // a gradient id the library already uses for something else gets a "-a1NN" suffix
  const named = namespaced({ symbol, extras: new Map(extras), attempt: 100 + round, problems: [] }, taken);
  const fresh = [...named.extras].filter(([k]) => !taken.has(k)).map(([, v]) => v);
  const body = re.test(defs) ? defs.replace(re, () => named.symbol) : `${defs}\n${named.symbol}`;
  return [...fresh, body].join("\n");
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function recognizeHeroProps(ctx: DirectorContext, plan: Plan, library: CastLibrary, aspectRatio: string, carried: readonly Recognition[] = []): Promise<{ library: CastLibrary; results: Recognition[] }> {
  const all = heroSymbols(plan);
  if (!all.length) return { library, results: [] };
  // a take on an approved preview's cast: what the preview already checked is carried over, not re-spent (owner 2026-10-12)
  const kept = all.flatMap((t) => carried.filter((r) => r.symbol === t.symbol));
  if (kept.length) await recordStep(ctx, { role: "critic", model: "preview", action: "recognize:carried", summary: `Recognition carried over from the approved preview: ${kept.map((r) => `#${r.symbol} ${r.ok === true ? "recognised" : r.ok === false ? "NOT recognised" : "not checked"} ("${r.saw}")`).join(" · ")}` });
  const targets = all.filter((t) => !kept.some((r) => r.symbol === t.symbol));
  if (!targets.length) return { library, results: kept };
  if (!ctx.visionAvailable || !ctx.models.vision) {
    await recordStep(ctx, { role: "critic", model: "engine", action: "recognize:skipped", summary: `Hero-prop recognition not run: no vision model in this run (${targets.map((t) => `#${t.symbol}`).join(", ")} not checked)` });
    return { library, results: [...kept, ...targets.map((t) => ({ symbol: t.symbol, prop: t.member.id.split("--")[0], state: t.state?.id ?? null, ok: null, saw: "", redraws: 0 }))] };
  }
  let defs = library.defs;
  const results: Recognition[] = [...kept];
  // the base symbol comes first: its member is the planned prop itself
  const prop = all[0].member;
  for (const t of targets) {
    let ok: boolean | null = null;
    let saw: ObjectName = { name: "", description: "" };
    let redraws = 0;
    for (let k = 0; ; k++) {
      const png = await renderAlone(defs, t.symbol, aspectRatio, ctx.canvas);
      const { uri, jpeg } = await toJpegDataUri(png, 768);
      const imagePath = snapshotPath(ctx.projectId, ctx.runId, `recognize-${t.symbol}-${k}.jpg`);
      await saveBuffer(imagePath, jpeg);
      try {
        saw = await callJson(ctx, { role: "critic", action: "recognize", model: ctx.models.vision, system: nameObjectSystem(), user: nameObjectUser(), images: [uri], maxTokens: 300, temperature: 0.1, thinking: false, attempt: k, imagePath }, objectNameSchema, "object_name", 1);
        const verdict = await callJson(ctx, { role: "critic", action: "recognize:check", model: ctx.models.fast, system: propCheckSystem(), user: propCheckUser({ name: prop.name, look: prop.look, state: t.state, saw }), maxTokens: 300, temperature: 0.1, thinking: false, attempt: k }, propCheckSchema, "prop_check", 1);
        ok = verdict.match;
        await recordStep(ctx, {
          role: "critic",
          model: `${ctx.models.vision} → ${ctx.models.fast}`,
          action: "recognize:verdict",
          attempt: k,
          summary: `#${t.symbol}${t.state ? ` (${t.state.id})` : ""} alone, named "${saw.name}": ${ok ? "recognised" : "NOT recognised"} as ${prop.name} — ${verdict.reason}`,
          imagePath,
          error: ok ? null : `viewer saw "${saw.name}": ${saw.description}`,
        });
      } catch (e) {
        if (!(e instanceof ReplyInvalidError || e instanceof LlmError)) throw e;
        await recordStep(ctx, { role: "critic", model: ctx.models.vision, action: "recognize:error", attempt: k, summary: `Recognition of #${t.symbol} failed to run`, error: errText(e), imagePath });
        ok = null;
        break;
      }
      if (ok || k >= MAX_REDRAWS) break;
      // a miss: the Cast redraws this one symbol with what the viewer saw
      redraws++;
      const previous = splitLibrary(defs).symbols.get(t.symbol) ?? "";
      const out = await callModel(ctx, { role: "cast", action: "defs:recognize", system: castSystem(ctx.canvas, ctx.options.style), user: castRecognizeUser(plan, t.member, saw, previous), attempt: k, maxTokens: 12000, temperature: 0.5 });
      try {
        const drawn = extractSvgFragment(out.text);
        sanitizeSvg(drawn, "defs");
        const lib = splitLibrary(drawn);
        const symbol = lib.symbols.get(t.symbol);
        const problems = await symbolProblems({ ...t.member, id: t.symbol }, symbol, lib.extras, ctx.canvas, aspectRatio, new Set(symbolIds(defs)), true);
        if (!symbol || problems.length) throw new Error(problems.join("; ") || `no <symbol id="${t.symbol}">`);
        defs = replaceSymbol(defs, t.symbol, symbol, neededExtras(symbol, lib.extras), redraws);
        await recordStep(ctx, { role: "cast", model: out.model, action: "defs:recognize", attempt: k, summary: `#${t.symbol} redrawn after the viewer saw "${saw.name}"` });
      } catch (e) {
        await recordStep(ctx, { role: "cast", model: out.model, action: "defs:recognize:invalid", attempt: k, summary: `Redraw of #${t.symbol} rejected; the previous drawing stays`, error: errText(e) });
      }
    }
    results.push({ symbol: t.symbol, prop: prop.id, state: t.state?.id ?? null, ok, saw: saw.name, redraws });
  }
  if (defs !== library.defs) await prisma.project.update({ where: { id: ctx.projectId }, data: { artworkDefs: defs } });
  return { library: { ...library, defs, symbols: symbolIds(defs) }, results };
}
