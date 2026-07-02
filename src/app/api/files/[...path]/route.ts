import fs from "node:fs/promises";
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
 * Serve file từ STORAGE_ROOT — traversal guard nằm trong resolveStoragePath.
 * Cache-Control: no-store vì ảnh có thể bị ghi đè (re-watermark) cùng đường dẫn.
 */
export async function GET(_req: Request, ctx: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    const { path: segments } = await ctx.params;
    const relPath = segments.map(decodeURIComponent).join("/");
    const absolute = resolveStoragePath(relPath);

    let data: Buffer;
    try {
      data = await fs.readFile(absolute);
    } catch {
      throw new AppError("NOT_FOUND", "File không tồn tại.");
    }

    const contentType =
      CONTENT_TYPES[path.extname(absolute).toLowerCase()] ?? "application/octet-stream";

    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
      },
    });
  });
}
