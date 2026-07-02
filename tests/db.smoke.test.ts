import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";

// Smoke test: client Prisma 7 + adapter better-sqlite3 kết nối được DB đã migrate.
describe("prisma client", () => {
  it("connects and counts projects", async () => {
    const count = await prisma.project.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });
});
