import { AppError } from "@/lib/services/apiError";

/**
 * Rate limit in-memory dạng sliding window — đủ cho app single-instance nội bộ.
 * globalThis để sống sót qua HMR.
 */
interface WindowState {
  timestamps: number[];
}

const globalForRateLimit = globalThis as unknown as {
  __rateLimit?: Map<string, WindowState>;
};

const buckets = (globalForRateLimit.__rateLimit ??= new Map<string, WindowState>());

const WINDOW_MS = 10_000;
const DEFAULT_LIMIT = 30;

export function enforceRateLimit(key: string, limit = DEFAULT_LIMIT): void {
  const now = Date.now();
  const state = buckets.get(key) ?? { timestamps: [] };
  const fresh = state.timestamps.filter((t) => now - t < WINDOW_MS);

  if (fresh.length >= limit) {
    throw new AppError(
      "RATE_LIMITED",
      "Quá nhiều request — thử lại sau vài giây.",
      undefined,
      429,
    );
  }

  buckets.set(key, { timestamps: [...fresh, now] });

  // Dọn bucket cũ để Map không phình vô hạn
  if (buckets.size > 500) {
    for (const [k, v] of buckets) {
      if (v.timestamps.every((t) => now - t >= WINDOW_MS)) buckets.delete(k);
    }
  }
}
