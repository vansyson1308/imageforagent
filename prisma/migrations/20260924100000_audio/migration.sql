-- Audio v1: thoại per frame + nhạc nền project
ALTER TABLE "Frame" ADD COLUMN "dialogue" TEXT;
ALTER TABLE "Frame" ADD COLUMN "voicePath" TEXT;
ALTER TABLE "Frame" ADD COLUMN "voiceDuration" REAL;
ALTER TABLE "Frame" ADD COLUMN "voiceOffset" REAL NOT NULL DEFAULT 0;
ALTER TABLE "Project" ADD COLUMN "musicPath" TEXT;
