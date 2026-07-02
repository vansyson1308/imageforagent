import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/services/apiError";
import { logger } from "@/lib/services/logger";
import { compose } from "@/lib/services/promptComposer";
import { getImageProvider } from "@/lib/providers";
import type { ImageProvider } from "@/lib/providers/types";
import { applyWatermark } from "@/lib/services/watermarker";
import { saveBuffer, toPosix } from "@/lib/services/storage";
import { assertDailyBudget, logGeneration } from "@/lib/services/costGuard";

export interface GenerationJob {
  readonly id: string;
  readonly projectId: string;
  readonly frameIds: readonly string[];
  cancelled: boolean;
  running: boolean;
}

const globalForJobs = globalThis as unknown as {
  __generationJobs?: Map<string, GenerationJob>;
  __jobBootSweepDone?: boolean;
};

const jobs = (globalForJobs.__generationJobs ??= new Map<string, GenerationJob>());

const RETRY_BACKOFF_MS = [2_000, 8_000]; // tối đa 2 retry theo spec mục 5
const NO_RETRY_CODES = new Set(["PROVIDER_SAFETY_BLOCK", "DAILY_LIMIT", "VALIDATION"]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Boot sweep: sau khi process khởi động lại, frame kẹt ở trạng thái trung gian
 * (pending/generating/watermarking) mà không có job nào trong bộ nhớ → failed
 * để user regenerate chọn lọc. (ADR: đơn giản hoá T5.3 thay vì resume job.)
 */
async function bootSweepOnce(): Promise<void> {
  if (globalForJobs.__jobBootSweepDone) return;
  globalForJobs.__jobBootSweepDone = true;
  const activeFrameIds = new Set(
    [...jobs.values()].filter((j) => j.running).flatMap((j) => [...j.frameIds]),
  );
  const stuck = await prisma.frame.findMany({
    where: { status: { in: ["pending", "generating", "watermarking"] } },
    select: { id: true },
  });
  const orphaned = stuck.map((f) => f.id).filter((id) => !activeFrameIds.has(id));
  if (orphaned.length > 0) {
    await prisma.frame.updateMany({
      where: { id: { in: orphaned } },
      data: {
        status: "failed",
        errorMsg: "Bị gián đoạn (server khởi động lại) — bấm Tạo lại frame này.",
      },
    });
    logger.warn({ count: orphaned.length }, "boot sweep: orphaned frames marked failed");
  }
}

export function getJob(jobId: string): GenerationJob | undefined {
  return jobs.get(jobId);
}

export function hasRunningJobForProject(projectId: string): boolean {
  return [...jobs.values()].some((j) => j.projectId === projectId && j.running);
}

export function cancelJob(jobId: string): boolean {
  const job = jobs.get(jobId);
  if (!job) return false;
  job.cancelled = true;
  return true;
}

/**
 * Tạo job generate cho project (frameIds rỗng = tất cả frame).
 * Đánh dấu pending ngay để UI phản hồi tức thì; chạy nền tuần tự.
 */
export async function startJob(
  projectId: string,
  frameIds?: readonly string[],
): Promise<string> {
  await bootSweepOnce();

  if (hasRunningJobForProject(projectId)) {
    throw new AppError(
      "VALIDATION",
      "Đang có job generate chạy cho project này.",
      "Đợi job hiện tại xong hoặc bấm Dừng trước khi chạy lại.",
    );
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { assets: true, frames: { orderBy: { index: "asc" } } },
  });
  if (!project) throw new AppError("NOT_FOUND", "Không tìm thấy project.");
  if (project.frames.length === 0) {
    throw new AppError("VALIDATION", "Project chưa có frame nào — nhập kịch bản trước.");
  }

  const selected =
    frameIds && frameIds.length > 0
      ? project.frames.filter((f) => frameIds.includes(f.id))
      : project.frames;
  if (selected.length === 0) {
    throw new AppError("NOT_FOUND", "Không tìm thấy frame nào khớp danh sách yêu cầu.");
  }

  const provider = getImageProvider();
  const generatable = selected.filter((f) => f.description.trim() !== "");

  if (provider.name !== "mock") {
    await assertDailyBudget(generatable.length);
  }

  // Frame mô tả trống → failed ngay với hint
  const emptyFrames = selected.filter((f) => f.description.trim() === "");
  if (emptyFrames.length > 0) {
    await prisma.frame.updateMany({
      where: { id: { in: emptyFrames.map((f) => f.id) } },
      data: { status: "failed", errorMsg: "Mô tả cảnh đang trống — điền mô tả rồi tạo lại." },
    });
  }

  await prisma.frame.updateMany({
    where: { id: { in: generatable.map((f) => f.id) } },
    data: { status: "pending", errorMsg: null },
  });

  const job: GenerationJob = {
    id: randomUUID(),
    projectId,
    frameIds: generatable.map((f) => f.id),
    cancelled: false,
    running: true,
  };
  jobs.set(job.id, job);

  // Chạy nền — không giữ HTTP request mở
  void runJob(job, provider).catch((err: unknown) => {
    logger.error({ err, jobId: job.id }, "job crashed");
    job.running = false;
  });

  return job.id;
}

async function runJob(job: GenerationJob, provider: ImageProvider): Promise<void> {
  logger.info({ jobId: job.id, frames: job.frameIds.length, provider: provider.name }, "job start");

  for (const frameId of job.frameIds) {
    if (job.cancelled) break;
    await generateFrame(job, frameId, provider);
  }

  if (job.cancelled) {
    // Frame chưa chạy → trả về draft
    await prisma.frame.updateMany({
      where: { id: { in: [...job.frameIds] }, status: "pending" },
      data: { status: "draft" },
    });
  }

  job.running = false;
  logger.info({ jobId: job.id, cancelled: job.cancelled }, "job end");
}

async function generateFrame(
  job: GenerationJob,
  frameId: string,
  provider: ImageProvider,
): Promise<void> {
  const frame = await prisma.frame.findUnique({ where: { id: frameId } });
  if (!frame || frame.status !== "pending") return;

  const project = await prisma.project.findUnique({
    where: { id: job.projectId },
    include: { assets: true, _count: { select: { frames: true } } },
  });
  if (!project) return;

  const request = compose(project, frame, project.assets, project._count.frames);
  const watermarkAsset = project.assets.find((a) => a.kind === "watermark");

  for (let attempt = 0; ; attempt++) {
    if (job.cancelled) return;
    try {
      await prisma.frame.update({
        where: { id: frameId },
        data: { status: "generating", errorMsg: null },
      });

      await logGeneration(job.projectId, frameId, provider.name);
      const image = await provider.generate(request);

      const rawRelPath = toPosix(`${job.projectId}/frames/${frameId}.raw.png`);
      await saveBuffer(rawRelPath, image.data);

      let imageRelPath = rawRelPath;
      if (watermarkAsset) {
        await prisma.frame.update({
          where: { id: frameId },
          data: { status: "watermarking", rawImagePath: rawRelPath },
        });
        imageRelPath = toPosix(`${job.projectId}/frames/${frameId}.wm.png`);
        await applyWatermark(rawRelPath, imageRelPath, watermarkAsset.filePath, {
          position: project.wmPosition,
          scalePercent: project.wmScale,
          opacity: project.wmOpacity,
        });
      }

      await prisma.frame.update({
        where: { id: frameId },
        data: {
          status: "done",
          rawImagePath: rawRelPath,
          imagePath: imageRelPath,
          generatedAt: new Date(),
          errorMsg: null,
        },
      });
      return;
    } catch (err: unknown) {
      const appErr = err instanceof AppError ? err : null;
      const retryable =
        attempt < RETRY_BACKOFF_MS.length &&
        !(appErr && NO_RETRY_CODES.has(appErr.code));

      logger.warn(
        { frameId, attempt, code: appErr?.code, message: appErr?.message ?? String(err) },
        "frame generation failed",
      );

      if (retryable) {
        await sleep(RETRY_BACKOFF_MS[attempt]);
        continue;
      }

      const message = appErr?.message ?? "Lỗi không xác định khi tạo ảnh.";
      const hint = appErr?.hint;
      await prisma.frame.update({
        where: { id: frameId },
        data: {
          status: "failed",
          errorMsg: hint ? `${message} — ${hint}` : message,
        },
      });
      return;
    }
  }
}
