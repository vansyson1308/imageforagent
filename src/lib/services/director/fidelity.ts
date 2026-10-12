import type { Critique, Plan, ShotPlan } from "@/lib/services/director/schemas";

/**
 * Plan-vs-render fidelity (owner QC 2026-10-10, sprint b): the time of day,
 * the place and the key action the plan asks for must be what the render
 * shows. "Đêm Ba Mươi" (New Year's Eve night) rendered in daylight fails.
 *
 * Two layers: the engine fixes what it can decide from words alone (a kit set
 * lit for the wrong time of day), and Nano gives a per-axis verdict from the
 * plan, the story, the vision model's "sees" and the measured brightness. Any
 * "wrong" axis caps the score below the accept bar, so the loop revises it.
 */

export const NIGHT_WORDS = /\b(night|midnight|moonlit|moonlight|at dusk|evening|dark)\b|đêm|tối|trăng|夜|晩|月明|闇/i;
/** Daytime words. Vietnamese "sáng" alone also means "bright", so only the unambiguous phrases count. */
export const DAY_WORDS = /\b(day|morning|noon|midday|afternoon|sunny|sunlit|sunlight|sunshine|daylight|daytime|sunrise)\b|buổi sáng|sáng sớm|ban ngày|buổi trưa|buổi chiều|朝|昼|午後|日中/i;
/** The plan's own mood word when it names a time (re-shoot 2026-10-11, fūrin run 4: "Summer day, bright sunlight…" with mood "day"). */
const MOOD_TIME: Record<string, "day" | "night"> = { day: "day", daytime: "day", morning: "day", noon: "day", afternoon: "day", sunny: "day", night: "night", midnight: "night", evening: "night", nighttime: "night" };

export type PlannedTime = "night" | "day" | null;

/** The time of day a shot's own words ask for (null = not stated, or both stated). */
export function shotTime(shot: Pick<ShotPlan, "scene" | "description"> & { readonly mood?: string | null }): PlannedTime {
  const text = `${shot.scene} ${shot.description}`;
  const night = NIGHT_WORDS.test(text);
  const day = DAY_WORDS.test(text);
  if (night !== day) return night ? "night" : "day";
  // the words don't decide: the plan's mood, when it names a time
  return MOOD_TIME[(shot.mood ?? "").trim().toLowerCase()] ?? null;
}

/**
 * A kit set lit for the wrong time of day, decided by the shots that use it:
 * mostly night shots on a day/golden/dawn set → night; mostly day shots on a
 * night set → day. Returns null when the set's time already fits.
 */
export function setTimeFix(plan: Pick<Plan, "shots">, setId: string, time: string): { time: "night" | "day"; note: string } | null {
  const uses = plan.shots.filter((s) => s.cast.includes(setId));
  const nights = uses.filter((s) => shotTime(s) === "night").length;
  const days = uses.filter((s) => shotTime(s) === "day").length;
  if (nights > days && time !== "night" && time !== "dusk") return { time: "night", note: `set lit for "${time}" but ${nights} of its ${uses.length} shot(s) are at night → night` };
  if (days > nights && time === "night") return { time: "day", note: `set lit for night but ${days} of its ${uses.length} shot(s) are in daytime → day` };
  return null;
}

/**
 * A set lit for `lit` is wrong for a shot planned at `want`: a night shot needs night or dusk light;
 * a day shot needs the DAY bucket (dawn, day, golden), so a dusk-lit set is wrong for it too (D71:
 * day vs dusk blocks; preview 2026-10-12, the kite's beach was lit at dusk for its morning shots).
 */
function timeMismatch(want: PlannedTime, lit: string | undefined): boolean {
  if (!want || !lit) return false;
  return want === "night" ? lit !== "night" && lit !== "dusk" : lit === "night" || lit === "dusk";
}

/** The id of a set's variant lit for another time of day ("house-veranda--day"). */
export const timedSetId = (setId: string, time: "day" | "night") => `${setId}--${time}`;

/**
 * The other time of day a kit set needs (re-shoot 2026-10-11, fūrin: the veranda was lit for
 * night, its three daytime shots came out at night): the time of the shots that use the set
 * but don't match its light, or null when every shot fits.
 */
export function setTimeVariant(plan: Pick<Plan, "shots">, setId: string, lit: string): "day" | "night" | null {
  const odd = plan.shots.filter((s) => s.cast.includes(setId)).map((s) => shotTime(s)).filter((t) => timeMismatch(t, lit));
  return odd.length ? (odd[0] as "day" | "night") : null;
}

/** The set symbol a shot places: the variant lit for the shot's own time when the base set is lit for the other. */
export function setForShot(shot: Pick<ShotPlan, "scene" | "description">, setId: string, setTimes: ReadonlyMap<string, string>): string {
  const want = shotTime(shot);
  if (!want || !timeMismatch(want, setTimes.get(setId))) return setId;
  const vid = timedSetId(setId, want);
  return setTimes.has(vid) ? vid : setId;
}

/** A drawing with each set swapped for the variant lit for this shot's time (exact `#id` references only). */
export function retimeSets(svg: string, shot: Pick<ShotPlan, "scene" | "description" | "cast">, setTimes: ReadonlyMap<string, string>): string {
  let out = svg;
  for (const id of shot.cast) {
    const use = setForShot(shot, id, setTimes);
    if (use !== id) out = out.replace(new RegExp(`((?:xlink:)?href\\s*=\\s*["'])#${id.replace(/[-]/g, "\\-")}(["'])`, "g"), `$1#${use}$2`);
  }
  return out;
}

/**
 * Time-of-day BUCKETS (owner decision 2026-10-12, D71): dawn, morning, noon, afternoon and the
 * golden late afternoon are ONE bucket, "day"; dusk (sunset, twilight, evening) and night are the
 * others. Only a different bucket is off-plan: morning vs afternoon never is (kite take 2, shot 2).
 */
export type TimeBucket = "day" | "dusk" | "night";

const BUCKET_WORDS: ReadonlyArray<[TimeBucket, RegExp]> = [
  ["dusk", /\b(dusk|sunset|sundown|twilight|evening)\b|hoàng hôn|chạng vạng|chiều tối|夕方|夕暮れ|夕焼け|黄昏/giu],
  ["night", /\b(night|nighttime|midnight|moonlit|moonlight|starry)\b|ban đêm|nửa đêm|đêm|夜|深夜|月夜/giu],
  ["day", /\b(dawn|sunrise|morning|noon|midday|afternoon|daytime|daylight|day|sunny|sunlit|golden hour)\b|bình minh|buổi sáng|ban ngày|buổi trưa|buổi chiều|朝|昼|午後|日中/giu],
];

/** The time words a text names, each with its bucket ("late afternoon, not morning" → afternoon/day, morning/day). */
export function timeWords(text: string): Array<{ word: string; bucket: TimeBucket }> {
  const out: Array<{ word: string; bucket: TimeBucket }> = [];
  let rest = text;
  for (const [bucket, re] of BUCKET_WORDS) {
    for (const m of rest.matchAll(re)) out.push({ word: m[0].toLowerCase(), bucket });
    // a word is counted once, in the first bucket that names it ("midnight" is not also "night")
    rest = rest.replace(re, " ");
  }
  return out;
}

/** The buckets a text names ("late afternoon, not morning" → {day}; "sunset, not afternoon" → {dusk, day}). */
export function bucketsNamed(text: string): Set<TimeBucket> {
  return new Set(timeWords(text).map((w) => w.bucket));
}

/** The bucket a set's kit light belongs to. */
export function setBucket(lit: string | undefined): TimeBucket | null {
  if (!lit) return null;
  return lit === "night" ? "night" : lit === "dusk" ? "dusk" : "day";
}

/** The bucket a shot's own words plan (dusk words win over day/night ones; null = not stated). */
export function plannedBucket(shot: Pick<ShotPlan, "scene" | "description"> & { readonly mood?: string | null }): TimeBucket | null {
  const named = bucketsNamed(`${shot.scene} ${shot.description}`);
  if (named.has("dusk") && !named.has("night")) return "dusk";
  return shotTime(shot);
}

/**
 * Nano's "wrong time" whose note compares two times of ONE bucket ("brightness indicates late
 * afternoon, not morning") is not an off-plan time (D71): the verdict becomes "ok". A note that
 * names one time only ("night not clearly depicted") or two buckets ("sunset, not afternoon") stays.
 */
export function withinBucket(c: Critique): Critique {
  const f = c.fidelity;
  if (!f || f.time !== "wrong") return c;
  // two different times named, both in one bucket: the critic compared morning with afternoon
  const words = timeWords(f.note ?? "");
  const sameBucket = new Set(words.map((w) => w.word)).size >= 2 && new Set(words.map((w) => w.bucket)).size === 1;
  return sameBucket ? { ...c, fidelity: { ...f, time: "ok", note: `${f.note} (same time-of-day bucket: not off-plan, D71)`.slice(0, 240) } } : c;
}

export const FIDELITY_AXES = ["time", "place", "action"] as const;

/** The axes Nano judged "wrong" (time of day, place, key action). */
export function fidelityFailures(c: Critique | null | undefined): string[] {
  const f = c?.fidelity;
  return f ? FIDELITY_AXES.filter((a) => f[a] === "wrong") : [];
}

/**
 * The axes that make a frame off-plan (owner decision 2026-10-11): the time of day and the
 * place. The "action" verdict is a note for the by-eye checklist, not a gate.
 */
export const BLOCKING_AXES = ["time", "place"] as const;

/** The blocking axes Nano judged "wrong". */
export function offPlanAxes(c: Critique | null | undefined): string[] {
  return fidelityFailures(c).filter((a) => (BLOCKING_AXES as readonly string[]).includes(a));
}

/** The critic's note when it judged the key action "wrong" (shown on the by-eye checklist), else null. */
export function actionNote(c: Critique | null | undefined): string | null {
  return c?.fidelity?.action === "wrong" ? c.fidelity.note || "the key action or object does not read" : null;
}

/**
 * An off-plan frame (wrong time of day or place) is never accepted: it caps the score at 6
 * (below the accept bar and the floor), forces "revise" and puts the mismatch first in the
 * issues the Artist gets back. A "wrong" action is passed on as the first issue, unscored.
 */
export function enforceFidelity(judged: Critique): Critique {
  const c = withinBucket(judged);
  const wrong = offPlanAxes(c);
  if (!wrong.length) {
    const note = actionNote(c);
    return note && !c.issues.some((i) => i.includes(note)) ? { ...c, issues: [`Key action: ${note}`.slice(0, 240), ...c.issues].slice(0, 6) } : c;
  }
  const what = `Off-plan ${wrong.join(" + ")}${c.fidelity?.note ? `: ${c.fidelity.note}` : ""}`.slice(0, 240);
  return { ...c, score: Math.min(c.score, 6), verdict: "revise", issues: [what, ...c.issues].slice(0, 6) };
}

const BUCKET_TEXT: Record<TimeBucket, string> = { day: "the DAY bucket (dawn to golden late afternoon)", dusk: "the DUSK bucket (sunset, twilight, evening)", night: "the NIGHT bucket" };

/** Story context and measured facts the fidelity verdict is judged against. */
export function fidelityBrief(plan: Pick<Plan, "title" | "logline"> & { readonly cast?: Plan["cast"] }, shot: ShotPlan, setTimes: ReadonlyMap<string, string>): string {
  const planned = plannedBucket(shot);
  const sets = shot.cast.filter((id) => setTimes.has(id)).map((id) => {
    const lit = setTimes.get(setForShot(shot, id, setTimes));
    return `#${id} is lit for ${lit} (${BUCKET_TEXT[setBucket(lit) ?? "day"]})`;
  });
  // the key object's planned state (owner 2026-10-12): the critic checks it shows
  const states = (shot.propStates ?? []).flatMap((ps) => {
    const st = plan.cast?.find((c) => c.id === ps.prop)?.states?.find((x) => x.id === ps.state);
    return st ? [`#${ps.prop} must show its state "${ps.state}": ${st.look}`] : [];
  });
  return [
    `Story: "${plan.title}" — ${plan.logline}`,
    `Scene: ${shot.scene}.`,
    planned ? `The plan's words put this shot in ${BUCKET_TEXT[planned]}.` : "",
    sets.length ? `Set lighting (engine kit): ${sets.join("; ")}.` : "",
    states.length ? `Key object: ${states.join("; ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
