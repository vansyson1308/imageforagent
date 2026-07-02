import path from "node:path";
import fs from "node:fs/promises";
import { AppError } from "@/lib/services/apiError";

/**
 * Mọi đường dẫn file lưu trong DB là relative POSIX (vd "proj1/frames/f1.png").
 * Join với STORAGE_ROOT tại thời điểm đọc/ghi; chặn path traversal tại đây.
 */

export function storageRoot(): string {
  return path.resolve(process.cwd(), process.env.STORAGE_ROOT ?? "./storage");
}

export function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

/** Resolve đường dẫn relative → absolute, chặn thoát ra ngoài STORAGE_ROOT. */
export function resolveStoragePath(relPath: string): string {
  const root = storageRoot();
  const resolved = path.resolve(root, relPath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new AppError("VALIDATION", "Đường dẫn file không hợp lệ.", undefined, 400);
  }
  return resolved;
}

export async function saveBuffer(relPath: string, data: Buffer): Promise<void> {
  const absolute = resolveStoragePath(relPath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, data);
}

export async function readBuffer(relPath: string): Promise<Buffer> {
  const absolute = resolveStoragePath(relPath);
  return fs.readFile(absolute);
}

export async function fileExists(relPath: string): Promise<boolean> {
  try {
    await fs.access(resolveStoragePath(relPath));
    return true;
  } catch {
    return false;
  }
}

export async function removeQuiet(relPath: string): Promise<void> {
  try {
    await fs.unlink(resolveStoragePath(relPath));
  } catch {
    // file không tồn tại — bỏ qua
  }
}

export async function removeDirQuiet(relDir: string): Promise<void> {
  try {
    await fs.rm(resolveStoragePath(relDir), { recursive: true, force: true });
  } catch {
    // bỏ qua
  }
}
