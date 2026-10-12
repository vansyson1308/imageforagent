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

/** Lowercase word stems (a trailing plural / -ed / -ing dropped), for matching a viewer's words. */
export function stems(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (w.length < 3) continue;
    out.add(w.length > 5 && w.endsWith("ing") ? w.slice(0, -3) : w.length > 4 && w.endsWith("ed") ? w.slice(0, -2) : w.length > 4 && w.endsWith("es") ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w);
  }
  return out;
}

/** The head noun of a category or look-alike phrase: "rice cake wrapped in leaves" → cake, "paper-strip chime" → chime. */
export function headNoun(phrase: string): string {
  const words = phrase.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const cut = words.findIndex((w, i) => i > 0 && /^(in|with|of|on|wrapped|tied|made|from|for|hanging|under)$/.test(w));
  const head = (cut > 0 ? words.slice(0, cut) : words).at(-1) ?? "";
  return [...stems(head)][0] ?? head;
}

/** Words that say nothing about a state's change on their own (colours, sizes, generic shapes). */
const NOT_A_CHANGE = new Set(["the", "and", "with", "its", "now", "same", "still", "one", "two", "into", "over", "from", "that", "this", "visible", "small", "big", "large", "little", "long", "short", "thin", "white", "red", "blue", "green", "yellow", "gold", "black", "brown", "grey", "gray", "pink", "orange", "purple", "beige", "light", "dark", "bright", "shape", "line", "object", "side", "top", "bottom", "centre", "center", "clearly", "slightly", "very"]);

/**
 * The pass rule (owner 2026-10-12, round 3): recognised by VISIBLE FEATURES, not the exact name. The
 * object passes when the viewer did not name a look-alike AND their words name its category or show
 * ≥ 2/3 of its anatomy parts; a later state also needs its visible change named. Nano reports; the
 * engine decides, and checks Nano's claims against the viewer's own words (round 3 previews: Nano
 * passed "a white flower on a stick" as a wind chime, and a kite state that was never drawn):
 * - category: some category's head noun ("chime", "bell", "kite", "cake") is in the viewer's words;
 * - look-alike: the viewer's NAME holds a listed look-alike's head noun ("flower") → a look-alike;
 * - state: the state was actually drawn (not the base drawing standing in), and the viewer's words
 *   share a word with that state's change that the base anatomy does not already have.
 * Without an anatomy (a cast from before round 3) Nano's category alone decides.
 */
export function propVerdict(anatomy: Anatomy | null | undefined, check: PropCheck, opts: { saw?: ObjectName; state?: { id: string; change: string; drawn: boolean } | null } = {}): { ok: boolean; identity: boolean; why: string } {
  const names = new Set((anatomy?.parts ?? []).map((p) => p.part.trim().toLowerCase()));
  const seen = [...new Set(check.parts.map((p) => p.trim().toLowerCase()))].filter((p) => names.has(p));
  const need = Math.ceil((names.size * 2) / 3);
  const words = stems(`${opts.saw?.name ?? ""} ${opts.saw?.description ?? ""}`);
  const nameWords = stems(opts.saw?.name ?? "");
  const verified = !anatomy || !opts.saw;
  const categoryHeard = verified || anatomy!.category.some((c) => words.has(headNoun(c)));
  const lookalikeHeard = !verified && anatomy!.notLike.some((c) => nameWords.has(headNoun(c)));
  // the viewer's NAME holds a category head noun ("kite") and no look-alike's: Nano's look-alike flag is overruled
  // (round-4 kite: "kite" was flagged a look-alike)
  const nameHasCategory = !verified && anatomy!.category.some((c) => nameWords.has(headNoun(c)));
  const lookalike = (check.lookalike && !nameHasCategory) || lookalikeHeard;
  const category = check.category && categoryHeard;
  const byParts = names.size > 0 && seen.length >= need;
  const identity = !lookalike && (category || byParts);
  let state = true;
  let stateWhy = "";
  if (opts.state) {
    const base = stems((anatomy?.parts ?? []).map((p) => `${p.part} ${p.look}`).join(" "));
    const changeWords = [...stems(`${opts.state.id} ${opts.state.change}`)].filter((w) => !NOT_A_CHANGE.has(w) && !base.has(w));
    const heard = verified || !changeWords.length || changeWords.some((w) => words.has(w));
    state = opts.state.drawn && check.stateChange === true && heard;
    stateWhy = !opts.state.drawn ? "state NOT drawn (the base drawing stands in)" : check.stateChange && heard ? "state change named" : "state change NOT named";
  }
  const why = [
    lookalike ? `named a look-alike${lookalikeHeard && !check.lookalike ? ` ("${opts.saw?.name}")` : ""}` : category ? "category named" : check.category && !categoryHeard ? "no category word in the viewer's words" : names.size ? `${seen.length}/${names.size} parts seen (need ${need})` : "category not named",
    stateWhy,
  ]
    .filter(Boolean)
    .join("; ");
  return { ok: identity && state, identity, why };
}

/** A state symbol that only places the base drawing (the Cast never drew the state, or it rendered blank). */
export function isBaseStandIn(defs: string, symbol: string, base: string): boolean {
  const body = splitLibrary(defs).symbols.get(symbol) ?? "";
  return new RegExp(`^<symbol\\b[^>]*>\\s*<use\\s+href="#${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*/>\\s*</symbol>$`).test(body.trim());
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

export async function recognizeHeroProps(ctx: DirectorContext, plan: Plan, library: CastLibrary, aspectRatio: string, carried: readonly Recognition[] = [], engineDrawn: ReadonlySet<string> = new Set()): Promise<{ library: CastLibrary; results: Recognition[] }> {
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
    // the best drawing seen so far: a redraw can be worse than the one before it (round-4 kite: the 4th torn
    // redraw lost the kite itself), so a miss keeps the best-rated drawing, not the last (2 = recognised, 1 = the
    // object is recognised but not its state, 0 = not even the object)
    let best: { rank: number; symbol: string; saw: ObjectName } | null = null;
    let lastRank = -1;
    for (let k = 0; ; k++) {
      if (fresh) {
        const png = await renderAlone(defs, t.symbol, aspectRatio, ctx.canvas);
        const { uri, jpeg } = await toJpegDataUri(png, 768);
        const imagePath = snapshotPath(ctx.projectId, ctx.runId, `recognize-${t.symbol}-${k}.jpg`);
        await saveBuffer(imagePath, jpeg);
        try {
          saw = await callJson(ctx, { role: "critic", action: "recognize", model: ctx.models.vision, system: nameObjectSystem(), user: nameObjectUser(), images: [uri], maxTokens: 300, temperature: 0.1, thinking: false, attempt: k, imagePath }, objectNameSchema, "object_name", 1);
          const check = await callJson(ctx, { role: "critic", action: "recognize:check", model: ctx.models.fast, system: propCheckSystem(), user: propCheckUser({ name: prop.name, look: prop.look, anatomy: prop.anatomy, state: stateChecked ? t.state : null, saw }), maxTokens: 400, temperature: 0.1, thinking: false, attempt: k }, propCheckSchema, "prop_check", 1);
          const change = prop.anatomy?.states.find((x) => x.id === t.state?.id)?.change ?? t.state?.look ?? "";
          const verdict = propVerdict(prop.anatomy, check, { saw, state: stateChecked && t.state ? { id: t.state.id, change, drawn: !isBaseStandIn(defs, t.symbol, prop.id) } : null });
          ok = verdict.ok;
          lastRank = verdict.ok ? 2 : verdict.identity ? 1 : 0;
          if (!best || lastRank > best.rank) best = { rank: lastRank, symbol: splitLibrary(defs).symbols.get(t.symbol) ?? "", saw };
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
      // an engine-drawn state (D77: tear/patch on the approved base) is never handed back to the Cast: the gate only reports
      if (engineDrawn.has(t.symbol)) {
        await recordStep(ctx, { role: "critic", model: "engine", action: "recognize:engine-drawn", summary: `#${t.symbol} is drawn by the engine on the approved base: not redrawn by the Cast; the owner and QC judge it by eye` });
        break;
      }
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
    if (ok === false && best && best.symbol && best.rank > lastRank) {
      defs = replaceSymbol(defs, t.symbol, best.symbol, splitLibrary(defs).extras, 99);
      saw = best.saw;
      await recordStep(ctx, { role: "cast", model: "engine", action: "recognize:kept-best", summary: `#${t.symbol}: kept the best drawing of the round (the viewer saw "${best.saw.name}"), not the last redraw`, error: "still not recognised" });
    }
    results.push({ symbol: t.symbol, prop: prop.id, state: t.state?.id ?? null, ok, saw: saw.name, redraws });
  }
  if (defs !== library.defs) await prisma.project.update({ where: { id: ctx.projectId }, data: { artworkDefs: defs } });
  return { library: { ...library, defs, symbols: symbolIds(defs) }, results };
}
