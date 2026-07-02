import type { Prisma } from "@/generated/prisma/client";
import type { ReindexUpdate } from "@/lib/services/frameService";

type Tx = Prisma.TransactionClient;

const TEMP_OFFSET = 100_000;

/**
 * Áp dụng danh sách update index trong transaction theo 2 pha để không
 * đụng unique constraint (projectId, index) giữa chừng.
 */
export async function applyIndexUpdates(
  tx: Tx,
  updates: readonly ReindexUpdate[],
): Promise<void> {
  for (const u of updates) {
    await tx.frame.update({
      where: { id: u.id },
      data: { index: u.index + TEMP_OFFSET },
    });
  }
  for (const u of updates) {
    await tx.frame.update({ where: { id: u.id }, data: { index: u.index } });
  }
}
