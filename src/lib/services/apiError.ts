export type ErrorCode =
  | "SHEET_NOT_SHARED"
  | "SHEET_NOT_FOUND"
  | "SHEET_BAD_FORMAT"
  | "ASSET_LIMIT"
  | "ASSET_BAD_TYPE"
  | "ASSET_TOO_LARGE"
  | "ARTWORK_INVALID"
  | "CONSTRUCTION_INVALID"
  | "CONFIRM_REQUIRED"
  | "VALIDATION"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "INTERNAL";

const DEFAULT_STATUS: Record<ErrorCode, number> = {
  SHEET_NOT_SHARED: 403,
  SHEET_NOT_FOUND: 404,
  SHEET_BAD_FORMAT: 422,
  ASSET_LIMIT: 422,
  ASSET_BAD_TYPE: 422,
  ASSET_TOO_LARGE: 422,
  ARTWORK_INVALID: 422,
  CONSTRUCTION_INVALID: 422,
  CONFIRM_REQUIRED: 409,
  VALIDATION: 400,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly hint?: string;
  readonly status: number;

  constructor(code: ErrorCode, message: string, hint?: string, status?: number) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.hint = hint;
    this.status = status ?? DEFAULT_STATUS[code];
  }
}

export interface ErrorBody {
  readonly error: {
    readonly code: ErrorCode;
    readonly message: string;
    readonly hint?: string;
  };
}

export function toErrorBody(err: unknown): { body: ErrorBody; status: number } {
  if (err instanceof AppError) {
    return {
      body: { error: { code: err.code, message: err.message, hint: err.hint } },
      status: err.status,
    };
  }
  // Production: không echo message nội bộ (path tuyệt đối, chi tiết Prisma/sharp)
  // ra client — chi tiết đã được log server-side ở handleRoute.
  const message =
    process.env.NODE_ENV === "production"
      ? "Lỗi hệ thống — chi tiết đã được ghi log."
      : err instanceof Error
        ? err.message
        : "Lỗi không xác định.";
  return { body: { error: { code: "INTERNAL", message } }, status: 500 };
}

export function errorResponse(err: unknown): Response {
  const { body, status } = toErrorBody(err);
  return Response.json(body, { status });
}
