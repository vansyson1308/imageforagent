import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { handleRoute } from "@/lib/services/routeHelpers";
import { enforceRateLimit } from "@/lib/services/rateLimit";
import { storageRoot, toPosix } from "@/lib/services/storage";
import { logger } from "@/lib/services/logger";

/**
 * Dọn file mồ côi trong storage: file không còn được Asset/Frame nào
 * tham chiếu, và thư mục của project đã xoá. Chạy thủ công khi cần.
 */
export async function POST(): Promise<Response> {
  return handleRoute(async () => {
    enforceRateLimit("maintenance:cleanup", 2);

    const [assets, frames, projects] = await Promise.all([
      prisma.asset.findMany({ select: { filePath: true } }),
      prisma.frame.findMany({
        select: { id: true, projectId: true, imagePath: true, rawImagePath: true, clipDir: true, clipPath: true, voicePath: true },
      }),
      prisma.project.findMany({ select: { id: true, musicPath: true } }),
    ]);

    const referenced = new Set<string>();
    /** Thư mục chuỗi PNG của shot motion — mọi file bên trong đều được tham chiếu. */
    const referencedDirs: string[] = [];
    for (const a of assets) referenced.add(a.filePath);
    for (const f of frames) {
      if (f.imagePath) referenced.add(f.imagePath);
      if (f.rawImagePath) referenced.add(f.rawImagePath);
      if (f.clipPath) referenced.add(f.clipPath);
      if (f.voicePath) referenced.add(f.voicePath);
      if (f.clipDir) referencedDirs.push(`${f.clipDir}/`);
      // Control passes của frame còn tồn tại
      referencedDirs.push(`${f.projectId}/passes/${f.id}/`);
    }
    const projectIds = new Set(projects.map((p) => p.id));
    for (const p of projects) if (p.musicPath) referenced.add(p.musicPath);

    const root = storageRoot();
    let removedFiles = 0;
    let removedDirs = 0;

    let entries: string[] = [];
    try {
      entries = await fs.readdir(root);
    } catch {
      return Response.json({ ok: true, removedFiles: 0, removedDirs: 0 });
    }

    for (const entry of entries) {
      if (entry.startsWith("_")) continue; // thư mục kỹ thuật (_smoke...)
      const entryPath = path.join(root, entry);
      const stat = await fs.stat(entryPath).catch(() => null);
      if (!stat?.isDirectory()) continue;

      if (!projectIds.has(entry)) {
        await fs.rm(entryPath, { recursive: true, force: true });
        removedDirs++;
        continue;
      }

      // Duyệt file trong project dir, xoá file không được tham chiếu
      const stack = [entryPath];
      while (stack.length > 0) {
        const dir = stack.pop()!;
        const children = await fs.readdir(dir).catch(() => []);
        for (const child of children) {
          const childPath = path.join(dir, child);
          const childStat = await fs.stat(childPath).catch(() => null);
          if (!childStat) continue;
          if (childStat.isDirectory()) {
            stack.push(childPath);
          } else {
            const relPath = toPosix(path.relative(root, childPath));
            // Grace period 10 phút: file vừa ghi có thể chưa kịp commit path
            // vào DB (job đang chạy) — không được xoá nhầm ảnh vừa trả tiền
            const isRecent = Date.now() - childStat.mtimeMs < 10 * 60 * 1000;
            const inClipDir = referencedDirs.some((d) => relPath.startsWith(d));
            if (!referenced.has(relPath) && !inClipDir && !isRecent) {
              await fs.unlink(childPath).catch(() => {});
              removedFiles++;
            }
          }
        }
      }
    }

    logger.info({ removedFiles, removedDirs }, "storage cleanup done");
    return Response.json({ ok: true, removedFiles, removedDirs });
  });
}
