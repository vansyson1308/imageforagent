-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "artworkDefs" TEXT,
    "aspectRatio" TEXT NOT NULL DEFAULT '16:9',
    "resolution" TEXT NOT NULL DEFAULT '1K',
    "playbackSpeed" REAL NOT NULL DEFAULT 1.5,
    "sheetUrl" TEXT,
    "wmPosition" TEXT NOT NULL DEFAULT 'bottom-right',
    "wmScale" REAL NOT NULL DEFAULT 12,
    "wmOpacity" REAL NOT NULL DEFAULT 0.85,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Frame" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "shotType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "artworkSvg" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "imagePath" TEXT,
    "rawImagePath" TEXT,
    "errorMsg" TEXT,
    "generatedAt" DATETIME,
    CONSTRAINT "Frame_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Asset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Frame_projectId_index_key" ON "Frame"("projectId", "index");

