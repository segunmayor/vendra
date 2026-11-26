-- Moves can copy several files at the same time.
ALTER TABLE "storage"."move_jobs" ADD COLUMN "concurrency" INTEGER NOT NULL DEFAULT 1,
  ADD CONSTRAINT "move_jobs_concurrency" CHECK ("concurrency" BETWEEN 1 AND 10);
