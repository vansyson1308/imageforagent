import { prisma } from "@/lib/db";
import { parseTsv } from "@/lib/services/tsvParser";
import { replaceScript } from "@/lib/services/frameWrites";
import { callJson, recordStep, type DirectorContext } from "@/lib/services/director/context";
import { planSchema, type Plan } from "@/lib/services/director/schemas";
import { directorSystem, directorUser } from "@/lib/services/director/prompts";
import type { Frame } from "@/generated/prisma/client";

/** Director (Ultra): story → validated Plan (shot list + Cast & Set Bible). */
export async function runPlan(ctx: DirectorContext, story: string, references: string | null, referenceCount = 0): Promise<Plan> {
  const maxShots = ctx.budget.budget.maxShots;
  const minShots = Math.min(ctx.options.minShots, maxShots);
  const plan = await callJson(
    ctx,
    {
      role: "director",
      action: "plan",
      system: directorSystem({ minShots, maxShots, language: ctx.options.language, style: ctx.options.style }),
      user: directorUser(story, references),
      maxTokens: 8000,
      temperature: 0.6,
    },
    planSchema,
    "film_plan",
  );
  let best = normalizePlan(plan, maxShots, references ? referenceCount : 0);
  // Coverage (WP4.2): a film, not a slideshow. One measured retry; the plan with fewer problems wins.
  const problems = coverageProblems(best);
  if (problems.length) {
    await recordStep(ctx, { role: "director", model: ctx.models.strong, action: "plan:coverage", summary: `Coverage check failed (${problems.length})`, error: problems.join("; ") });
    try {
      const retry = await callJson(
        ctx,
        {
          role: "director",
          action: "plan:retry",
          system: directorSystem({ minShots, maxShots, language: ctx.options.language, style: ctx.options.style }),
          user: `${directorUser(story, references)}\n\nYour previous plan was rejected by the coverage check: ${problems.join("; ")}. Fix exactly these points and keep the story.`,
          maxTokens: 8000,
          temperature: 0.5,
        },
        planSchema,
        "film_plan",
        1,
      );
      const second = normalizePlan(retry, maxShots, references ? referenceCount : 0);
      const left = coverageProblems(second);
      if (left.length < problems.length) best = second;
      await recordStep(ctx, { role: "director", model: ctx.models.strong, action: "plan:coverage", summary: left.length < problems.length ? `Coverage fixed: ${problems.length} → ${left.length} problem(s)` : `Retry not better (${left.length} problem(s)); kept the first plan` });
    } catch {
      // keep the first plan; the film goes on
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
 * Measured coverage problems of a plan (empty = OK): varied shot sizes,
 * no consecutive duplicates (same size + same cast), and for 6+ shots at
 * least 2 distinct set areas/angles and an establishing wide shot.
 */
export function coverageProblems(plan: Plan): string[] {
  const shots = plan.shots;
  const out: string[] = [];
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
  return { ...plan, cast, shots };
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
