-- CreateTable
CREATE TABLE "Clip" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "frameId" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'per-frame',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "clipPath" TEXT,
    "durationSec" REAL NOT NULL DEFAULT 8,
    "hasNativeAudio" BOOLEAN NOT NULL DEFAULT false,
    "operationName" TEXT,
    "errorMsg" TEXT,
    "generatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Clip_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Clip_frameId_fkey" FOREIGN KEY ("frameId") REFERENCES "Frame" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Frame" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "shotType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "imagePath" TEXT,
    "rawImagePath" TEXT,
    "seed" INTEGER,
    "errorMsg" TEXT,
    "generatedAt" DATETIME,
    "voiceoverText" TEXT,
    "voPath" TEXT,
    "interpToNext" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Frame_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Frame" ("description", "errorMsg", "generatedAt", "id", "imagePath", "index", "projectId", "rawImagePath", "seed", "shotType", "status") SELECT "description", "errorMsg", "generatedAt", "id", "imagePath", "index", "projectId", "rawImagePath", "seed", "shotType", "status" FROM "Frame";
DROP TABLE "Frame";
ALTER TABLE "new_Frame" RENAME TO "Frame";
CREATE UNIQUE INDEX "Frame_projectId_index_key" ON "Frame"("projectId", "index");
CREATE TABLE "new_GenerationLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "frameId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'image',
    "seconds" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_GenerationLog" ("createdAt", "frameId", "id", "projectId", "provider") SELECT "createdAt", "frameId", "id", "projectId", "provider" FROM "GenerationLog";
DROP TABLE "GenerationLog";
ALTER TABLE "new_GenerationLog" RENAME TO "GenerationLog";
CREATE INDEX "GenerationLog_createdAt_idx" ON "GenerationLog"("createdAt");
CREATE TABLE "new_Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "characterDesc" TEXT,
    "aspectRatio" TEXT NOT NULL DEFAULT '16:9',
    "resolution" TEXT NOT NULL DEFAULT '1K',
    "playbackSpeed" REAL NOT NULL DEFAULT 1.5,
    "sheetUrl" TEXT,
    "wmPosition" TEXT NOT NULL DEFAULT 'bottom-right',
    "wmScale" REAL NOT NULL DEFAULT 12,
    "wmOpacity" REAL NOT NULL DEFAULT 0.85,
    "videoTier" TEXT NOT NULL DEFAULT 'animatic',
    "clipDurationSec" INTEGER NOT NULL DEFAULT 8,
    "videoResolution" TEXT NOT NULL DEFAULT '720p',
    "transitionType" TEXT NOT NULL DEFAULT 'cut',
    "transitionSec" REAL NOT NULL DEFAULT 0.4,
    "captionsBurnIn" BOOLEAN NOT NULL DEFAULT true,
    "colorPolish" BOOLEAN NOT NULL DEFAULT true,
    "bgmEnabled" BOOLEAN NOT NULL DEFAULT true,
    "bgmVolumeDb" REAL NOT NULL DEFAULT -6,
    "voiceoverEnabled" BOOLEAN NOT NULL DEFAULT true,
    "nativeAudioEnabled" BOOLEAN NOT NULL DEFAULT true,
    "finalVideoPath" TEXT,
    "finalVideoStatus" TEXT NOT NULL DEFAULT 'none',
    "finalVideoError" TEXT,
    "finalRenderedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Project" ("aspectRatio", "characterDesc", "createdAt", "id", "name", "playbackSpeed", "resolution", "sheetUrl", "updatedAt", "wmOpacity", "wmPosition", "wmScale") SELECT "aspectRatio", "characterDesc", "createdAt", "id", "name", "playbackSpeed", "resolution", "sheetUrl", "updatedAt", "wmOpacity", "wmPosition", "wmScale" FROM "Project";
DROP TABLE "Project";
ALTER TABLE "new_Project" RENAME TO "Project";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Clip_frameId_key" ON "Clip"("frameId");

-- CreateIndex
CREATE UNIQUE INDEX "Clip_projectId_frameId_key" ON "Clip"("projectId", "frameId");
