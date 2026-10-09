import { tavilyExtract, tavilySearch, type TavilyOptions, type TavilyResult } from "@/lib/providers/tavily";
import { callJson, recordStep, ReplyInvalidError, throwIfCancelled, type DirectorContext } from "@/lib/services/director/context";
import { quoteData, researchDetectSystem, researchNotesSystem, researchQuerySystem } from "@/lib/services/director/prompts";
import { researchDecisionSchema, researchNotesSchema, researchQueriesSchema, type Plan } from "@/lib/services/director/schemas";
import { LlmError } from "@/lib/providers/types";

/**
 * Researcher (Nano + Tavily), budget-capped: ≤ 2 searches × 3 results and
 * ≤ 1 extract per run (the per-run Tavily budget: at most 3 Tavily calls). Snippets are quoted as DATA (never instructions) and
 * length-capped. Every note keeps its source URL and flows into the Bible
 * (Director prompt) and the UI.
 */

export const RESEARCH_LIMITS = { maxQueries: 2, resultsPerQuery: 3, maxExtracts: 1, snippetChars: 600, extractChars: 1500 } as const;

export interface ReferenceNote {
  readonly note: string;
  readonly url: string;
  readonly title: string;
  /** costume | props | palette | set | architecture | customs */
  readonly use?: string;
}

/** "on" = always research, "auto" = Nano decides from the story, "off" = never. */
export type ResearchMode = "on" | "auto" | "off";

export function researchMode(v: boolean | "auto" | undefined): ResearchMode {
  return v === "auto" ? "auto" : v ? "on" : "off";
}

/**
 * Nano's cheap yes/no (≈ 200 tokens): does the story name real places, eras,
 * festivals, costumes or architecture worth looking up? Recorded as a step
 * with its reason, so the trace shows WHY research ran or not. A failed
 * decision means "no research" (never blocks the film).
 */
export async function decideResearch(ctx: DirectorContext, story: string): Promise<{ needed: boolean; reason: string; topics: string[] }> {
  try {
    const d = await callJson(
      ctx,
      { role: "researcher", action: "detect", system: researchDetectSystem(), user: quoteData("story", story, 4000), maxTokens: 300, temperature: 0, thinking: false },
      researchDecisionSchema,
      "research_decision",
      1,
    );
    await recordStep(ctx, {
      role: "researcher",
      model: ctx.models.fast,
      action: "decision",
      summary: `${d.needed ? "Research needed" : "No research needed"}: ${d.reason}${d.topics.length ? ` (${d.topics.join(", ")})` : ""}`,
      output: JSON.stringify(d),
    });
    return d;
  } catch (e) {
    if (e instanceof ReplyInvalidError || e instanceof LlmError) return { needed: false, reason: "decision failed", topics: [] };
    throw e;
  }
}

export interface ResearchUse {
  readonly notes: number;
  /** distinct notes cited anywhere in the Bible */
  readonly cited: number;
  readonly castCiting: number;
  readonly shotsCiting: number;
  readonly byUse: Record<string, number>;
}

/** How much of the research the Director actually put into the Bible (pure; measured, not claimed). */
export function measureResearchUse(plan: Plan, notes: readonly ReferenceNote[]): ResearchUse {
  const cited = new Set<number>();
  for (const c of plan.cast) for (const n of c.cites ?? []) if (n >= 1 && n <= notes.length) cited.add(n);
  for (const sh of plan.shots) for (const n of sh.cites ?? []) if (n >= 1 && n <= notes.length) cited.add(n);
  const byUse: Record<string, number> = {};
  for (const n of cited) {
    const u = notes[n - 1]?.use ?? "other";
    byUse[u] = (byUse[u] ?? 0) + 1;
  }
  return {
    notes: notes.length,
    cited: cited.size,
    castCiting: plan.cast.filter((c) => (c.cites ?? []).some((n) => n >= 1 && n <= notes.length)).length,
    shotsCiting: plan.shots.filter((sh) => (sh.cites ?? []).some((n) => n >= 1 && n <= notes.length)).length,
    byUse,
  };
}

export interface ResearchOutcome {
  readonly notes: ReferenceNote[];
  /** Text block handed to the Director as <reference> data. */
  readonly text: string | null;
}

export async function runResearch(ctx: DirectorContext, story: string, tavily: TavilyOptions): Promise<ResearchOutcome> {
  let queries: string[];
  try {
    const q = await callJson(
      ctx,
      { role: "researcher", action: "queries", system: researchQuerySystem(), user: quoteData("story", story, 4000), maxTokens: 400, temperature: 0.2, thinking: false },
      researchQueriesSchema,
      "research_queries",
      1,
    );
    queries = q.queries.slice(0, RESEARCH_LIMITS.maxQueries);
  } catch (e) {
    if (e instanceof ReplyInvalidError || e instanceof LlmError) return { notes: [], text: null };
    throw e;
  }
  if (queries.length === 0) {
    await recordStep(ctx, { role: "researcher", model: "tavily", action: "search", summary: "No real-world references needed" });
    return { notes: [], text: null };
  }

  const sources: TavilyResult[] = [];
  for (const query of queries) {
    throwIfCancelled(ctx);
    ctx.budget.check();
    const t0 = Date.now();
    try {
      const results = await tavilySearch(tavily, query, RESEARCH_LIMITS.resultsPerQuery, ctx.signal);
      for (const r of results) if (!sources.some((s) => s.url === r.url)) sources.push(r);
      await recordStep(ctx, { role: "researcher", model: "tavily/search", action: "search", latencyMs: Date.now() - t0, summary: `“${query}” → ${results.length} results`, output: JSON.stringify(results.map((r) => ({ title: r.title, url: r.url }))) });
    } catch (e) {
      await recordStep(ctx, { role: "researcher", model: "tavily/search", action: "search", latencyMs: Date.now() - t0, summary: `“${query}” failed`, error: e instanceof Error ? e.message : String(e) });
    }
  }
  if (sources.length === 0) return { notes: [], text: null };

  // One extract of the best source gives the notes more concrete detail
  const top = [...sources].sort((a, b) => b.score - a.score)[0];
  let extracted: string | null = null;
  try {
    const t0 = Date.now();
    const ex = await tavilyExtract(tavily, [top.url], ctx.signal);
    extracted = ex[0]?.rawContent.slice(0, RESEARCH_LIMITS.extractChars) ?? null;
    await recordStep(ctx, { role: "researcher", model: "tavily/extract", action: "extract", latencyMs: Date.now() - t0, summary: `Extracted ${extracted?.length ?? 0} chars from ${top.url}` });
  } catch (e) {
    await recordStep(ctx, { role: "researcher", model: "tavily/extract", action: "extract", summary: "Extract failed", error: e instanceof Error ? e.message : String(e) });
  }

  const numbered = sources
    .map((s, i) => `[${i + 1}] ${s.title} (${s.url})\n${(s.url === top.url && extracted ? extracted : s.content).slice(0, RESEARCH_LIMITS.snippetChars * (s.url === top.url && extracted ? 3 : 1))}`)
    .join("\n\n");
  let notes: ReferenceNote[] = [];
  try {
    const r = await callJson(
      ctx,
      {
        role: "researcher",
        action: "notes",
        system: researchNotesSystem(),
        user: `Story (for relevance):\n${quoteData("story", story, 1500)}\n\nWeb snippets:\n${quoteData("reference", numbered, 9000)}`,
        maxTokens: 1500,
        temperature: 0.2,
        thinking: false,
      },
      researchNotesSchema,
      "research_notes",
      1,
    );
    notes = r.notes
      .filter((n) => n.source >= 1 && n.source <= sources.length)
      .map((n) => ({ note: n.note, url: sources[n.source - 1].url, title: sources[n.source - 1].title, use: n.use }));
  } catch (e) {
    if (!(e instanceof ReplyInvalidError || e instanceof LlmError)) throw e;
  }
  await recordStep(ctx, {
    role: "researcher",
    model: ctx.models.fast,
    action: "references",
    summary: `Researcher found ${notes.length} reference note(s) from ${new Set(notes.map((n) => n.url)).size} source(s)`,
    output: JSON.stringify(notes),
  });
  ctx.emit({ type: "research", references: notes });
  return { notes, text: notes.length ? notes.map((n, i) => `${i + 1}. (${n.use ?? "detail"}) ${n.note} [source: ${n.url}]`).join("\n") : null };
}
