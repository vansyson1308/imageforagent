import { ZodError, type ZodType } from "zod";
import { AppError, errorResponse } from "@/lib/services/apiError";
import { logger } from "@/lib/services/logger";

/** Bọc route handler: bắt AppError/ZodError → error envelope chuẩn, log lỗi 500. */
export async function handleRoute(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err: unknown) {
    if (err instanceof ZodError) {
      const message = err.issues
        .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
        .join("; ");
      return errorResponse(new AppError("VALIDATION", message));
    }
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error({ err }, "route error");
    }
    return errorResponse(err);
  }
}

export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw new AppError("VALIDATION", "Body không phải JSON hợp lệ.");
  }
  return schema.parse(json);
}
