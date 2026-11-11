-- Checkout sessions: the priced, stock-reserved basket a customer is about to pay for.
CREATE TABLE "cart"."checkout_sessions" (
  "id"             UUID        NOT NULL,
  "customerId"     UUID        NOT NULL,
  "idempotencyKey" TEXT        NOT NULL,
  "status"         TEXT        NOT NULL DEFAULT 'awaiting_payment',
  "currency"       CHAR(3)     NOT NULL,
  "lines"          JSONB       NOT NULL,
  "address"        JSONB       NOT NULL,
  "subtotalMinor"  BIGINT      NOT NULL,
  "deliveryMinor"  BIGINT      NOT NULL,
  "totalMinor"     BIGINT      NOT NULL,
  "weightGrams"    INTEGER     NOT NULL,
  "expiresAt"      TIMESTAMPTZ NOT NULL,
  "version"        INTEGER     NOT NULL DEFAULT 0,
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"      TIMESTAMPTZ NOT NULL,
  CONSTRAINT "checkout_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "checkout_sessions_status_valid" CHECK ("status" IN ('awaiting_payment', 'cancelled', 'expired', 'paid')),
  CONSTRAINT "checkout_sessions_amounts_valid" CHECK (
    "subtotalMinor" > 0 AND "deliveryMinor" >= 0 AND "totalMinor" = "subtotalMinor" + "deliveryMinor"
  )
);
CREATE UNIQUE INDEX "checkout_sessions_customerId_idempotencyKey_key" ON "cart"."checkout_sessions"("customerId", "idempotencyKey");
CREATE INDEX "checkout_sessions_customerId_status_idx" ON "cart"."checkout_sessions"("customerId", "status");

-- Carts belong to exactly one owner, and each customer has at most one.
ALTER TABLE "cart"."carts" ADD CONSTRAINT "carts_single_owner" CHECK (("customerId" IS NULL) <> ("guestToken" IS NULL));
CREATE UNIQUE INDEX "carts_customerId_key" ON "cart"."carts"("customerId") WHERE "customerId" IS NOT NULL;
ALTER TABLE "cart"."carts" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "cart"."cart_items" ADD CONSTRAINT "cart_items_quantity_positive" CHECK ("quantity" > 0);

-- A checkout holds each stock item at most once; statuses are a closed set.
CREATE UNIQUE INDEX "stock_reservations_checkoutId_stockItemId_key" ON "inventory"."stock_reservations"("checkoutId", "stockItemId");
ALTER TABLE "inventory"."stock_reservations"
  ADD CONSTRAINT "stock_reservations_status_valid" CHECK ("status" IN ('held', 'released', 'expired', 'committed'));
ALTER TABLE "inventory"."stock_reservations" ADD COLUMN "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE "shipping"."delivery_rates"
  ADD CONSTRAINT "delivery_rates_values_valid" CHECK ("maxWeightGrams" > 0 AND "priceMinor" >= 0);
