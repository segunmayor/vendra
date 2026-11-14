-- Staff cancellation of orders, and stock given back when an order is cancelled.

ALTER TABLE "orders"."orders"
  ADD COLUMN "cancelledAt" TIMESTAMPTZ,
  ADD COLUMN "cancelledBy" UUID,
  ADD COLUMN "cancellationReason" TEXT;

-- A cancelled order always says when, by whom and why; no other order does.
ALTER TABLE "orders"."orders" ADD CONSTRAINT "orders_cancellation_complete"
  CHECK (
    ("status" = 'cancelled') = ("cancelledAt" IS NOT NULL)
    AND ("cancelledAt" IS NULL) = ("cancelledBy" IS NULL)
    AND ("cancelledAt" IS NULL) = ("cancellationReason" IS NULL)
  );

-- Committed stock that went back on sale because its order was cancelled.
ALTER TABLE "inventory"."stock_reservations" DROP CONSTRAINT "stock_reservations_status_valid";
ALTER TABLE "inventory"."stock_reservations" ADD CONSTRAINT "stock_reservations_status_valid"
  CHECK ("status" IN ('held', 'released', 'expired', 'committed', 'returned'));
