CREATE TABLE "identity"."login_failures" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "login_failures_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "login_failures_key_occurredAt_idx" ON "identity"."login_failures"("key", "occurredAt");
