import { prisma } from "@/lib/db";
import { LlmError } from "@/lib/providers/types";
import { sanitizeSvg } from "@/lib/services/svgRenderer";
import { saveBuffer } from "@/lib/services/storage";
import { callJson, callModel, recordStep, ReplyInvalidError, type DirectorContext } from "@/lib/services/director/context";
import { castRecognizeUser, castSystem, nameObjectSystem, nameObjectUser, propCheckSystem, propCheckUser } from "@/lib/services/director/prompts";
import { objectNameSchema, propCheckSchema, type Anatomy, type CastMember, type ObjectName, type Plan, type PropCheck } from "@/lib/services/director/schemas";
import { heroProp, stateMembers, stateSymbol } from "@/lib/services/director/plan";
import { extractSvgFragment, neededExtras, splitLibrary, symbolIds, toJpegDataUri } from "@/lib/services/director/svgTools";
import { namespaced, renderAlone, snapshotPath, symbolProblems, type CastLibrary } from "@/lib/services/director/cast";

export { renderAlone, RECOGNIZE_BACKGROUND } from "@/lib/services/director/cast";

/**
 * Hero-prop recognition gate (owner 2026-10-12, A). Generic, no per-film code: each drawing of
 * the story's key object (every state) is rendered ALONE on a plain background, the vision model
 * names it with no story and no hints, Nano reads that description against the object's anatomy
 * (`propCheckSchema`), and the engine applies the pass rule (`propVerdict`). On a miss the Cast
 * redraws that symbol with what the viewer saw as feedback (at most MAX_REDRAWS accepted redraws;
 * a redraw the engine rejects is retried once with its problem and does not cost a look). Every look,
 * check and redraw is a trace step. Without a vision model the gate cannot run: it says so in the
 * trace and reports "not checked" (null), never a pass.
 */

/** Redraws of a key-object drawing the viewer did not recognise (owner 2026-10-12, round 3: 2 → 4). */
export const MAX_REDRAWS = 4;

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

/**
 * The pass rule (owner 2026-10-12, round 3): recognised by VISIBLE FEATURES, not the exact name. The
 * object passes when the viewer did not name a look-alike AND their words name its category or show
 * ≥ 2/3 of its anatomy parts; a later state also needs its visible change named. Without an anatomy
 * (a cast from before round 3) the category alone decides.
 */
export function propVerdict(anatomy: Anatomy | null | undefined, stateChecked: boolean, check: PropCheck): { ok: boolean; why: string } {
  const names = new Set((anatomy?.parts ?? []).map((p) => p.part.trim().toLowerCase()));
  const seen = [...new Set(check.parts.map((p) => p.trim().toLowerCase()))].filter((p) => names.has(p));
  const need = Math.ceil((names.size * 2) / 3);
  const byParts = names.size > 0 && seen.length >= need;
  const identity = !check.lookalike && (check.category || byParts);
  const state = !stateChecked || check.stateChange === true;
  const why = [
    check.lookalike ? "named a look-alike" : check.category ? "category named" : names.size ? `${seen.length}/${names.size} parts seen (need ${need})` : "category not named",
    stateChecked ? (check.stateChange ? "state change named" : "state change NOT named") : "",
  ]
    .filter(Boolean)
    .join("; ");
  return { ok: identity && state, why };
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
    // a later state must show its change; the first state is the object itself
    const stateChecked = !!t.state && t.symbol !== prop.id;
    let fresh = true;
    for (let k = 0; ; k++) {
      if (fresh) {
        const png = await renderAlone(defs, t.symbol, aspectRatio, ctx.canvas);
        const { uri, jpeg } = await toJpegDataUri(png, 768);
        const imagePath = snapshotPath(ctx.projectId, ctx.runId, `recognize-${t.symbol}-${k}.jpg`);
        await saveBuffer(imagePath, jpeg);
        try {
          saw = await callJson(ctx, { role: "critic", action: "recognize", model: ctx.models.vision, system: nameObjectSystem(), user: nameObjectUser(), images: [uri], maxTokens: 300, temperature: 0.1, thinking: false, attempt: k, imagePath }, objectNameSchema, "object_name", 1);
          const check = await callJson(ctx, { role: "critic", action: "recognize:check", model: ctx.models.fast, system: propCheckSystem(), user: propCheckUser({ name: prop.name, look: prop.look, anatomy: prop.anatomy, state: stateChecked ? t.state : null, saw }), maxTokens: 400, temperature: 0.1, thinking: false, attempt: k }, propCheckSchema, "prop_check", 1);
          const verdict = propVerdict(prop.anatomy, stateChecked, check);
          ok = verdict.ok;
          await recordStep(ctx, {
            role: "critic",
            model: `${ctx.models.vision} → ${ctx.models.fast}`,
            action: "recognize:verdict",
            attempt: k,
            summary: `#${t.symbol}${t.state ? ` (${t.state.id})` : ""} alone, named "${saw.name}": ${ok ? "recognised" : "NOT recognised"} as ${prop.name} — ${verdict.why}. ${check.reason}`,
            imagePath,
            error: ok ? null : `viewer saw "${saw.name}": ${saw.description}`,
          });
        } catch (e) {
          if (!(e instanceof ReplyInvalidError || e instanceof LlmError)) throw e;
          await recordStep(ctx, { role: "critic", model: ctx.models.vision, action: "recognize:error", attempt: k, summary: `Recognition of #${t.symbol} failed to run`, error: errText(e), imagePath });
          ok = null;
          break;
        }
      }
      if (ok || redraws >= MAX_REDRAWS) break;
      // a miss: the Cast redraws this one symbol with what the viewer saw; a redraw the engine rejects
      // (too few shapes, broken markup) is retried once with that problem before it counts
      redraws++;
      const previous = splitLibrary(defs).symbols.get(t.symbol) ?? "";
      let rejected: string | null = null;
      fresh = false;
      for (let r = 0; r < 2 && !fresh; r++) {
        const out = await callModel(ctx, { role: "cast", action: "defs:recognize", system: castSystem(ctx.canvas, ctx.options.style), user: castRecognizeUser(plan, t.member, saw, previous, rejected), attempt: k, maxTokens: 12000, temperature: 0.5 });
        try {
          const drawn = extractSvgFragment(out.text);
          sanitizeSvg(drawn, "defs");
          const lib = splitLibrary(drawn);
          const symbol = lib.symbols.get(t.symbol);
          const problems = await symbolProblems({ ...t.member, id: t.symbol }, symbol, lib.extras, ctx.canvas, aspectRatio, new Set(symbolIds(defs)), true);
          if (!symbol || problems.length) throw new Error(problems.join("; ") || `no <symbol id="${t.symbol}">`);
          defs = replaceSymbol(defs, t.symbol, symbol, neededExtras(symbol, lib.extras), redraws * 2 + r);
          fresh = true;
          await recordStep(ctx, { role: "cast", model: out.model, action: "defs:recognize", attempt: k, summary: `#${t.symbol} redrawn (${redraws}/${MAX_REDRAWS}${r ? ", after one rejected try" : ""}) after the viewer saw "${saw.name}"` });
        } catch (e) {
          rejected = errText(e);
          await recordStep(ctx, { role: "cast", model: out.model, action: "defs:recognize:invalid", attempt: k, summary: r === 0 ? `Redraw of #${t.symbol} rejected; retried once with the problem (not counted as a look)` : `Redraw of #${t.symbol} rejected twice; the previous drawing stays`, error: rejected });
        }
      }
    }
    results.push({ symbol: t.symbol, prop: prop.id, state: t.state?.id ?? null, ok, saw: saw.name, redraws });
  }
  if (defs !== library.defs) await prisma.project.update({ where: { id: ctx.projectId }, data: { artworkDefs: defs } });
  return { library: { ...library, defs, symbols: symbolIds(defs) }, results };
}
