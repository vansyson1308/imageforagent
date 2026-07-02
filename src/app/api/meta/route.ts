import { handleRoute } from "@/lib/services/routeHelpers";
import { getServiceAccountEmail } from "@/lib/services/sheetReader";
import { getDailyUsage } from "@/lib/services/costGuard";
import { getImageProvider } from "@/lib/providers";

/** Thông tin cấu hình cho UI: email service account, provider, quota ngày. */
export async function GET(): Promise<Response> {
  return handleRoute(async () => {
    const usage = await getDailyUsage();
    let providerName = "mock";
    try {
      providerName = getImageProvider().name;
    } catch {
      // thiếu key khi ép gemini — UI hiển thị mock
    }
    return Response.json({
      serviceAccountEmail: getServiceAccountEmail(),
      imageProvider: providerName,
      dailyUsed: usage.used,
      dailyLimit: usage.limit,
    });
  });
}
