import { NemotronProvider } from "@/lib/providers/nemotronProvider";
import type { LlmProvider, ModelTier } from "@/lib/providers/types";

export type { ChatMessage, ChatOptions, ChatResult, LlmProvider, ModelTier, ResponseFormat } from "@/lib/providers/types";
export { LlmError } from "@/lib/providers/types";
export { MockLlmProvider } from "@/lib/providers/mockLlmProvider";
export { NemotronProvider } from "@/lib/providers/nemotronProvider";

/**
 * Crew model ids per tier (SPEC §3). The defaults come from public listings
 * of the Token Factory catalog and are NOT verified by this repo — at run
 * start `resolveCrewModels` checks them against `GET /v1/models` and falls
 * back to the closest listed Nemotron of the same tier. An empty VISION
 * model means "auto-detect a Nemotron Omni"; when none is listed, the critic
 * runs in text mode and the trace says so.
 */
export const DEFAULT_MODELS: Readonly<Record<ModelTier, string>> = {
  strong: "nvidia/Nemotron-3-Ultra-550b-a55b",
  mid: "nvidia/nemotron-3-super-120b-a12b",
  fast: "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B",
  vision: "",
};

export type CrewModels = Record<ModelTier, string>;

export function configuredModels(env: NodeJS.ProcessEnv = process.env): CrewModels {
  return {
    strong: env.NEMOTRON_STRONG_MODEL?.trim() || DEFAULT_MODELS.strong,
    mid: env.NEMOTRON_MID_MODEL?.trim() || DEFAULT_MODELS.mid,
    fast: env.NEMOTRON_FAST_MODEL?.trim() || DEFAULT_MODELS.fast,
    vision: env.NEMOTRON_VISION_MODEL?.trim() || DEFAULT_MODELS.vision,
  };
}

const TIER_PATTERNS: Record<ModelTier, RegExp> = {
  strong: /nemotron.*ultra/i,
  mid: /nemotron.*super/i,
  fast: /nemotron.*(nano|lightning)(?!.*omni)/i,
  vision: /nemotron.*omni/i,
};

export interface ResolvedModels {
  readonly models: CrewModels;
  /** Human-readable notes: substitutions, missing tiers (go into the trace). */
  readonly notes: string[];
  /** false = the vision tier is unavailable → text critic. */
  readonly visionAvailable: boolean;
}

/**
 * Matches the configured ids against the live catalog. Pure given `listed`,
 * so it is unit-tested without network.
 */
export function resolveAgainstCatalog(configured: CrewModels, listed: readonly string[]): ResolvedModels {
  const notes: string[] = [];
  const models = { ...configured };
  for (const tier of Object.keys(TIER_PATTERNS) as ModelTier[]) {
    const want = configured[tier];
    if (want && listed.includes(want)) continue;
    const ci = want ? listed.find((id) => id.toLowerCase() === want.toLowerCase()) : undefined;
    const pick = ci ?? listed.find((id) => TIER_PATTERNS[tier].test(id));
    if (pick) {
      if (want) notes.push(`${tier}: "${want}" is not in the catalog, using "${pick}".`);
      else notes.push(`${tier}: auto-detected "${pick}".`);
      models[tier] = pick;
    } else if (tier === "vision") {
      models.vision = "";
      notes.push("vision: no Nemotron Omni model in the catalog, so the critic runs in TEXT mode (SVG + render stats).");
    } else if (want) {
      notes.push(`${tier}: "${want}" is not in the catalog and no ${tier}-tier Nemotron was found. Calls may fail.`);
    }
  }
  return { models, notes, visionAvailable: models.vision !== "" };
}

export function llmConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.LLM_PROVIDER === "mock" || Boolean(env.NEBIUS_API_KEY);
}

/** Server-side provider (keys never leave the server). null = no key and no mock. */
export function createNemotronProvider(env: NodeJS.ProcessEnv = process.env): LlmProvider | null {
  if (!env.NEBIUS_API_KEY) return null;
  return new NemotronProvider({ apiKey: env.NEBIUS_API_KEY, baseUrl: env.NEBIUS_BASE_URL });
}
