import pino from "pino";

// pino thuần (không transport) — pino-pretty worker không ổn định dưới Turbopack.
const globalForLogger = globalThis as unknown as { logger?: pino.Logger };

export const logger: pino.Logger =
  globalForLogger.logger ??
  pino({ level: process.env.LOG_LEVEL ?? "info" });

if (process.env.NODE_ENV !== "production") {
  globalForLogger.logger = logger;
}
