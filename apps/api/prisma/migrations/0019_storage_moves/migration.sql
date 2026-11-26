-- Jobs that move existing files into the active storage location.
CREATE TABLE "storage"."move_jobs" (
    "id" UUID NOT NULL,
    "targetLocationId" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "deleteOld" BOOLEAN NOT NULL,
    "total" INTEGER NOT NULL,
    "moved" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "movedBytes" BIGINT NOT NULL DEFAULT 0,
    "cursor" JSONB NOT NULL DEFAULT '{}',
    "problems" JSONB NOT NULL DEFAULT '[]',
    "message" TEXT,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMPTZ,
    "finishedAt" TIMESTAMPTZ,
    "leaseUntil" TIMESTAMPTZ,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "move_jobs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "move_jobs_status" CHECK ("status" IN ('queued', 'running', 'completed', 'cancelled', 'failed'))
);

CREATE INDEX "move_jobs_createdAt_idx" ON "storage"."move_jobs"("createdAt");
-- One move at a time.
CREATE UNIQUE INDEX "move_jobs_one_open" ON "storage"."move_jobs" ((true)) WHERE "status" IN ('queued', 'running');

-- A copy kept in an old location after its file was moved. Not counted as in use.
ALTER TABLE "storage"."objects" ADD COLUMN "supersededAt" TIMESTAMPTZ;
