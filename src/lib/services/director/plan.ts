import { prisma } from "@/lib/db";
import { parseTsv } from "@/lib/services/tsvParser";
import { replaceScript } from "@/lib/services/frameWrites";
import { callJson, type DirectorContext } from "@/lib/services/director/context";
import { planSchema, type Plan } from "@/lib/services/director/schemas";
import { directorSystem, directorUser } from "@/lib/services/director/prompts";
import type { Frame } from "@/generated/prisma/client";

/** Director (Ultra): story → validated Plan (shot list + Cast & Set Bible). */
export async function runPlan(ctx: DirectorContext, story: string, references: string | null): Promise<Plan> {
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
  return normalizePlan(plan, maxShots);
}

/**
 * Deterministic clean-up of a valid plan: cap the shot count (budget), drop
 * cast references to unknown ids, dedupe cast ids, final shot fades out.
 */
export function normalizePlan(plan: Plan, maxShots: number): Plan {
  const seen = new Set<string>();
  const cast = plan.cast.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
  const shots = plan.shots.slice(0, Math.max(1, maxShots)).map((s, i) => ({
    ...s,
    cast: s.cast.filter((id) => seen.has(id)),
    transition: i === 0 ? ("cut" as const) : s.transition,
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
