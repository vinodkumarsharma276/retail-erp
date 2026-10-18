-- AlterTable
ALTER TABLE "product_categories" ADD COLUMN     "purchase_modes" VARCHAR(10) NOT NULL DEFAULT 'billed';

-- AlterTable
ALTER TABLE "purchases" ADD COLUMN     "billed" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "purchase_invoice_series" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "prefix" VARCHAR(10) NOT NULL,
    "next_number" INTEGER NOT NULL DEFAULT 1,
    "created_by" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_invoice_series_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "purchase_invoice_series_tenant_id_idx" ON "purchase_invoice_series"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_invoice_series_tenant_id_category_id_key" ON "purchase_invoice_series"("tenant_id", "category_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_invoice_series_tenant_id_prefix_key" ON "purchase_invoice_series"("tenant_id", "prefix");

-- AddForeignKey
ALTER TABLE "purchase_invoice_series" ADD CONSTRAINT "purchase_invoice_series_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_series" ADD CONSTRAINT "purchase_invoice_series_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "product_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
