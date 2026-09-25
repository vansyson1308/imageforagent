import { z } from "zod";
import { TRANSITIONS } from "@/lib/validation/schemas";

/**
 * Zod schemas for EVERY JSON reply the crew produces. Nothing an LLM writes
 * reaches the engine without passing one of these (plus sanitizeSvg /
 * constructSpecSchema / motionSpecSchema downstream). The same schemas
 * generate the `json_schema` response formats sent to Token Factory.
 */

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Colors must be #rrggbb");
export const castId = z
  .string()
  .regex(/^[a-z][a-z0-9-]{1,31}$/, 'Cast ids are lowercase slugs like "grandma" or "tea-house"');

export const castMemberSchema = z.object({
  id: castId,
  name: z.string().min(1).max(60),
  kind: z.enum(["character", "prop", "set"]),
  /** Visual design: shapes, proportions, clothes, signature details. */
  look: z.string().min(3).max(500),
  colors: z.array(hex).min(1).max(6),
});

export const shotPlanSchema = z.object({
  scene: z.string().min(1).max(80),
  shotType: z.string().min(1).max(60),
  description: z.string().min(5).max(700),
  /** "motion" = animated shot (moving elements / figure); "still" = one drawn frame. */
  mode: z.enum(["still", "motion"]),
  durationSec: z.number().min(1.5).max(10),
  dialogue: z.string().max(220).nullable(),
  speaker: z.string().max(60).nullable(),
  transition: z.enum(TRANSITIONS),
  cast: z.array(castId).max(6),
});

export const planSchema = z.object({
  title: z.string().min(1).max(120),
  logline: z.string().min(1).max(300),
  palette: z.array(hex).min(3).max(8),
  cast: z.array(castMemberSchema).min(1).max(8),
  shots: z.array(shotPlanSchema).min(1).max(24),
});

export type CastMember = z.infer<typeof castMemberSchema>;
export type ShotPlan = z.infer<typeof shotPlanSchema>;
export type Plan = z.infer<typeof planSchema>;

export const critiqueSchema = z.object({
  /** 0 = unreadable/wrong, 10 = clearly shows the shot with good composition. */
  score: z.number().min(0).max(10),
  verdict: z.enum(["accept", "revise"]),
  issues: z.array(z.string().max(240)).max(6),
  fixes: z.array(z.string().max(240)).max(6),
});

export type Critique = z.infer<typeof critiqueSchema>;

export const editorEditSchema = z.object({
  index: z.number().int().min(1),
  /** New (shorter) line, or null to remove the line. Omit = unchanged. */
  dialogue: z.string().max(220).nullable().optional(),
  transition: z.enum(TRANSITIONS).optional(),
  voiceOffset: z.number().min(0).max(5).optional(),
});

export const editorReplySchema = z.object({
  edits: z.array(editorEditSchema).max(24),
  notes: z.string().max(600),
});

export type EditorReply = z.infer<typeof editorReplySchema>;

export const continuitySchema = z.object({
  ok: z.boolean(),
  notes: z.array(z.string().max(240)).max(8),
});

export type Continuity = z.infer<typeof continuitySchema>;

export const researchQueriesSchema = z.object({
  queries: z.array(z.string().min(3).max(120)).max(3),
});

export const researchNotesSchema = z.object({
  notes: z
    .array(
      z.object({
        /** One visual fact the Artist can draw (costume, architecture, object). */
        note: z.string().min(3).max(300),
        /** Index into the numbered source list given to the model. */
        source: z.number().int().min(1),
      }),
    )
    .max(8),
});

/** JSON Schema for the Token Factory `json_schema` response format. */
export function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema, { target: "draft-7", unrepresentable: "any" }) as Record<string, unknown>;
  delete js.$schema;
  return js;
}

/**
 * Pull a JSON object out of a model reply: tolerates ```json fences and prose
 * around the object (json_object fallback models sometimes add both).
 */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(body);
  } catch {
    const a = body.indexOf("{");
    const b = body.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(body.slice(a, b + 1));
    throw new SyntaxError("Reply contains no JSON object.");
  }
}

/** Human/LLM-readable zod failure: "shots.2.durationSec: Too small …" (first 5 issues). */
export function zodIssues(err: z.ZodError): string {
  return err.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}
