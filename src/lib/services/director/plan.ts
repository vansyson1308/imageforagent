import { prisma } from "@/lib/db";
import { parseTsv } from "@/lib/services/tsvParser";
import { replaceScript } from "@/lib/services/frameWrites";
import { callJson, recordStep, type DirectorContext } from "@/lib/services/director/context";
import { planSchema, type Plan } from "@/lib/services/director/schemas";
import { directorSystem, directorUser } from "@/lib/services/director/prompts";
import { lockSeriesCast, seriesBrief, type SeriesData } from "@/lib/services/director/series";
import type { Frame } from "@/generated/prisma/client";

/** Director (Ultra): story → validated Plan (shot list + Cast & Set Bible). */
export async function runPlan(ctx: DirectorContext, story: string, references: string | null, referenceCount = 0, series: SeriesData | null = null, narration: readonly string[] | null = null): Promise<Plan> {
  const seriesNote = [series ? seriesBrief(series) : null, narration ? narrationBrief(narration) : null].filter(Boolean).join("\n\n") || null;
  // series episodes: lock the recurring cast BEFORE normalising, so a recurring id the plan forgot to list isn't dropped from its shots
  // narrated episodes: each shot's narration is fixed to its line (the plan only stages it)
  const lock = (p: Plan) => {
    const locked = series ? lockSeriesCast(p, series) : p;
    return narration ? withNarration(locked, narration) : locked;
  };
  const maxShots = ctx.budget.budget.maxShots;
  const minShots = narration ? Math.min(narration.length, maxShots) : Math.min(ctx.options.minShots, maxShots);
  const plan = await callJson(
    ctx,
    {
      role: "director",
      action: "plan",
      system: directorSystem({ minShots, maxShots, language: ctx.options.language, style: ctx.options.style }),
      user: directorUser(story, references, seriesNote),
      maxTokens: 8000,
      temperature: 0.6,
    },
    planSchema,
    "film_plan",
  );
  let best = normalizePlan(lock(plan), maxShots, references ? referenceCount : 0);
  // Coverage (WP4.2): a film, not a slideshow. One measured retry; the plan with fewer problems wins.
  const problems = coverageProblems(best, minShots);
  if (problems.length) {
    await recordStep(ctx, { role: "director", model: ctx.models.strong, action: "plan:coverage", summary: `Coverage check failed (${problems.length})`, error: problems.join("; ") });
    try {
      const retry = await callJson(
        ctx,
        {
          role: "director",
          action: "plan:retry",
          system: directorSystem({ minShots, maxShots, language: ctx.options.language, style: ctx.options.style }),
          user: `${directorUser(story, references, seriesNote)}\n\nYour previous plan was rejected by the coverage check: ${problems.join("; ")}. Fix exactly these points and keep the story.`,
          maxTokens: 8000,
          temperature: 0.5,
        },
        planSchema,
        "film_plan",
        1,
      );
      const second = normalizePlan(lock(retry), maxShots, references ? referenceCount : 0);
      const left = coverageProblems(second, minShots);
      if (left.length < problems.length) best = second;
      await recordStep(ctx, { role: "director", model: ctx.models.strong, action: "plan:coverage", summary: left.length < problems.length ? `Coverage fixed: ${problems.length} → ${left.length} problem(s)` : `Retry not better (${left.length} problem(s)); kept the first plan` });
    } catch {
      // keep the first plan; the film goes on
    }
  }
  const withSets = ensureSets(best);
  if (withSets.added.length) {
    best = withSets.plan;
    await recordStep(ctx, { role: "director", model: "engine", action: "plan:sets", summary: `The plan had no set: the engine added ${withSets.added.join(", ")}${withSets.dropped.length ? ` and dropped the least-used prop(s) ${withSets.dropped.map((d) => `#${d}`).join(", ")} to make room` : ""}` });
  }
  return best;
}

/** The Director's brief for a narrated episode: one shot per line, in order. */
export function narrationBrief(lines: readonly string[]): string {
  return [
    `This episode is NARRATED (read aloud). Plan EXACTLY ${lines.length} shots: shot N illustrates narration line N, in order. Set each shot's "dialogue" to its line exactly and "speaker" to null (the narrator); the engine enforces it.`,
    ...lines.map((l, i) => `${i + 1}. ${l}`),
  ].join("\n");
}

/**
 * A narrated episode's plan: shot N speaks line N (narrator), exactly. Extra
 * shots lose their narration; if the plan has fewer shots, the remaining
 * lines join the last shot, so no line is dropped.
 */
export function withNarration(plan: Plan, lines: readonly string[]): Plan {
  const n = plan.shots.length;
  return {
    ...plan,
    shots: plan.shots.map((s, i) => {
      const text = i < n - 1 ? (lines[i] ?? null) : lines.slice(i).join("") || null;
      return { ...s, dialogue: text, speaker: null };
    }),
  };
}

/** The story's key object: the prop in the most shots (at least 2; ties go to the Bible's order). Null if none. */
export function heroProp(plan: Plan): string | null {
  let best: string | null = null;
  let n = 1;
  for (const c of plan.cast) {
    if (c.kind !== "prop") continue;
    const k = plan.shots.filter((s) => s.cast.includes(c.id)).length;
    if (k > n) {
      best = c.id;
      n = k;
    }
  }
  return best;
}

/** Shot-size class of a storyboard shot type (EN/VI/JA keywords). */
export function shotSize(shotType: string): "wide" | "medium" | "close" | "insert" | "other" {
  const s = shotType.toLowerCase();
  if (/insert|detail|chi tiết|extreme close|macro/.test(s)) return "insert";
  if (/close|cận|アップ|クローズ/.test(s)) return "close";
  if (/medium|trung|waist|two[- ]shot|over[- ]the|ミディアム|バスト/.test(s)) return "medium";
  if (/wide|establish|toàn|long|rộng|aerial|bird|ロング|全景/.test(s)) return "wide";
  return "other";
}

/**
 * Measured coverage problems of a plan (empty = OK): at least `minShots` shots, varied shot sizes,
 * no consecutive duplicates (same size + same cast), and for 6+ shots at
 * least 2 distinct set areas/angles and an establishing wide shot.
 */
export function coverageProblems(plan: Plan, minShots = 0): string[] {
  const shots = plan.shots;
  const out: string[] = [];
  // a story cut to one or two shots is not a film (bench v2: Super planned 1 shot of the 5 asked, and nothing caught it)
  if (shots.length < minShots) out.push(`the plan has only ${shots.length} shot(s): plan at least ${minShots} shots that tell the whole story, beginning to end`);
  if (shots.length < 4) return out;
  const sizes = shots.map((s) => shotSize(s.shotType));
  const distinct = new Set(sizes.filter((x) => x !== "other"));
  if (distinct.size < 3) out.push(`only ${distinct.size} shot size(s) (${[...distinct].join(", ") || "none"}): use wide, medium AND close-up (and an insert of a key prop)`);
  const pairs: string[] = [];
  for (let i = 1; i < shots.length; i++) {
    const same = sizes[i] === sizes[i - 1] && [...shots[i].cast].sort().join() === [...shots[i - 1].cast].sort().join() && !shots[i].intentionalRepeat;
    if (same) pairs.push(`${i} and ${i + 1}`);
  }
  if (pairs.length) out.push(`shots ${pairs.slice(0, 4).join(", ")}${pairs.length > 4 ? ` (+${pairs.length - 4} more)` : ""} have the same size (${sizes[Number(pairs[0].split(" ")[0])]}) and the same cast: change the size or the angle`);
  // the story's key object gets its own insert (owner QC 2026-10-10): the prop seen in the most shots
  const hero = heroProp(plan);
  if (hero && shots.length >= 5 && !shots.some((s, i) => (sizes[i] === "insert" || sizes[i] === "close") && s.cast.includes(hero))) {
    out.push(`no insert of the key prop #${hero}: make one shot an "Insert" (a close detail of #${hero} filling most of the frame, with the hands that use it)`);
  }
  const misplaced = misplacedShots(plan);
  if (misplaced.length) out.push(`wrong set: ${misplaced.slice(0, 4).map((m) => `shot ${m.shot} is in #${m.set} but ${m.why}`).join("; ")}${misplaced.length > 4 ? ` (+${misplaced.length - 4} more)` : ""}: give each shot the set of the place it describes (add a set for a new place)`);
  // every shot stands in a drawn place (re-shoot 2026-10-11: a plan with 8 props and no set gave 10 set-less shots)
  if (!plan.cast.some((c) => c.kind === "set")) out.push(`the cast has no set: add one member of kind "set" per place (at most ${MAX_SETS}) and put the right set in every shot's cast; the cast holds at most ${MAX_CAST} members, so merge or drop minor props to make room`);
  if (shots.length >= 6) {
    const sets = new Set(shots.map((s) => s.scene.trim().toLowerCase()));
    const setIds = new Set(shots.flatMap((s) => s.cast.filter((id) => plan.cast.some((c) => c.id === id && c.kind === "set"))));
    if (sets.size < 2 && setIds.size < 2) out.push("every shot is in one scene and one set: use at least 2 distinct set areas or camera angles");
    if (!sizes.slice(0, 2).includes("wide")) out.push("no establishing wide shot at the start: open with a wide shot");
  }
  return out.slice(0, 6);
}

/**
 * Deterministic clean-up of a valid plan: cap the shot count (budget), drop
 * cast references to unknown ids, dedupe cast ids, drop citations of notes
 * that don't exist, first shot cuts in.
 */
export function normalizePlan(plan: Plan, maxShots: number, referenceCount = 0): Plan {
  const seen = new Set<string>();
  // citations must point at a real note: drop invented numbers
  const cites = (xs: readonly number[] | undefined) => [...new Set((xs ?? []).filter((n) => n >= 1 && n <= referenceCount))];
  const cast = plan.cast.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true))).map((c) => ({ ...c, cites: cites(c.cites) }));
  const kept = plan.shots.slice(0, Math.max(1, maxShots));
  const shots = kept.map((s, i) => ({
    ...s,
    cast: s.cast.filter((id) => seen.has(id)),
    // gentle transitions: a cut INTO a new scene becomes a dissolve (WP4.6)
    transition: i === 0 ? ("cut" as const) : s.transition === "cut" && s.scene.trim() !== kept[i - 1].scene.trim() ? ("dissolve" as const) : s.transition,
    cites: cites(s.cites),
  }));
  // every shot stands in a place: a shot whose cast names no set takes the set of its scene, else the nearest shot's (VI showcase run 3, shot 2: no set → a flat cream background)
  const sets = new Set(cast.filter((c) => c.kind === "set").map((c) => c.id));
  const setOf = (i: number) => shots[i]?.cast.find((id) => sets.has(id));
  if (sets.size) {
    const own = shots.map((_, i) => setOf(i));
    shots.forEach((s, i) => {
      if (own[i]) return;
      const nearest = (js: number[]) => js.sort((a, b) => Math.abs(a - i) - Math.abs(b - i) || a - b)[0];
      const withSet = [...own.keys()].filter((j) => own[j]);
      const j = nearest(withSet.filter((k) => shots[k].scene.trim() === s.scene.trim())) ?? nearest(withSet);
      const pick = j === undefined ? undefined : own[j];
      if (pick) s.cast = [...s.cast, pick];
    });
  }
  return { ...plan, cast, shots };
}

const OUTDOOR_WORDS = /\b(beach|sand|sandy|shore|seafront|seaside|waterfront|street|road|field|meadow|park|forest|woods|mountain|hillside|riverbank|pier|harbou?r|market square|rooftop)\b|bãi biển|bờ biển|cát|đường phố|cánh đồng|浜|海辺|砂浜|通り|野原|山道/iu;
const INDOOR_WORDS = /\b(kitchen|bedroom|living room|classroom|room|caf[eé]|kissaten|shop|office|hall|indoors|inside|interior|at the table)\b|nhà bếp|phòng|trong nhà|台所|部屋|室内|店内|喫茶/iu;
const words = (t: string) => t.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4);

/**
 * Shots whose set contradicts their own words (re-shoot 2026-10-11, kite: shots 8-11 on the
 * beach were given #kitchen): the description names another set but not its own, or describes
 * an outdoor place while its set is an indoor one.
 */
export function misplacedShots(plan: Pick<Plan, "cast" | "shots">): Array<{ shot: number; set: string; why: string }> {
  const sets = plan.cast.filter((c) => c.kind === "set");
  if (sets.length < 1) return [];
  const keys = new Map(sets.map((c) => [c.id, new Set([...words(c.name), ...words(c.id.replace(/-/g, " "))])] as const));
  const indoor = (c: (typeof sets)[number]) => INDOOR_WORDS.test(`${c.name} ${c.id.replace(/-/g, " ")}`) || (INDOOR_WORDS.test(c.look.split(/[.;]/)[0]) && !OUTDOOR_WORDS.test(c.look.split(/[.;]/)[0]));
  const out: Array<{ shot: number; set: string; why: string }> = [];
  plan.shots.forEach((s, i) => {
    const own = sets.find((c) => s.cast.includes(c.id));
    if (!own) return;
    // the first two sentences say where the shot is ("Afternoon light, warmer. Maya and Grandfather walk along the beach…")
    const text = s.description.split(/(?<=[.!?。])\s*/u).slice(0, 2).join(" ") || s.description;
    const said = new Set(words(text));
    const names = (id: string) => [...(keys.get(id) ?? [])].some((w) => said.has(w));
    const other = sets.find((c) => c.id !== own.id && names(c.id));
    if (other && !names(own.id)) out.push({ shot: i + 1, set: own.id, why: `it describes #${other.id}` });
    else if (indoor(own) && OUTDOOR_WORDS.test(text) && !INDOOR_WORDS.test(text)) out.push({ shot: i + 1, set: own.id, why: `it describes an outdoor place ("${text.match(OUTDOOR_WORDS)?.[0]}")` });
  });
  return out;
}

/** The plan's cast limit (schemas.ts) and how many sets the engine adds when a plan has none. */
export const MAX_CAST = 8;
export const MAX_SETS = 2;

/** The place part of a scene heading: "Chiều Ba Mươi - Sân nhà" → "Sân nhà", "夏の昼・町家" → "町家". */
export function scenePlace(scene: string): string {
  const parts = scene.split(/\s+[-–—|:]\s+|[・／/|]/u).map((p) => p.trim()).filter(Boolean);
  return (parts.at(-1) ?? scene).trim();
}

/**
 * A plan with no set gets sets from the engine: one per place its scenes name (the
 * most-used first, at most MAX_SETS), described by the scene and its first shot, so
 * the Cast designs them from the kit like any set. Room in the cast comes from the
 * props seen in the fewest shots (never the key prop). Every shot then stands in the
 * set of its place, or of the nearest shot that has one. Returns the plan unchanged
 * when it already has a set.
 */
export function ensureSets(plan: Plan): { plan: Plan; added: string[]; dropped: string[] } {
  if (plan.cast.some((c) => c.kind === "set")) return { plan, added: [], dropped: [] };
  const byPlace = new Map<string, number[]>();
  plan.shots.forEach((s, i) => byPlace.set(scenePlace(s.scene), [...(byPlace.get(scenePlace(s.scene)) ?? []), i]));
  const places = [...byPlace.entries()].sort((a, b) => b[1].length - a[1].length || a[1][0] - b[1][0]).slice(0, MAX_SETS);
  const hero = heroProp(plan);
  const uses = (id: string) => plan.shots.filter((s) => s.cast.includes(id)).length;
  const spare = MAX_CAST - plan.cast.length;
  const need = Math.max(0, places.length - spare);
  const dropped = plan.cast
    .filter((c) => c.kind === "prop" && c.id !== hero)
    .sort((a, b) => uses(a.id) - uses(b.id) || plan.cast.indexOf(b) - plan.cast.indexOf(a))
    .slice(0, need)
    .map((c) => c.id);
  const room = Math.min(places.length, spare + dropped.length);
  const sets = places.slice(0, room).map(([place, idx], k) => ({
    id: `set-${k + 1}`,
    name: place.slice(0, 60),
    kind: "set" as const,
    look: `The place "${place}" where these shots happen: ${plan.shots[idx[0]].description}`.slice(0, 500),
    colors: plan.palette.slice(0, 3).length ? plan.palette.slice(0, 3) : ["#8a6a4a"],
  }));
  if (!sets.length) return { plan, added: [], dropped: [] };
  const setOfPlace = new Map(places.slice(0, room).map(([place], k) => [place, sets[k].id] as const));
  const own = plan.shots.map((s) => setOfPlace.get(scenePlace(s.scene)));
  const withSet = own.flatMap((x, j) => (x ? [j] : []));
  const shots = plan.shots.map((s, i) => {
    const near = own[i] ?? own[[...withSet].sort((a, b) => Math.abs(a - i) - Math.abs(b - i) || a - b)[0]];
    return { ...s, cast: [...s.cast.filter((id) => !dropped.includes(id)), ...(near ? [near] : [])] };
  });
  const cast = [...plan.cast.filter((c) => !dropped.includes(c.id)), ...sets];
  return { plan: { ...plan, cast, shots }, added: sets.map((x) => `#${x.id} (${x.name})`), dropped };
}

/** TSV cell: tabs/newlines/quotes cannot break the row format. */
const cell = (s: string) => s.replace(/[\t\r\n]+/g, " ").replace(/"/g, "'").trim();

export function planToTsv(plan: Plan): string {
  return plan.shots.map((s, i) => `${i + 1}\t${cell(s.shotType)}\t${cell(s.description)}`).join("\n");
}

/**
 * Write the plan through the same script path a human import uses (parseTsv
 * → replaceScript), then set per-frame scene + transition and the project's
 * still duration.
 */
export async function writeScript(ctx: DirectorContext, plan: Plan): Promise<Frame[]> {
  const parsed = parseTsv(planToTsv(plan));
  if (!parsed.ok) throw new Error(`Plan did not survive the TSV parser: ${parsed.errors.map((e) => e.message).join("; ")}`);
  const frames = await replaceScript(ctx.projectId, parsed.frames);
  for (const f of frames) {
    const s = plan.shots[f.index - 1];
    await prisma.frame.update({
      where: { id: f.id },
      data: { scene: s.scene.slice(0, 120), transition: s.transition, transitionDuration: s.transition === "cut" ? 0.5 : 0.8 },
    });
  }
  await prisma.project.update({ where: { id: ctx.projectId }, data: { name: plan.title.slice(0, 120) } });
  return prisma.frame.findMany({ where: { projectId: ctx.projectId }, orderBy: { index: "asc" } });
}
