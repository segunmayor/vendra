-- Manual dispatch and tracking (Step 8).

-- Who carries the shipment, as staff entered it.
ALTER TABLE "shipping"."shipments" ADD COLUMN "courier" TEXT;
ALTER TABLE "shipping"."shipments" ADD COLUMN "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now();

-- Tracking numbers are unique per courier, not across all couriers.
DROP INDEX "shipping"."shipments_trackingReference_key";
CREATE UNIQUE INDEX "shipments_courier_trackingReference_key" ON "shipping"."shipments"("courier", "trackingReference");

-- Items are sent once at a time: a seller order has at most one shipment that is not
-- cancelled or returned, however many staff press "send" at the same moment.
CREATE UNIQUE INDEX "shipments_one_open_per_seller_order" ON "shipping"."shipments"("sellerOrderId")
  WHERE "status" NOT IN ('cancelled', 'returned');

ALTER TABLE "shipping"."shipment_items" ADD CONSTRAINT "shipment_items_quantity_check" CHECK ("quantity" > 0);

-- Delivery recognises the sale: the default accounts for item prices and delivery charges.
INSERT INTO "ledger"."accounts" ("code", "name", "type") VALUES
  ('4000', 'Sales', 'income'),
  ('4100', 'Delivery charges', 'income')
ON CONFLICT ("code") DO NOTHING;
