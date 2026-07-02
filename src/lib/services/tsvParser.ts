import { MAX_FRAMES_PER_PROJECT } from "@/lib/config/limits";

export interface ParsedFrame {
  readonly index: number; // 1-based, luôn liên tục sau khi parse
  readonly shotType: string;
  readonly description: string;
}

export interface ParseIssue {
  readonly line: number; // 1-based theo văn bản gốc
  readonly message: string;
}

export type ParseResult =
  | { readonly ok: true; readonly frames: readonly ParsedFrame[] }
  | { readonly ok: false; readonly errors: readonly ParseIssue[] };

const DEFAULT_SHOT_TYPE = "Static shot";

const HEADER_KEYWORDS = [
  "stt",
  "frame",
  "shot type",
  "shot",
  "loại cảnh",
  "loai canh",
  "description",
  "mô tả",
  "mo ta",
];

/**
 * Tách văn bản TSV thành các "record" — hỗ trợ ô trong ngoặc kép chứa
 * tab/xuống dòng và escape `""`. Trả về records kèm số dòng bắt đầu.
 */
function tokenizeTsv(
  text: string,
): ReadonlyArray<{ readonly cells: readonly string[]; readonly line: number }> {
  const records: Array<{ cells: string[]; line: number }> = [];
  let cells: string[] = [];
  let cell = "";
  let inQuotes = false;
  let line = 1;
  let recordStartLine = 1;
  let recordHasContent = false;

  const pushCell = () => {
    cells.push(cell.trim());
    cell = "";
  };
  const pushRecord = () => {
    pushCell();
    if (recordHasContent || cells.some((c) => c !== "")) {
      records.push({ cells, line: recordStartLine });
    }
    cells = [];
    recordHasContent = false;
    recordStartLine = line;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === "\n") line++;
        cell += ch;
      }
      continue;
    }

    if (ch === '"' && cell.trim() === "") {
      inQuotes = true;
      recordHasContent = true;
    } else if (ch === "\t") {
      pushCell();
    } else if (ch === "\r") {
      // bỏ qua — xử lý CRLF ở nhánh \n
    } else if (ch === "\n") {
      line++;
      pushRecord();
    } else {
      if (ch.trim() !== "") recordHasContent = true;
      cell += ch;
    }
  }
  pushRecord();

  return records;
}

function isHeaderRow(cells: readonly string[]): boolean {
  const joined = cells.join(" ").toLowerCase();
  return HEADER_KEYWORDS.some((kw) => joined.includes(kw)) && !/\d{2,}/.test(joined);
}

/**
 * Parse TSV/text kịch bản → danh sách frame.
 * Định dạng: [STT] | Shot Type | Description (header dòng 1, STT tùy chọn).
 * Pure function — không side effect.
 */
export function parseTsv(rawText: string): ParseResult {
  // Strip BOM (U+FEFF)
  const text = rawText.charCodeAt(0) === 0xfeff ? rawText.slice(1) : rawText;
  if (text.trim() === "") {
    return { ok: false, errors: [{ line: 1, message: "Nội dung trống — chưa có dòng kịch bản nào." }] };
  }

  const records = tokenizeTsv(text);
  if (records.length === 0) {
    return { ok: false, errors: [{ line: 1, message: "Không tìm thấy dòng dữ liệu hợp lệ." }] };
  }

  const dataRecords = isHeaderRow(records[0].cells) ? records.slice(1) : records;
  if (dataRecords.length === 0) {
    return { ok: false, errors: [{ line: records[0].line, message: "Chỉ có dòng header, chưa có dòng kịch bản nào." }] };
  }
  if (dataRecords.length > MAX_FRAMES_PER_PROJECT) {
    return {
      ok: false,
      errors: [{ line: 1, message: `Quá ${MAX_FRAMES_PER_PROJECT} frame — vui lòng chia nhỏ kịch bản.` }],
    };
  }

  const errors: ParseIssue[] = [];
  const frames: ParsedFrame[] = [];

  for (const record of dataRecords) {
    const cells = record.cells;
    // Bố cục cột: 3+ cột → [STT, shotType, description...]; 2 cột → [shotType, description]; 1 cột → [description]
    let shotType: string;
    let description: string;

    if (cells.length >= 3) {
      shotType = cells[1];
      description = cells.slice(2).join(" ").trim();
    } else if (cells.length === 2) {
      // Nếu ô đầu là số → coi là STT, ô sau là description
      if (/^\d+$/.test(cells[0])) {
        shotType = "";
        description = cells[1];
      } else {
        shotType = cells[0];
        description = cells[1];
      }
    } else {
      shotType = "";
      description = cells[0] ?? "";
    }

    if (description.trim() === "") {
      errors.push({
        line: record.line,
        message: `Dòng ${record.line}: thiếu Description (mô tả cảnh).`,
      });
      continue;
    }

    frames.push({
      index: frames.length + 1,
      shotType: shotType.trim() === "" ? DEFAULT_SHOT_TYPE : shotType.trim(),
      description: description.trim(),
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  if (frames.length === 0) {
    return { ok: false, errors: [{ line: 1, message: "Không có frame hợp lệ nào sau khi parse." }] };
  }

  return { ok: true, frames };
}
