-- Storage locations staff configure in Admin, and the files written to them.
CREATE SCHEMA IF NOT EXISTS "storage";

CREATE TABLE "storage"."locations" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "secrets" TEXT,
    "secretHints" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT false,
    "lastCheckedAt" TIMESTAMPTZ,
    "lastCheckOk" BOOLEAN,
    "lastCheckError" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- At most one active location. With none, files are kept in the database.
CREATE UNIQUE INDEX "locations_one_active" ON "storage"."locations" ("active") WHERE "active";

CREATE TABLE "storage"."objects" (
    "id" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "objects_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "objects_locationId_key_key" ON "storage"."objects"("locationId", "key");
CREATE INDEX "objects_locationId_idx" ON "storage"."objects"("locationId");

ALTER TABLE "storage"."objects" ADD CONSTRAINT "objects_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "storage"."locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Product photos and seller documents: the bytes, or a reference to a stored object. Never neither.
ALTER TABLE "catalogue"."product_media" ALTER COLUMN "content" DROP NOT NULL,
  ADD COLUMN "storageObjectId" UUID;
ALTER TABLE "catalogue"."product_media" ADD CONSTRAINT "product_media_has_file"
  CHECK ("content" IS NOT NULL OR "storageObjectId" IS NOT NULL);

ALTER TABLE "sellers"."seller_documents" ALTER COLUMN "content" DROP NOT NULL,
  ADD COLUMN "storageObjectId" UUID;
ALTER TABLE "sellers"."seller_documents" ADD CONSTRAINT "seller_documents_has_file"
  CHECK ("content" IS NOT NULL OR "storageObjectId" IS NOT NULL);
