-- Staff two-step sign-in (TOTP, RFC 6238). The secret is encrypted by the API (AES-256-GCM),
-- like gateway credentials. "mfaLastStep" is the last 30-second step accepted, so a code can
-- never be used twice.
ALTER TABLE "identity"."accounts" ADD COLUMN "mfaEnabledAt" TIMESTAMPTZ;
ALTER TABLE "identity"."accounts" ADD COLUMN "mfaLastStep" BIGINT;

-- Whether this session passed a second factor. Rotating a refresh token keeps the flag.
ALTER TABLE "identity"."sessions" ADD COLUMN "mfa" BOOLEAN NOT NULL DEFAULT false;

-- Single-use recovery codes, stored as SHA-256 hashes (each code has 50 bits of randomness).
CREATE TABLE "identity"."mfa_recovery_codes" (
  "id"        UUID        NOT NULL,
  "accountId" UUID        NOT NULL,
  "codeHash"  TEXT        NOT NULL,
  "usedAt"    TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "mfa_recovery_codes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mfa_recovery_codes_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "identity"."accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "mfa_recovery_codes_accountId_codeHash_key" ON "identity"."mfa_recovery_codes"("accountId", "codeHash");

-- After a correct password, the second step is tied to a short-lived, single-use challenge.
CREATE TABLE "identity"."mfa_challenges" (
  "id"        UUID        NOT NULL,
  "accountId" UUID        NOT NULL,
  "tokenHash" TEXT        NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "attempts"  INTEGER     NOT NULL DEFAULT 0,
  "usedAt"    TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "mfa_challenges_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mfa_challenges_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "identity"."accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "mfa_challenges_tokenHash_key" ON "identity"."mfa_challenges"("tokenHash");
CREATE INDEX "mfa_challenges_accountId_idx" ON "identity"."mfa_challenges"("accountId");

-- Refunds. Money being returned is reserved on the payment ("refundPendingMinor") the moment
-- a refund is requested, so two staff can never refund more than was paid.
ALTER TABLE "payments"."payments" ADD COLUMN "refundPendingMinor" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "payments"."payments" DROP CONSTRAINT "payments_amounts_valid";
ALTER TABLE "payments"."payments" ADD CONSTRAINT "payments_amounts_valid"
  CHECK ("amountMinor" > 0 AND "refundedMinor" >= 0 AND "refundPendingMinor" >= 0
         AND "refundedMinor" + "refundPendingMinor" <= "amountMinor");

ALTER TABLE "payments"."refunds" ADD COLUMN "gatewayStatus" TEXT;
ALTER TABLE "payments"."refunds" ADD COLUMN "failureReason" TEXT;
ALTER TABLE "payments"."refunds" ADD COLUMN "resolvedBy" UUID;
ALTER TABLE "payments"."refunds" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "payments"."refunds" ADD COLUMN "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE "payments"."refunds" ADD CONSTRAINT "refunds_status_valid"
  CHECK ("status" IN ('pending', 'submitted', 'succeeded', 'failed', 'unknown'));
