import type { z } from "zod";
import { prisma } from "@/lib/db";
import type { CrewModels } from "@/lib/providers";
import { LlmError, type ChatMessage, type LlmProvider, type ModelTier } from "@/lib/providers/types";
import { BudgetTracker, CancelledError, type DirectorBudget } from "@/lib/services/director/budget";
import { extractJson, jsonSchemaOf, zodIssues } from "@/lib/services/director/schemas";
import { hashPrompt } from "@/lib/services/director/prompts";
import type { CanvasSize } from "@/lib/services/svgRenderer";

/** Crew roles as shown in traces and the UI timeline. */
export type CrewRole = "researcher" | "director" | "cast" | "artist" | "critic" | "editor" | "dialogue" | "system";

export const ROLE_TIER: Record<Exclude<CrewRole, "dialogue" | "system">, ModelTier> = {
  researcher: "fast",
  director: "strong",
  cast: "mid",
  artist: "mid",
  critic: "vision",
  editor: "fast",
};

export interface StepEvent {
  readonly seq: number;
  readonly role: CrewRole;
  readonly model: string;
  readonly action: string;
  readonly shotIndex: number | null;
  readonly attempt: number;
  readonly summary: string;
  readonly score: number | null;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly costUsd: number;
  readonly latencyMs: number;
  readonly imageUrl: string | null;
  readonly error: string | null;
}

/** Server-Sent Event payloads (the `event:` name is `type`). */
export type DirectorEvent =
  | { type: "run"; runId: string; projectId: string; provider: string; models: CrewModels; notes: string[]; budget: DirectorBudget }
  | { type: "step"; step: StepEvent; totals: { tokens: number; costUsd: number } }
  | { type: "plan"; title: string; logline: string; shots: Array<{ index: number; shotType: string; description: string; mode: string; dialogue: string | null }> }
  | { type: "research"; references: Array<{ note: string; url: string; title: string }> }
  | { type: "frame"; index: number; imageUrl: string | null; clipUrl: string | null; score: number | null; status: string }
  | { type: "status"; message: string }
  | { type: "done"; status: string; summary: RunSummary }
  | { type: "error"; message: string };

export interface RunSummary {
  readonly status: string;
  readonly shots: number;
  readonly rendered: number;
  readonly firstPassOk: number;
  readonly repairs: number;
  readonly criticBefore: number | null;
  readonly criticAfter: number | null;
  readonly revisions: number;
  readonly lintErrors: number;
  readonly lintWarnings: number;
  readonly durationSec: number;
  readonly wallMs: number;
  readonly tokens: number;
  readonly costUsd: number;
  readonly continuity: string[];
  readonly textCritic: boolean;
}

export interface DirectorOptions {
  readonly language: string;
  readonly style: string;
  readonly critic: boolean;
  readonly research: boolean;
  readonly fps: number;
  readonly minShots: number;
  /** Quality bar: critic scores below trigger a revision round. */
  readonly acceptScore: number;
}

export interface DirectorContext {
  readonly runId: string;
  readonly projectId: string;
  readonly provider: LlmProvider;
  readonly models: CrewModels;
  visionAvailable: boolean;
  readonly budget: BudgetTracker;
  readonly options: DirectorOptions;
  readonly canvas: CanvasSize;
  readonly signal: AbortSignal;
  readonly emit: (e: DirectorEvent) => void;
  /** Next DirectorStep.seq (mutable counter). */
  seq: number;
}

export function throwIfCancelled(ctx: DirectorContext): void {
  if (ctx.signal.aborted) throw new CancelledError();
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

export interface StepRecord {
  readonly role: CrewRole;
  readonly model: string;
  readonly action: string;
  readonly shotIndex?: number | null;
  readonly attempt?: number;
  readonly promptHash?: string | null;
  readonly summary: string;
  readonly output?: string | null;
  readonly score?: number | null;
  readonly latencyMs?: number;
  readonly tokensIn?: number;
  readonly tokensOut?: number;
  readonly costUsd?: number;
  readonly imagePath?: string | null;
  readonly error?: string | null;
}

/** Persist one DirectorStep, roll totals into the run, stream it to the client. */
export async function recordStep(ctx: DirectorContext, r: StepRecord): Promise<void> {
  const seq = ctx.seq++;
  const tokensIn = r.tokensIn ?? 0;
  const tokensOut = r.tokensOut ?? 0;
  const costUsd = r.costUsd ?? 0;
  await prisma.directorStep.create({
    data: {
      runId: ctx.runId,
      seq,
      shotIndex: r.shotIndex ?? null,
      role: r.role,
      model: r.model,
      action: r.action,
      promptHash: r.promptHash ?? null,
      outputSummary: clip(r.summary, 500),
      output: r.output ? clip(r.output, 64_000) : null,
      critiqueScore: r.score ?? null,
      attempt: r.attempt ?? 0,
      latencyMs: Math.round(r.latencyMs ?? 0),
      tokensIn,
      tokensOut,
      costUsd,
      imagePath: r.imagePath ?? null,
      error: r.error ? clip(r.error, 2000) : null,
    },
  });
  await prisma.directorRun.update({
    where: { id: ctx.runId },
    data: { tokensIn: ctx.budget.tokensIn, tokensOut: ctx.budget.tokensOut, costUsd: ctx.budget.costUsd },
  });
  ctx.emit({
    type: "step",
    step: {
      seq,
      role: r.role,
      model: r.model,
      action: r.action,
      shotIndex: r.shotIndex ?? null,
      attempt: r.attempt ?? 0,
      summary: clip(r.summary, 300),
      score: r.score ?? null,
      tokensIn,
      tokensOut,
      costUsd,
      latencyMs: Math.round(r.latencyMs ?? 0),
      imageUrl: r.imagePath ? `/api/files/${r.imagePath}` : null,
      error: r.error ? clip(r.error, 400) : null,
    },
    totals: { tokens: ctx.budget.tokens, costUsd: ctx.budget.costUsd },
  });
}

export interface CallSpec {
  readonly role: Exclude<CrewRole, "dialogue" | "system">;
  readonly action: string;
  readonly system: string;
  readonly user: string;
  readonly images?: readonly string[];
  readonly shotIndex?: number | null;
  readonly attempt?: number;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly thinking?: boolean;
  /** Override the role's tier model (critic text fallback uses the fast tier). */
  readonly model?: string;
  readonly imagePath?: string | null;
}

export interface CallOutcome {
  readonly text: string;
  readonly model: string;
}

/**
 * One model call: budget gate → provider → accounting → DirectorStep.
 * Provider errors are recorded as a failed step and rethrown.
 */
export async function callModel(ctx: DirectorContext, spec: CallSpec, format?: { schema: z.ZodType; name: string }): Promise<CallOutcome> {
  throwIfCancelled(ctx);
  ctx.budget.check();
  const model = spec.model ?? ctx.models[ROLE_TIER[spec.role]];
  const messages: ChatMessage[] = [
    { role: "system", content: spec.system },
    { role: "user", content: spec.user, ...(spec.images?.length ? { images: spec.images } : {}) },
  ];
  const promptHash = hashPrompt([model, spec.system, spec.user]);
  try {
    const r = await ctx.provider.chat(messages, {
      model,
      signal: ctx.signal,
      maxTokens: spec.maxTokens,
      temperature: spec.temperature,
      thinking: spec.thinking,
      responseFormat: format ? { type: "json_schema", name: format.name, schema: jsonSchemaOf(format.schema) } : undefined,
    });
    ctx.budget.add(r.usage.promptTokens, r.usage.completionTokens, r.costUsd);
    await recordStep(ctx, {
      role: spec.role,
      model: r.model,
      action: spec.action,
      shotIndex: spec.shotIndex,
      attempt: spec.attempt,
      promptHash,
      summary: `${spec.action}${r.formatFallback ? " (json_object fallback)" : ""}${r.attempts > 1 ? ` after ${r.attempts} attempts` : ""}`,
      output: r.text,
      latencyMs: r.latencyMs,
      tokensIn: r.usage.promptTokens,
      tokensOut: r.usage.completionTokens,
      costUsd: r.costUsd,
      imagePath: spec.imagePath,
    });
    return { text: r.text, model: r.model };
  } catch (err) {
    if (err instanceof LlmError && err.kind === "aborted") throw new CancelledError();
    if (ctx.signal.aborted) throw new CancelledError();
    await recordStep(ctx, {
      role: spec.role,
      model,
      action: spec.action,
      shotIndex: spec.shotIndex,
      attempt: spec.attempt,
      promptHash,
      summary: `${spec.action} failed`,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export class ReplyInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplyInvalidError";
  }
}

/**
 * JSON call validated by a zod schema. An invalid reply gets up to
 * `repairs` follow-ups that quote the exact validation issues.
 */
export async function callJson<T>(ctx: DirectorContext, spec: CallSpec, schema: z.ZodType<T>, name: string, repairs = 2): Promise<T> {
  let user = spec.user;
  for (let attempt = 0; ; attempt++) {
    const out = await callModel(ctx, { ...spec, user, attempt: (spec.attempt ?? 0) + attempt }, { schema, name });
    let problem: string;
    try {
      const parsed = schema.safeParse(extractJson(out.text));
      if (parsed.success) return parsed.data;
      problem = zodIssues(parsed.error);
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    }
    await recordStep(ctx, {
      role: spec.role,
      model: out.model,
      action: `${spec.action}:invalid`,
      shotIndex: spec.shotIndex,
      attempt: (spec.attempt ?? 0) + attempt,
      summary: `Reply rejected by schema`,
      error: problem,
    });
    if (attempt >= repairs) throw new ReplyInvalidError(`${spec.role} reply invalid after ${attempt + 1} tries: ${problem}`);
    user = `${spec.user}\n\nYour previous reply was rejected: ${problem}\nReply again with ONE valid JSON object only.`;
  }
}
