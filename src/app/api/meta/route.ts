import { handleRoute } from "@/lib/services/routeHelpers";
import { getServiceAccountEmail } from "@/lib/services/sheetReader";

/**
 * Thông tin cấu hình cho UI/agent: email service account Google Sheets
 * (nếu có) + feature-detect construct engine.
 */
export async function GET(): Promise<Response> {
  return handleRoute(async () => {
    return Response.json({
      serviceAccountEmail: getServiceAccountEmail(),
      construct: { version: 1 },
    });
  });
}
