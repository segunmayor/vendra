-- Discounts: the usual price, shown struck through next to the selling price.
ALTER TABLE "catalogue"."listings" ADD COLUMN "compareAtMinor" BIGINT;
ALTER TABLE "catalogue"."listings" ADD CONSTRAINT "listings_compare_at_above_price"
  CHECK ("compareAtMinor" IS NULL OR "compareAtMinor" > "priceMinor");

-- Product photos.
CREATE TABLE "catalogue"."product_media" (
    "id" UUID NOT NULL,
    "sha256" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "content" BYTEA NOT NULL,
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "product_media_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "product_media_sha256_key" ON "catalogue"."product_media"("sha256");
CREATE INDEX "product_media_sourceUrl_idx" ON "catalogue"."product_media"("sourceUrl");

-- Bulk product imports.
CREATE TABLE "catalogue"."import_jobs" (
    "id" UUID NOT NULL,
    "format" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "issues" JSONB NOT NULL DEFAULT '[]',
    "summary" JSONB NOT NULL DEFAULT '{}',
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMPTZ,
    "finishedAt" TIMESTAMPTZ,
    "leaseUntil" TIMESTAMPTZ,
    "version" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "import_jobs_status_leaseUntil_idx" ON "catalogue"."import_jobs"("status", "leaseUntil");
CREATE INDEX "import_jobs_createdAt_idx" ON "catalogue"."import_jobs"("createdAt");

CREATE TABLE "catalogue"."import_items" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "handle" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rowNumbers" JSONB NOT NULL,
    "payload" JSONB NOT NULL,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "productId" UUID,
    "processedAt" TIMESTAMPTZ,
    CONSTRAINT "import_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "import_items_jobId_position_key" ON "catalogue"."import_items"("jobId", "position");
CREATE INDEX "import_items_jobId_status_position_idx" ON "catalogue"."import_items"("jobId", "status", "position");
ALTER TABLE "catalogue"."import_items" ADD CONSTRAINT "import_items_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "catalogue"."import_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Importing creates listings and stock, so it is its own permission. Roles that already
-- manage the catalogue keep being able to do everything they could, plus import.
INSERT INTO "identity"."role_permissions" ("roleId", "permission")
SELECT "roleId", 'catalogue.import' FROM "identity"."role_permissions" WHERE "permission" = 'catalogue.manage'
ON CONFLICT DO NOTHING;
