-- Basket lines are shown in the order they were added.
ALTER TABLE "cart"."cart_items" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
