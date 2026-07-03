import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/services/apiError";
import { handleRoute } from "@/lib/services/routeHelpers";
import { enforceRateLimit } from "@/lib/services/rateLimit";
import { isAssetKind, validateAssetUpload } from "@/lib/config/limits";
import { removeQuiet, saveBuffer } from "@/lib/services/storage";
import { withAssetUrl } from "@/lib/services/dto";

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/**
 * Upload asset (multipart): projectId, kind, files[].
 * Validate mime/size/số lượng theo kind; đổi tên file theo UUID
 * (không dùng tên gốc — tránh path traversal). Watermark mới thay thế cái cũ.
 */
export async function POST(req: Request): Promise<Response> {
  return handleRoute(async () => {
    enforceRateLimit("assets:upload", 20);

    const form = await req.formData().catch(() => {
      throw new AppError("VALIDATION", "Request không phải multipart/form-data.");
    });

    const projectId = String(form.get("projectId") ?? "");
    const kind = String(form.get("kind") ?? "");
    const files = form.getAll("files").filter((f): f is File => f instanceof File);

    if (!projectId) throw new AppError("VALIDATION", "Thiếu projectId.");
    if (!isAssetKind(kind)) {
      throw new AppError("VALIDATION", `kind không hợp lệ: "${kind}".`);
    }

    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new AppError("NOT_FOUND", "Không tìm thấy project.");

    const existing = await prisma.asset.findMany({ where: { projectId, kind } });
    const validation = validateAssetUpload(
      kind,
      existing.length,
      files.map((f) => ({ mimeType: f.type, sizeBytes: f.size })),
    );
    if (!validation.ok) {
      throw new AppError(validation.code, validation.message);
    }

    // Watermark: thay thế — xoá row + file cũ trước
    if (kind === "watermark" && existing.length > 0) {
      await prisma.asset.deleteMany({ where: { projectId, kind } });
      for (const old of existing) {
        await removeQuiet(old.filePath);
      }
    }

    const baseOrder =
      kind === "watermark"
        ? 0
        : existing.reduce((max, a) => Math.max(max, a.order), -1) + 1;

    const created = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const buffer = Buffer.from(await file.arrayBuffer());

      // Defense-in-depth: file.type là header client tự khai — verify magic
      // bytes thật qua sharp trước khi ghi disk
      let format: string | undefined;
      try {
        format = (await sharp(buffer).metadata()).format;
      } catch {
        format = undefined;
      }
      if (!format || !["png", "jpeg", "webp"].includes(format)) {
        throw new AppError(
          "ASSET_BAD_TYPE",
          `File "${file.name}" không phải ảnh PNG/JPEG/WebP hợp lệ.`,
        );
      }

      const ext = EXT_BY_MIME[file.type] ?? "png";
      const relPath = `${projectId}/assets/${randomUUID()}.${ext}`;
      await saveBuffer(relPath, buffer);
      const asset = await prisma.asset.create({
        data: {
          projectId,
          kind,
          filePath: relPath,
          mimeType: file.type,
          order: baseOrder + i,
        },
      });
      created.push(withAssetUrl(asset));
    }

    return Response.json(created, { status: 201 });
  });
}
