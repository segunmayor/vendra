ALTER TABLE "platform"."outbox_events"
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastError" TEXT;

ALTER TABLE "shipping"."shipment_status_events" ADD COLUMN "sequence" INTEGER NOT NULL;

CREATE UNIQUE INDEX "shipment_status_events_shipmentId_sequence_key"
  ON "shipping"."shipment_status_events"("shipmentId", "sequence");
