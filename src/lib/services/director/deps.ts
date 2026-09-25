import { configuredModels, createNemotronProvider, resolveAgainstCatalog, type CrewModels } from "@/lib/providers";
import { NemotronProvider } from "@/lib/providers/nemotronProvider";
import { AppError } from "@/lib/services/apiError";
import { budgetFromEnv } from "@/lib/services/director/budget";
import { createDemoProvider, MOCK_MODELS } from "@/lib/services/director/demoCrew";
import type { DirectorDeps } from "@/lib/services/director/loop";

/**
 * Build the crew from server env. Keys never leave this module's callers
 * (server-only). The catalog check (GET /v1/models) is cached for 10 minutes
 * per process; a failed check keeps the configured ids and says so.
 */

let catalogCache: { at: number; models: CrewModels; notes: string[]; vision: boolean } | null = null;

export async function directorDeps(env: NodeJS.ProcessEnv = process.env): Promise<DirectorDeps> {
  const ceiling = budgetFromEnv(env);
  const tavily = env.TAVILY_API_KEY ? { apiKey: env.TAVILY_API_KEY, baseUrl: env.TAVILY_BASE_URL } : null;
  if (env.LLM_PROVIDER === "mock") {
    return { provider: createDemoProvider(), models: MOCK_MODELS, visionAvailable: true, modelNotes: ["mock provider: scripted demo crew, no model calls"], tavily: null, ceiling };
  }
  const provider = createNemotronProvider(env);
  if (!provider) {
    throw new AppError("DIRECTOR_UNAVAILABLE", "The Director needs NEBIUS_API_KEY on the server.", "Set NEBIUS_API_KEY (Nebius Token Factory), or LLM_PROVIDER=mock for the scripted demo crew. The zero-key engine works without it.");
  }
  const now = Date.now();
  if (!catalogCache || now - catalogCache.at > 10 * 60_000) {
    const configured = configuredModels(env);
    try {
      const listed = await (provider as NemotronProvider).listModels();
      const r = resolveAgainstCatalog(configured, listed);
      catalogCache = { at: now, models: r.models, notes: r.notes, vision: r.visionAvailable };
    } catch (e) {
      catalogCache = {
        at: now,
        models: configured,
        notes: [`catalog check failed (${e instanceof Error ? e.message : String(e)}), so the configured ids are used unverified`],
        vision: configured.vision !== "",
      };
    }
  }
  return { provider, models: catalogCache.models, visionAvailable: catalogCache.vision, modelNotes: catalogCache.notes, tavily, ceiling };
}
