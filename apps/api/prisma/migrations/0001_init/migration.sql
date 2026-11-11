-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "cart";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "catalogue";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "customers";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "identity";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "inventory";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "ledger";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "orders";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "payments";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "platform";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "sellers";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "shipping";

-- CreateEnum
CREATE TYPE "identity"."AccountAudience" AS ENUM ('store', 'admin', 'vendor');

-- CreateEnum
CREATE TYPE "sellers"."SellerType" AS ENUM ('first_party', 'marketplace', 'supplier');

-- CreateEnum
CREATE TYPE "payments"."PaymentStatus" AS ENUM ('initiated', 'succeeded', 'failed', 'requires_review', 'partially_refunded', 'refunded');

-- CreateEnum
CREATE TYPE "ledger"."LedgerSide" AS ENUM ('debit', 'credit');

-- CreateEnum
CREATE TYPE "shipping"."FulfilmentMode" AS ENUM ('vendra_dispatch', 'carrier', 'vendor_managed', 'supplier_managed');

-- CreateEnum
CREATE TYPE "shipping"."ShipmentStatus" AS ENUM ('created', 'allocated', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'delivery_failed', 'returning', 'returned', 'cancelled');

-- CreateTable
CREATE TABLE "platform"."outbox_events" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "aggregateId" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMPTZ NOT NULL,
    "publishedAt" TIMESTAMPTZ,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."idempotency_records" (
    "id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseCode" INTEGER,
    "responseBody" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."audit_logs" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."accounts" (
    "id" UUID NOT NULL,
    "audience" "identity"."AccountAudience" NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "mfaSecret" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."sessions" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "revokedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."roles" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."role_permissions" (
    "roleId" UUID NOT NULL,
    "permission" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId","permission")
);

-- CreateTable
CREATE TABLE "identity"."account_roles" (
    "accountId" UUID NOT NULL,
    "roleId" UUID NOT NULL,

    CONSTRAINT "account_roles_pkey" PRIMARY KEY ("accountId","roleId")
);

-- CreateTable
CREATE TABLE "customers"."customer_profiles" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers"."addresses" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "recipient" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'NG',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sellers"."sellers" (
    "id" UUID NOT NULL,
    "type" "sellers"."SellerType" NOT NULL,
    "displayName" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending_verification',
    "ownerAccount" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sellers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sellers"."verification_cases" (
    "id" UUID NOT NULL,
    "sellerId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "documents" JSONB NOT NULL,
    "reviewedBy" UUID,
    "reviewedAt" TIMESTAMPTZ,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalogue"."categories" (
    "id" UUID NOT NULL,
    "parentId" UUID,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "attributeSchema" JSONB,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalogue"."brands" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalogue"."products" (
    "id" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "brandId" UUID,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "images" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalogue"."product_variants" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "options" JSONB NOT NULL DEFAULT '{}',
    "weightGrams" INTEGER NOT NULL,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalogue"."listings" (
    "id" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "sellerId" UUID NOT NULL,
    "priceMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory"."warehouses" (
    "id" UUID NOT NULL,
    "sellerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" JSONB NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory"."stock_items" (
    "id" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "onHand" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "stock_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory"."stock_reservations" (
    "id" UUID NOT NULL,
    "stockItemId" UUID NOT NULL,
    "checkoutId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'held',
    "expiresAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory"."stock_movements" (
    "id" UUID NOT NULL,
    "stockItemId" UUID NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart"."carts" (
    "id" UUID NOT NULL,
    "customerId" UUID,
    "guestToken" TEXT,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart"."cart_items" (
    "id" UUID NOT NULL,
    "cartId" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders"."orders" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "customerId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending_payment',
    "currency" CHAR(3) NOT NULL,
    "subtotalMinor" BIGINT NOT NULL,
    "deliveryMinor" BIGINT NOT NULL,
    "discountMinor" BIGINT NOT NULL DEFAULT 0,
    "totalMinor" BIGINT NOT NULL,
    "shippingAddress" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders"."seller_orders" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "sellerId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "seller_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders"."order_lines" (
    "id" UUID NOT NULL,
    "sellerOrderId" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "productName" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceMinor" BIGINT NOT NULL,

    CONSTRAINT "order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments"."payments" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "payments"."PaymentStatus" NOT NULL DEFAULT 'initiated',
    "providerTransactionId" TEXT,
    "refundedMinor" BIGINT NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments"."payment_attempts" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "outcome" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments"."webhook_events" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "receivedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments"."refunds" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "providerRefundId" TEXT,
    "reason" TEXT NOT NULL,
    "requestedBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger"."accounts" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "ledger"."journal_entries" (
    "id" UUID NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "postedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger"."journal_lines" (
    "id" UUID NOT NULL,
    "entryId" UUID NOT NULL,
    "accountCode" TEXT NOT NULL,
    "side" "ledger"."LedgerSide" NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping"."delivery_zones" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "states" TEXT[],

    CONSTRAINT "delivery_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping"."delivery_rates" (
    "id" UUID NOT NULL,
    "zoneId" UUID NOT NULL,
    "maxWeightGrams" INTEGER NOT NULL,
    "priceMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,

    CONSTRAINT "delivery_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping"."shipments" (
    "id" UUID NOT NULL,
    "sellerOrderId" UUID NOT NULL,
    "mode" "shipping"."FulfilmentMode" NOT NULL,
    "status" "shipping"."ShipmentStatus" NOT NULL DEFAULT 'created',
    "provider" TEXT NOT NULL,
    "trackingReference" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping"."shipment_items" (
    "id" UUID NOT NULL,
    "shipmentId" UUID NOT NULL,
    "orderLineId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "shipment_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping"."shipment_status_events" (
    "id" UUID NOT NULL,
    "shipmentId" UUID NOT NULL,
    "status" "shipping"."ShipmentStatus" NOT NULL,
    "note" TEXT,
    "at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "shipment_status_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping"."delivery_attempts" (
    "id" UUID NOT NULL,
    "shipmentId" UUID NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "successful" BOOLEAN NOT NULL,
    "reason" TEXT,
    "at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "delivery_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outbox_events_publishedAt_occurredAt_idx" ON "platform"."outbox_events"("publishedAt", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_scope_key_key" ON "platform"."idempotency_records"("scope", "key");

-- CreateIndex
CREATE INDEX "audit_logs_targetType_targetId_idx" ON "platform"."audit_logs"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_createdAt_idx" ON "platform"."audit_logs"("actorId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_audience_email_key" ON "identity"."accounts"("audience", "email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refreshTokenHash_key" ON "identity"."sessions"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "sessions_familyId_idx" ON "identity"."sessions"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "identity"."roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "customer_profiles_accountId_key" ON "customers"."customer_profiles"("accountId");

-- CreateIndex
CREATE INDEX "addresses_customerId_idx" ON "customers"."addresses"("customerId");

-- CreateIndex
CREATE INDEX "verification_cases_sellerId_idx" ON "sellers"."verification_cases"("sellerId");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "catalogue"."categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "brands_name_key" ON "catalogue"."brands"("name");

-- CreateIndex
CREATE UNIQUE INDEX "brands_slug_key" ON "catalogue"."brands"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_key" ON "catalogue"."products"("slug");

-- CreateIndex
CREATE INDEX "products_categoryId_status_idx" ON "catalogue"."products"("categoryId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_sku_key" ON "catalogue"."product_variants"("sku");

-- CreateIndex
CREATE INDEX "product_variants_productId_idx" ON "catalogue"."product_variants"("productId");

-- CreateIndex
CREATE INDEX "listings_sellerId_status_idx" ON "catalogue"."listings"("sellerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "listings_variantId_sellerId_key" ON "catalogue"."listings"("variantId", "sellerId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_items_listingId_warehouseId_key" ON "inventory"."stock_items"("listingId", "warehouseId");

-- CreateIndex
CREATE INDEX "stock_reservations_status_expiresAt_idx" ON "inventory"."stock_reservations"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "stock_reservations_checkoutId_idx" ON "inventory"."stock_reservations"("checkoutId");

-- CreateIndex
CREATE INDEX "stock_movements_stockItemId_createdAt_idx" ON "inventory"."stock_movements"("stockItemId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "carts_guestToken_key" ON "cart"."carts"("guestToken");

-- CreateIndex
CREATE INDEX "carts_customerId_idx" ON "cart"."carts"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "cart_items_cartId_listingId_key" ON "cart"."cart_items"("cartId", "listingId");

-- CreateIndex
CREATE UNIQUE INDEX "orders_number_key" ON "orders"."orders"("number");

-- CreateIndex
CREATE INDEX "orders_customerId_createdAt_idx" ON "orders"."orders"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "seller_orders_orderId_idx" ON "orders"."seller_orders"("orderId");

-- CreateIndex
CREATE INDEX "seller_orders_sellerId_status_idx" ON "orders"."seller_orders"("sellerId", "status");

-- CreateIndex
CREATE INDEX "order_lines_sellerOrderId_idx" ON "orders"."order_lines"("sellerOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_reference_key" ON "payments"."payments"("reference");

-- CreateIndex
CREATE INDEX "payments_orderId_idx" ON "payments"."payments"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_providerTransactionId_key" ON "payments"."payments"("provider", "providerTransactionId");

-- CreateIndex
CREATE INDEX "payment_attempts_paymentId_idx" ON "payments"."payment_attempts"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_provider_providerEventId_key" ON "payments"."webhook_events"("provider", "providerEventId");

-- CreateIndex
CREATE INDEX "refunds_paymentId_idx" ON "payments"."refunds"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_sourceType_sourceId_key" ON "ledger"."journal_entries"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "journal_lines_entryId_idx" ON "ledger"."journal_lines"("entryId");

-- CreateIndex
CREATE INDEX "journal_lines_accountCode_idx" ON "ledger"."journal_lines"("accountCode");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_zones_code_key" ON "shipping"."delivery_zones"("code");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_rates_zoneId_maxWeightGrams_key" ON "shipping"."delivery_rates"("zoneId", "maxWeightGrams");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_trackingReference_key" ON "shipping"."shipments"("trackingReference");

-- CreateIndex
CREATE INDEX "shipments_sellerOrderId_idx" ON "shipping"."shipments"("sellerOrderId");

-- CreateIndex
CREATE INDEX "shipments_status_idx" ON "shipping"."shipments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_items_shipmentId_orderLineId_key" ON "shipping"."shipment_items"("shipmentId", "orderLineId");

-- CreateIndex
CREATE INDEX "shipment_status_events_shipmentId_at_idx" ON "shipping"."shipment_status_events"("shipmentId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_attempts_shipmentId_attemptNumber_key" ON "shipping"."delivery_attempts"("shipmentId", "attemptNumber");

-- AddForeignKey
ALTER TABLE "identity"."sessions" ADD CONSTRAINT "sessions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "identity"."accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "identity"."roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."account_roles" ADD CONSTRAINT "account_roles_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "identity"."accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."account_roles" ADD CONSTRAINT "account_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "identity"."roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers"."addresses" ADD CONSTRAINT "addresses_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"."customer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sellers"."verification_cases" ADD CONSTRAINT "verification_cases_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "sellers"."sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalogue"."categories" ADD CONSTRAINT "categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "catalogue"."categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalogue"."products" ADD CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "catalogue"."categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalogue"."products" ADD CONSTRAINT "products_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "catalogue"."brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalogue"."product_variants" ADD CONSTRAINT "product_variants_productId_fkey" FOREIGN KEY ("productId") REFERENCES "catalogue"."products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalogue"."listings" ADD CONSTRAINT "listings_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "catalogue"."product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."stock_items" ADD CONSTRAINT "stock_items_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "inventory"."warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."stock_reservations" ADD CONSTRAINT "stock_reservations_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "inventory"."stock_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."stock_movements" ADD CONSTRAINT "stock_movements_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "inventory"."stock_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart"."cart_items" ADD CONSTRAINT "cart_items_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "cart"."carts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders"."seller_orders" ADD CONSTRAINT "seller_orders_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"."orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders"."order_lines" ADD CONSTRAINT "order_lines_sellerOrderId_fkey" FOREIGN KEY ("sellerOrderId") REFERENCES "orders"."seller_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments"."payment_attempts" ADD CONSTRAINT "payment_attempts_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"."payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments"."refunds" ADD CONSTRAINT "refunds_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"."payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger"."journal_lines" ADD CONSTRAINT "journal_lines_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "ledger"."journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger"."journal_lines" ADD CONSTRAINT "journal_lines_accountCode_fkey" FOREIGN KEY ("accountCode") REFERENCES "ledger"."accounts"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping"."delivery_rates" ADD CONSTRAINT "delivery_rates_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "shipping"."delivery_zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping"."shipment_items" ADD CONSTRAINT "shipment_items_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipping"."shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping"."shipment_status_events" ADD CONSTRAINT "shipment_status_events_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipping"."shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping"."delivery_attempts" ADD CONSTRAINT "delivery_attempts_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipping"."shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written safeguards, kept in the database so no code path can bypass them.

ALTER TABLE "inventory"."stock_items"
  ADD CONSTRAINT "stock_items_quantities_valid"
  CHECK ("onHand" >= 0 AND "reserved" >= 0 AND "reserved" <= "onHand");

ALTER TABLE "inventory"."stock_reservations"
  ADD CONSTRAINT "stock_reservations_quantity_positive" CHECK ("quantity" > 0);

ALTER TABLE "payments"."payments"
  ADD CONSTRAINT "payments_amounts_valid"
  CHECK ("amountMinor" > 0 AND "refundedMinor" >= 0 AND "refundedMinor" <= "amountMinor");

ALTER TABLE "payments"."refunds"
  ADD CONSTRAINT "refunds_amount_positive" CHECK ("amountMinor" > 0);

ALTER TABLE "ledger"."journal_lines"
  ADD CONSTRAINT "journal_lines_amount_positive" CHECK ("amountMinor" > 0);

CREATE FUNCTION "ledger"."reject_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Ledger records are append-only; post a reversing entry instead';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "journal_entries_append_only"
  BEFORE UPDATE OR DELETE ON "ledger"."journal_entries"
  FOR EACH ROW EXECUTE FUNCTION "ledger"."reject_mutation"();

CREATE TRIGGER "journal_lines_append_only"
  BEFORE UPDATE OR DELETE ON "ledger"."journal_lines"
  FOR EACH ROW EXECUTE FUNCTION "ledger"."reject_mutation"();

-- Checked at commit, so an entry's lines can be inserted one at a time.
CREATE FUNCTION "ledger"."assert_entry_balanced"() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "ledger"."journal_lines"
    WHERE "entryId" = NEW."entryId"
    GROUP BY "currency"
    HAVING SUM(CASE WHEN "side" = 'debit' THEN "amountMinor" ELSE -"amountMinor" END) <> 0
  ) OR (
    SELECT COUNT(DISTINCT "currency") FROM "ledger"."journal_lines" WHERE "entryId" = NEW."entryId"
  ) > 1 THEN
    RAISE EXCEPTION 'Journal entry % is not balanced', NEW."entryId";
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "journal_lines_balanced"
  AFTER INSERT ON "ledger"."journal_lines"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "ledger"."assert_entry_balanced"();
