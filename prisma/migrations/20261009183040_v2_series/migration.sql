-- CreateTable
CREATE TABLE "Series" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "style" TEXT NOT NULL DEFAULT 'storybook',
    "bible" TEXT NOT NULL,
    "library" TEXT NOT NULL,
    "kits" TEXT NOT NULL DEFAULT '{}',
    "voices" TEXT NOT NULL DEFAULT '{}',
    "sourceRunId" TEXT,
    "demoSession" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DirectorRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "story" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "style" TEXT NOT NULL DEFAULT 'storybook',
    "status" TEXT NOT NULL DEFAULT 'running',
    "provider" TEXT NOT NULL DEFAULT 'nemotron',
    "models" TEXT NOT NULL,
    "config" TEXT NOT NULL,
    "bible" TEXT,
    "summary" TEXT,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "costUsd" REAL NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "library" TEXT,
    "kits" TEXT,
    "voices" TEXT,
    "seriesId" TEXT,
    CONSTRAINT "DirectorRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DirectorRun_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_DirectorRun" ("bible", "config", "costUsd", "error", "finishedAt", "id", "language", "models", "projectId", "provider", "startedAt", "status", "story", "style", "summary", "tokensIn", "tokensOut") SELECT "bible", "config", "costUsd", "error", "finishedAt", "id", "language", "models", "projectId", "provider", "startedAt", "status", "story", "style", "summary", "tokensIn", "tokensOut" FROM "DirectorRun";
DROP TABLE "DirectorRun";
ALTER TABLE "new_DirectorRun" RENAME TO "DirectorRun";
CREATE INDEX "DirectorRun_projectId_idx" ON "DirectorRun"("projectId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
