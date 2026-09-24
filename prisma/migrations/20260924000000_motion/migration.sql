-- Motion engine (construct v4): một frame có thể là một shot hoạt hình
ALTER TABLE "Frame" ADD COLUMN "motionSpec" TEXT;
ALTER TABLE "Frame" ADD COLUMN "clipDir" TEXT;
ALTER TABLE "Frame" ADD COLUMN "clipPath" TEXT;
ALTER TABLE "Frame" ADD COLUMN "clipFps" INTEGER;
ALTER TABLE "Frame" ADD COLUMN "clipFrameCount" INTEGER;
ALTER TABLE "Frame" ADD COLUMN "clipDuration" REAL;
