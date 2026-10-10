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
export const DAY_WORDS = /\b(morning|noon|midday|afternoon|sunny|sunlit|daylight|daytime|sunrise)\b|buổi sáng|sáng sớm|ban ngày|buổi trưa|buổi chiều|朝|昼|午後|日中/i;

export type PlannedTime = "night" | "day" | null;

/** The time of day a shot's own words ask for (null = not stated, or both stated). */
export function shotTime(shot: Pick<ShotPlan, "scene" | "description">): PlannedTime {
  const text = `${shot.scene} ${shot.description}`;
  const night = NIGHT_WORDS.test(text);
  const day = DAY_WORDS.test(text);
  return night === day ? null : night ? "night" : "day";
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

export const FIDELITY_AXES = ["time", "place", "action"] as const;

/** The axes Nano judged "wrong" (time of day, place, key action). */
export function fidelityFailures(c: Critique | null | undefined): string[] {
  const f = c?.fidelity;
  return f ? FIDELITY_AXES.filter((a) => f[a] === "wrong") : [];
}

/**
 * An off-plan frame is never accepted: any "wrong" axis caps the score at 6
 * (below the accept bar and the floor), forces "revise" and puts the mismatch
 * first in the issues the Artist gets back.
 */
export function enforceFidelity(c: Critique): Critique {
  const wrong = fidelityFailures(c);
  if (!wrong.length) return c;
  const what = `Off-plan ${wrong.join(" + ")}${c.fidelity?.note ? `: ${c.fidelity.note}` : ""}`.slice(0, 240);
  return { ...c, score: Math.min(c.score, 6), verdict: "revise", issues: [what, ...c.issues].slice(0, 6) };
}

/** Story context and measured facts the fidelity verdict is judged against. */
export function fidelityBrief(plan: Pick<Plan, "title" | "logline">, shot: ShotPlan, setTimes: ReadonlyMap<string, string>): string {
  const planned = shotTime(shot);
  const sets = shot.cast.filter((id) => setTimes.has(id)).map((id) => `#${id} is lit for ${setTimes.get(id)}`);
  return [
    `Story: "${plan.title}" — ${plan.logline}`,
    `Scene: ${shot.scene}.`,
    planned ? `The plan's words put this shot at ${planned === "night" ? "NIGHT" : "DAYTIME"}.` : "",
    sets.length ? `Set lighting (engine kit): ${sets.join("; ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
