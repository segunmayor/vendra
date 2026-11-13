-- Seller applications and business verification (Step 9).

ALTER TABLE "sellers"."sellers"
  ADD COLUMN "businessKind" TEXT,
  ADD COLUMN "registrationNumber" TEXT,
  ADD COLUMN "taxId" TEXT,
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "address" JSONB,
  ADD COLUMN "description" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "sellers"."sellers"
  ADD CONSTRAINT "sellers_status_check" CHECK ("status" IN ('draft', 'pending_verification', 'changes_requested', 'active', 'rejected', 'suspended')),
  ADD CONSTRAINT "sellers_business_kind_check" CHECK ("businessKind" IS NULL OR "businessKind" IN ('company', 'business_name')),
  ADD CONSTRAINT "sellers_marketplace_details_check" CHECK ("type" <> 'marketplace' OR ("ownerAccount" IS NOT NULL AND "businessKind" IS NOT NULL AND "registrationNumber" IS NOT NULL AND "phone" IS NOT NULL AND "address" IS NOT NULL));

-- One application per seller account.
CREATE UNIQUE INDEX "sellers_one_per_owner" ON "sellers"."sellers" ("ownerAccount") WHERE "ownerAccount" IS NOT NULL;
CREATE INDEX "sellers_type_status_idx" ON "sellers"."sellers" ("type", "status");
CREATE INDEX "sellers_registration_number_idx" ON "sellers"."sellers" ("registrationNumber");

ALTER TABLE "sellers"."verification_cases"
  ADD CONSTRAINT "verification_cases_status_check" CHECK ("status" IN ('submitted', 'approved', 'rejected', 'changes_requested'));
CREATE INDEX "verification_cases_seller_created_idx" ON "sellers"."verification_cases" ("sellerId", "createdAt");

CREATE TABLE "sellers"."seller_documents" (
    "id" UUID NOT NULL,
    "sellerId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "content" BYTEA NOT NULL,
    "uploadedAt" TIMESTAMPTZ NOT NULL,
    "removedAt" TIMESTAMPTZ,

    CONSTRAINT "seller_documents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "seller_documents_kind_check" CHECK ("kind" IN ('registration_certificate', 'owner_id', 'proof_of_address', 'tax_certificate', 'other')),
    CONSTRAINT "seller_documents_type_check" CHECK ("contentType" IN ('application/pdf', 'image/png', 'image/jpeg', 'image/webp')),
    CONSTRAINT "seller_documents_size_check" CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 10485760 AND octet_length("content") = "sizeBytes")
);

CREATE INDEX "seller_documents_sellerId_idx" ON "sellers"."seller_documents" ("sellerId");

ALTER TABLE "sellers"."seller_documents" ADD CONSTRAINT "seller_documents_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "sellers"."sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
