import { handleRoute } from "@/lib/services/routeHelpers";
import { getServiceAccountEmail } from "@/lib/services/sheetReader";
import { MOTION_LIMITS } from "@/lib/config/limits";
import { configuredModels, llmConfigured } from "@/lib/providers";
import { demoConfig } from "@/lib/services/demoMode";
import { STYLE_PRESETS } from "@/lib/services/director/prompts";

/**
 * Thông tin cấu hình cho UI/agent: email service account Google Sheets
 * (nếu có) + feature-detect construct/motion engine + Director (không lộ key).
 */
export async function GET(): Promise<Response> {
  return handleRoute(async () => {
    const mock = process.env.LLM_PROVIDER === "mock";
    return Response.json({
      serviceAccountEmail: getServiceAccountEmail(),
      construct: { version: 1 },
      motion: { version: 1, limits: MOTION_LIMITS },
      director: {
        enabled: llmConfigured(),
        provider: mock ? "mock" : process.env.NEBIUS_API_KEY ? "nemotron" : null,
        models: mock ? null : configuredModels(),
        research: Boolean(process.env.TAVILY_API_KEY) && !mock,
        styles: Object.keys(STYLE_PRESETS),
      },
      demo: { enabled: demoConfig().enabled },
    });
  });
}
