-- AlterTable
ALTER TABLE "Project" ADD COLUMN "demoSession" TEXT;

-- CreateTable
CREATE TABLE "DirectorRun" (
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
    CONSTRAINT "DirectorRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DirectorStep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "shotIndex" INTEGER,
    "role" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "promptHash" TEXT,
    "outputSummary" TEXT,
    "output" TEXT,
    "critiqueScore" REAL,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "costUsd" REAL NOT NULL DEFAULT 0,
    "imagePath" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DirectorStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DirectorRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "DirectorRun_projectId_idx" ON "DirectorRun"("projectId");

-- CreateIndex
CREATE INDEX "DirectorStep_runId_idx" ON "DirectorStep"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "DirectorStep_runId_seq_key" ON "DirectorStep"("runId", "seq");

