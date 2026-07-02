import { prisma } from "@/lib/db";
import { AppError } from "@/lib/services/apiError";

const DEFAULT_LIMIT = 40;

export function getDailyLimit(): number {
  const raw = Number(process.env.DAILY_GEN_LIMIT);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_LIMIT;
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export async function getDailyUsage(): Promise<{ used: number; limit: number }> {
  const used = await prisma.generationLog.count({
    where: { createdAt: { gte: startOfToday() }, provider: { not: "mock" } },
  });
  return { used, limit: getDailyLimit() };
}

/** Chặn khi vượt ngưỡng ngày — chỉ đếm call provider thật (mock không tính). */
export async function assertDailyBudget(plannedCalls: number): Promise<void> {
  const { used, limit } = await getDailyUsage();
  if (used + plannedCalls > limit) {
    throw new AppError(
      "DAILY_LIMIT",
      `Vượt giới hạn ${limit} ảnh/ngày (đã dùng ${used}, cần thêm ${plannedCalls}).`,
      "Tăng DAILY_GEN_LIMIT trong .env hoặc đợi sang ngày mai.",
    );
  }
}

export async function logGeneration(
  projectId: string,
  frameId: string,
  provider: string,
): Promise<void> {
  await prisma.generationLog.create({ data: { projectId, frameId, provider } });
}
