-- Links each journal entry to the customer payment it concerns, so the ledger can tell how
-- much of a payment it still holds as a prepayment. Refunds after delivery then reduce
-- revenue instead of the prepayment, and deliveries after a partial refund recognise only
-- what is left.

-- One transaction: if anything fails, the append-only trigger cannot be left switched off.
BEGIN;

ALTER TABLE "ledger"."journal_entries" ADD COLUMN "paymentId" UUID;
CREATE INDEX "journal_entries_paymentId_idx" ON "ledger"."journal_entries" ("paymentId");

-- Backfill (a one-off data migration; the code never reads other schemas). Only this new
-- column is written; amounts and lines are untouched, so the trigger is off just for this.
ALTER TABLE "ledger"."journal_entries" DISABLE TRIGGER "journal_entries_append_only";
UPDATE "ledger"."journal_entries" SET "paymentId" = "sourceId"::uuid WHERE "sourceType" = 'payment_received';
UPDATE "ledger"."journal_entries" e SET "paymentId" = r."paymentId"
  FROM "payments"."refunds" r WHERE e."sourceType" = 'refund_paid' AND r."id"::text = e."sourceId";
UPDATE "ledger"."journal_entries" e SET "paymentId" = o."paymentId"
  FROM "orders"."orders" o WHERE e."sourceType" = 'order_delivered' AND o."id"::text = e."sourceId";
ALTER TABLE "ledger"."journal_entries" ENABLE TRIGGER "journal_entries_append_only";

INSERT INTO "ledger"."accounts" ("code", "name", "type") VALUES
  ('4900', 'Refunds after delivery', 'income')
ON CONFLICT ("code") DO NOTHING;

COMMIT;
