-- Refunds as orders knows them, recorded from PaymentRefunded, so staff can see which
-- cancelled or stock issue orders are still owed money without orders reading payments.

CREATE TABLE "orders"."order_refunds" (
  "refundId"    UUID PRIMARY KEY,
  "orderId"     UUID NOT NULL,
  "amountMinor" BIGINT NOT NULL CHECK ("amountMinor" > 0),
  "refundedAt"  TIMESTAMPTZ NOT NULL
);
ALTER TABLE "orders"."order_refunds" ADD CONSTRAINT "order_refunds_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"."orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "order_refunds_orderId_idx" ON "orders"."order_refunds"("orderId");
CREATE INDEX "orders_paymentId_idx" ON "orders"."orders"("paymentId");

-- Refunds already completed before this migration.
INSERT INTO "orders"."order_refunds" ("refundId", "orderId", "amountMinor", "refundedAt")
SELECT r."id", o."id", r."amountMinor", r."updatedAt"
FROM "payments"."refunds" r
JOIN "orders"."orders" o ON o."paymentId" = r."paymentId"
WHERE r."status" = 'succeeded';
