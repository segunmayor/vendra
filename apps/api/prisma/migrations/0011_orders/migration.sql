-- Orders are placed from paid checkouts (Step 7). The tables existed since 0001 but were unused.

-- Order numbers customers can quote on the phone: 100001, 100002, ... Never reused.
CREATE SEQUENCE "orders"."order_number_seq" START WITH 100001;

ALTER TABLE "orders"."orders" ADD COLUMN "checkoutId" UUID NOT NULL;
ALTER TABLE "orders"."orders" ADD COLUMN "paymentId" UUID NOT NULL;
ALTER TABLE "orders"."orders" ADD COLUMN "placedAt" TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE "orders"."orders" ALTER COLUMN "status" SET DEFAULT 'placed';
-- A checkout becomes at most one order, however often the paid event is delivered.
CREATE UNIQUE INDEX "orders_checkoutId_key" ON "orders"."orders"("checkoutId");
CREATE INDEX "orders_status_placedAt_idx" ON "orders"."orders"("status", "placedAt");
ALTER TABLE "orders"."orders" ADD CONSTRAINT "orders_status_valid"
  CHECK ("status" IN ('placed', 'stock_issue', 'cancelled', 'fulfilled'));
ALTER TABLE "orders"."orders" ADD CONSTRAINT "orders_amounts_valid"
  CHECK ("subtotalMinor" >= 0 AND "deliveryMinor" >= 0 AND "discountMinor" >= 0
         AND "totalMinor" = "subtotalMinor" + "deliveryMinor" - "discountMinor");

-- Display order: seller orders and lines keep the order items were bought in.
ALTER TABLE "orders"."seller_orders" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "orders"."order_lines" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "orders"."seller_orders" ADD CONSTRAINT "seller_orders_status_valid"
  CHECK ("status" IN ('pending', 'cancelled', 'dispatched', 'delivered'));

ALTER TABLE "orders"."order_lines" ADD COLUMN "variantId" UUID NOT NULL;
ALTER TABLE "orders"."order_lines" ADD COLUMN "options" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "orders"."order_lines" ADD COLUMN "lineTotalMinor" BIGINT NOT NULL;
ALTER TABLE "orders"."order_lines" ADD CONSTRAINT "order_lines_amounts_valid"
  CHECK ("quantity" > 0 AND "unitPriceMinor" >= 0 AND "lineTotalMinor" = "unitPriceMinor" * "quantity");
