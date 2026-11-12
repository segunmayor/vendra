-- Business settings edited by staff in the admin portal. Values are JSON, validated by the API.
CREATE TABLE "platform"."settings" (
  "key"       TEXT        NOT NULL,
  "value"     JSONB       NOT NULL,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedBy" UUID,
  CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- Payment gateways configured by staff. Credentials are encrypted by the API (AES-256-GCM);
-- the database never holds them in plain text. "secretHints" keeps only the last 4 characters.
CREATE TABLE "payments"."gateways" (
  "id"          UUID        NOT NULL,
  "type"        TEXT        NOT NULL,
  "name"        TEXT        NOT NULL,
  "enabled"     BOOLEAN     NOT NULL DEFAULT false,
  "mode"        TEXT        NOT NULL DEFAULT 'test',
  "position"    INTEGER     NOT NULL DEFAULT 0,
  "config"      JSONB       NOT NULL DEFAULT '{}',
  "secrets"     TEXT,
  "secretHints" JSONB       NOT NULL DEFAULT '{}',
  "version"     INTEGER     NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"   TIMESTAMPTZ NOT NULL,
  CONSTRAINT "gateways_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "gateways_mode_valid" CHECK ("mode" IN ('test', 'live'))
);

-- A payment starts from a checkout session; the order is created only once payment is verified.
ALTER TABLE "payments"."payments" RENAME COLUMN "orderId" TO "checkoutId";
ALTER INDEX "payments"."payments_orderId_idx" RENAME TO "payments_checkoutId_idx";
ALTER TABLE "payments"."payments" ADD COLUMN "gatewayId" UUID;
ALTER TABLE "payments"."payments" ADD COLUMN "redirectUrl" TEXT;
ALTER TABLE "payments"."payments" ADD CONSTRAINT "payments_amount_positive" CHECK ("amountMinor" > 0);
CREATE INDEX "payments_gatewayId_idx" ON "payments"."payments"("gatewayId");

-- Checkout records which payment settled it, and whether stock could not be secured.
ALTER TABLE "cart"."checkout_sessions" ADD COLUMN "paymentId" UUID;
ALTER TABLE "cart"."checkout_sessions" ADD COLUMN "stockIssue" BOOLEAN NOT NULL DEFAULT false;

-- Starting chart of accounts. Staff can map postings to other accounts in Settings.
INSERT INTO "ledger"."accounts" ("code", "name", "type") VALUES
  ('1100', 'Payment gateway clearing', 'asset'),
  ('2100', 'Customer prepayments', 'liability')
ON CONFLICT ("code") DO NOTHING;
