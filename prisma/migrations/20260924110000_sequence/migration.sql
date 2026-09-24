-- Sequence: cảnh + chuyển cảnh vào frame
ALTER TABLE "Frame" ADD COLUMN "scene" TEXT;
ALTER TABLE "Frame" ADD COLUMN "transition" TEXT NOT NULL DEFAULT 'cut';
ALTER TABLE "Frame" ADD COLUMN "transitionDuration" REAL NOT NULL DEFAULT 0.5;
