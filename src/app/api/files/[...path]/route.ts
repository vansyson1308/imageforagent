import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";
import { handleRoute } from "@/lib/services/routeHelpers";
import { AppError } from "@/lib/services/apiError";
import { resolveStoragePath } from "@/lib/services/storage";

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

interface RouteContext {
  params: Promise<{ path: string[] }>;
}

/**
 * Serve file từ STORAGE_ROOT — traversal guard trong resolveStoragePath.
 * Hỗ trợ HTTP Range (206) để <video>/<audio> seek được.
 * Cache-Control: no-store vì file có thể bị ghi đè cùng đường dẫn.
 */
export async function GET(req: Request, ctx: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    const { path: segments } = await ctx.params;
    const relPath = segments.map(decodeURIComponent).join("/");
    const absolute = resolveStoragePath(relPath);

    let stat;
    try {
      stat = await fs.stat(absolute);
    } catch {
      throw new AppError("NOT_FOUND", "File không tồn tại.");
    }
    if (!stat.isFile()) throw new AppError("NOT_FOUND", "File không tồn tại.");

    const contentType =
      CONTENT_TYPES[path.extname(absolute).toLowerCase()] ?? "application/octet-stream";
    const size = stat.size;

    const baseHeaders: Record<string, string> = {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      "Accept-Ranges": "bytes",
    };

    // Range đơn: "bytes=start-end"
    const rangeHeader = req.headers.get("range");
    const match = rangeHeader?.match(/^bytes=(\d*)-(\d*)$/);
    if (match && (match[1] !== "" || match[2] !== "")) {
      let start: number;
      let end: number;
      if (match[1] === "") {
        // suffix range: cuối N byte
        const suffix = Math.min(Number(match[2]), size);
        start = size - suffix;
        end = size - 1;
      } else {
        start = Number(match[1]);
        end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
      }
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${size}` },
        });
      }

      const stream = createReadStream(absolute, { start, end });
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 206,
        headers: {
          ...baseHeaders,
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Content-Length": String(end - start + 1),
        },
      });
    }

    const stream = createReadStream(absolute);
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      headers: { ...baseHeaders, "Content-Length": String(size) },
    });
  });
}
