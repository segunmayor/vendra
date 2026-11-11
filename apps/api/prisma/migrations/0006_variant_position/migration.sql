-- Variants keep the order staff added them in (S, M, L), instead of sorting by SKU.
ALTER TABLE "catalogue"."product_variants" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;

-- Existing variants keep their current (SKU) order.
UPDATE "catalogue"."product_variants" v
SET "position" = ordered.rank
FROM (SELECT "id", ROW_NUMBER() OVER (PARTITION BY "productId" ORDER BY "sku") - 1 AS rank FROM "catalogue"."product_variants") ordered
WHERE v."id" = ordered."id";

DROP INDEX "catalogue"."product_variants_productId_idx";
CREATE INDEX "product_variants_productId_position_idx" ON "catalogue"."product_variants"("productId", "position");
