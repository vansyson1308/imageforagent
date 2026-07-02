import { google } from "googleapis";
import { AppError } from "@/lib/services/apiError";
import { parseTsv, type ParseResult } from "@/lib/services/tsvParser";

interface ServiceAccountCredentials {
  readonly client_email: string;
  readonly private_key: string;
}

function loadCredentials(): ServiceAccountCredentials | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ServiceAccountCredentials>;
    if (!parsed.client_email || !parsed.private_key) return null;
    return { client_email: parsed.client_email, private_key: parsed.private_key };
  } catch {
    return null;
  }
}

export function getServiceAccountEmail(): string | null {
  return loadCredentials()?.client_email ?? null;
}

export interface SheetRef {
  readonly spreadsheetId: string;
  readonly gid: number | null;
}

/** Extract spreadsheetId (+ gid nếu có) từ URL Google Sheet. */
export function extractSheetRef(url: string): SheetRef | null {
  const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch) return null;
  const gidMatch = url.match(/[#&?]gid=(\d+)/);
  return {
    spreadsheetId: idMatch[1],
    gid: gidMatch ? Number(gidMatch[1]) : null,
  };
}

function getStatusCode(err: unknown): number | undefined {
  if (typeof err === "object" && err !== null) {
    const anyErr = err as { code?: unknown; status?: unknown; response?: { status?: unknown } };
    const candidates = [anyErr.code, anyErr.status, anyErr.response?.status];
    for (const c of candidates) {
      const n = Number(c);
      if (Number.isFinite(n) && n >= 400) return n;
    }
  }
  return undefined;
}

/**
 * Đọc Google Sheet qua service account → parse thành frames (tái dùng TsvParser).
 * 403 → SHEET_NOT_SHARED (kèm email cần share), 404 → SHEET_NOT_FOUND.
 */
export async function readSheetScript(sheetUrl: string): Promise<ParseResult> {
  const credentials = loadCredentials();
  if (!credentials) {
    throw new AppError(
      "VALIDATION",
      "Chưa cấu hình Google Service Account.",
      "Thêm GOOGLE_SERVICE_ACCOUNT_JSON vào .env (xem README mục Google Sheets), hoặc dùng tab Dán từ Clipboard.",
    );
  }

  const ref = extractSheetRef(sheetUrl);
  if (!ref) {
    throw new AppError(
      "SHEET_BAD_FORMAT",
      "Link không phải Google Sheet hợp lệ.",
      "Link đúng dạng: https://docs.google.com/spreadsheets/d/<id>/edit",
    );
  }

  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  try {
    // Xác định tên sheet theo gid (mặc định sheet đầu tiên)
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: ref.spreadsheetId,
      fields: "sheets.properties(sheetId,title)",
    });
    const sheetProps = meta.data.sheets?.map((s) => s.properties) ?? [];
    const target =
      ref.gid !== null
        ? sheetProps.find((p) => p?.sheetId === ref.gid)
        : sheetProps[0];
    if (!target?.title) {
      throw new AppError("SHEET_NOT_FOUND", "Không tìm thấy tab sheet tương ứng trong file.");
    }

    const values = await sheets.spreadsheets.values.get({
      spreadsheetId: ref.spreadsheetId,
      range: `'${target.title}'!A1:C1000`,
    });

    const rows = values.data.values ?? [];
    if (rows.length === 0) {
      throw new AppError("SHEET_BAD_FORMAT", "Sheet trống — không có dòng dữ liệu nào.");
    }

    // Ghép lại thành TSV để tái dùng parser (escape quote để an toàn)
    const tsv = rows
      .map((row) =>
        row
          .map((cell) => {
            const text = String(cell ?? "");
            return /[\t\n"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
          })
          .join("\t"),
      )
      .join("\n");

    return parseTsv(tsv);
  } catch (err: unknown) {
    if (err instanceof AppError) throw err;
    const status = getStatusCode(err);
    if (status === 403) {
      throw new AppError(
        "SHEET_NOT_SHARED",
        "Sheet chưa được share cho service account.",
        `Mở Google Sheet → Share → thêm email: ${credentials.client_email} (quyền Viewer).`,
      );
    }
    if (status === 404) {
      throw new AppError("SHEET_NOT_FOUND", "Không tìm thấy Google Sheet với link này.");
    }
    const message = err instanceof Error ? err.message : "Lỗi không xác định";
    throw new AppError("INTERNAL", `Lỗi đọc Google Sheet: ${message}`);
  }
}
