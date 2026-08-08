-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('CREATED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "BatchItemStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'DUPLICATE');

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "courier_partner" TEXT NOT NULL,
    "courier_shipment_id" TEXT,
    "awb" TEXT,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'CREATED',
    "request_payload" JSONB NOT NULL,
    "response_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracking_events" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "status" "ShipmentStatus" NOT NULL,
    "raw_payload" JSONB NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tracking_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batches" (
    "id" TEXT NOT NULL,
    "status" "BatchStatus" NOT NULL DEFAULT 'PENDING',
    "total_count" INTEGER NOT NULL,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch_items" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "client_order_id" TEXT NOT NULL,
    "courier_partner" TEXT NOT NULL,
    "status" "BatchItemStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "order_ref_id" TEXT,
    "request_payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batch_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_id_key" ON "orders"("order_id");

-- CreateIndex
CREATE INDEX "tracking_events_order_id_idx" ON "tracking_events"("order_id");

-- CreateIndex
CREATE INDEX "batch_items_batch_id_status_idx" ON "batch_items"("batch_id", "status");

-- CreateIndex
CREATE INDEX "batch_items_client_order_id_idx" ON "batch_items"("client_order_id");

-- AddForeignKey
ALTER TABLE "tracking_events" ADD CONSTRAINT "tracking_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_items" ADD CONSTRAINT "batch_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_items" ADD CONSTRAINT "batch_items_order_ref_id_fkey" FOREIGN KEY ("order_ref_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
