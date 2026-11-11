ALTER TABLE "catalogue"."products" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "stock_movements_stockItemId_sourceType_sourceId_key"
  ON "inventory"."stock_movements"("stockItemId", "sourceType", "sourceId");
CREATE INDEX "stock_movements_sourceType_sourceId_idx"
  ON "inventory"."stock_movements"("sourceType", "sourceId");

ALTER TABLE "catalogue"."listings"
  ADD CONSTRAINT "listings_price_positive" CHECK ("priceMinor" > 0);
ALTER TABLE "catalogue"."product_variants"
  ADD CONSTRAINT "product_variants_weight_positive" CHECK ("weightGrams" > 0);

-- Vendra itself, as the seller of its own stock. The ID is fixed and referenced in code.
INSERT INTO "sellers"."sellers" ("id", "type", "displayName", "legalName", "status")
VALUES ('00000000-0000-4000-8000-000000000001', 'first_party', 'Vendra', 'Datakript Teknologies', 'active');
