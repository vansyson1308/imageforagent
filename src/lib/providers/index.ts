import { NemotronProvider } from "@/lib/providers/nemotronProvider";
import type { LlmProvider, ModelTier } from "@/lib/providers/types";

export type { ChatMessage, ChatOptions, ChatResult, LlmProvider, ModelTier, ResponseFormat } from "@/lib/providers/types";
export { LlmError } from "@/lib/providers/types";
export { MockLlmProvider } from "@/lib/providers/mockLlmProvider";
export { NemotronProvider } from "@/lib/providers/nemotronProvider";

/**
 * Crew model ids per tier (SPEC §3). At run start `resolveCrewModels`
 * checks them against `GET /v1/models` and falls back to the closest listed
 * Nemotron of the same tier; an empty VISION model means "auto-detect".
 * Without any vision model the critic runs in text mode and the trace says so.
 *
 * Token Factory retires Nemotron 3 Super / Nano and MiniCPM-V on 2026-11-09
 * (docs.tokenfactory.nebius.com/model-deprecations-november-2026), so mid and
 * fast are pinned to the successors and Super-VL is also the critic's eyes
 * (D96, probed live in docs/hackathon/evidence/probe-successors-*.json).
 * The showcase films and the bench were made with the original models.
 */
export const DEFAULT_MODELS: Readonly<Record<ModelTier, string>> = {
  strong: "nvidia/Nemotron-3-Ultra-550b-a55b",
  mid: "nvidia/Nemotron-3.5-Super-VL",
  fast: "nvidia/Nemotron-3_5-Lightning",
  vision: "nvidia/Nemotron-3.5-Super-VL",
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
  vision: /nvidia\/.*(omni|[-_]vl\b|vlm|vision)/i,
};

/**
 * Vision models that can LOOK at renders when the configured one is not
 * served and no other NVIDIA vision model matches (SPEC v2 WP4.4 option 2,
 * DECISIONS D33, D96). They only describe what they see; a Nemotron model
 * still scores. `google/gemma-3-27b-it` and the Kimi judges are deliberately
 * absent: they are the independent eval judges (the critic must differ).
 */
export const VISION_FALLBACKS = ["nvidia/Nemotron-3.5-Super-VL"] as const;

/** Per-request settings a model needs for one crew role (sent only to that exact model id). */
export interface RequestTuning {
  readonly thinking?: boolean;
  readonly frequencyPenalty?: number;
}

/**
 * Model-keyed request tuning (D96). Nemotron-3.5-Super-VL as Artist/Cast reasons
 * past the 12k-token cap by default (23 of 52 artist calls returned no SVG on the
 * first successor take) and, with reasoning off alone, loops on repeated paths in
 * 3 of 11 shots; reasoning off + frequency_penalty 0.3 gave a sanitizer-clean
 * fragment for 11 of 11 (evidence/probe-artist-thinking-*.json), but on the three
 * landing samples the penalty broke JSON/XML syntax (repeated quotes and tags)
 * and no sample reached the judge bar. The fallback Artist is Ultra
 * (NEMOTRON_MID_MODEL, owner + QC 2026-10-31): it also reasons ~10k tokens per
 * frame by default, and with reasoning off draws a clean fragment in 2–3 s, so
 * its Artist/Cast calls run with reasoning off and no penalty. Keyed by exact id
 * AND role: Ultra as the Director keeps its defaults.
 */
export const MODEL_TUNING: Readonly<Record<string, Readonly<Record<string, RequestTuning>>>> = {
  "nvidia/Nemotron-3.5-Super-VL": {
    artist: { thinking: false, frequencyPenalty: 0.3 },
    cast: { thinking: false, frequencyPenalty: 0.3 },
  },
  "nvidia/Nemotron-3-Ultra-550b-a55b": {
    artist: { thinking: false },
    cast: { thinking: false },
  },
};

export function requestTuning(model: string, role: string): RequestTuning {
  const key = Object.keys(MODEL_TUNING).find((id) => id.toLowerCase() === model.toLowerCase());
  return (key && MODEL_TUNING[key][role]) || {};
}

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
export function resolveAgainstCatalog(configured: CrewModels, listed: readonly string[], opts: { visionFallbacks?: readonly string[] } = {}): ResolvedModels {
  const fallbacks = opts.visionFallbacks ?? VISION_FALLBACKS;
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
      const open = fallbacks.find((f) => listed.some((id) => id.toLowerCase() === f.toLowerCase()));
      if (open) {
        models.vision = listed.find((id) => id.toLowerCase() === open.toLowerCase())!;
        notes.push(`vision: no auto-detected vision model, so the fallback ${models.vision} LOOKS at each render and the fast-tier Nemotron still scores it (vision critic: ${models.vision}).`);
      } else {
        models.vision = "";
        notes.push("vision: no vision model in the catalog, so the critic runs in TEXT mode (SVG + render stats).");
      }
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
