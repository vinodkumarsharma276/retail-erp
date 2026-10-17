-- AlterTable
ALTER TABLE "purchases" ADD COLUMN     "import_batch_id" TEXT,
ADD COLUMN     "source" VARCHAR(20) NOT NULL DEFAULT 'manual';

-- CreateTable
CREATE TABLE "purchase_import_batches" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "source_format" VARCHAR(40) NOT NULL,
    "period" VARCHAR(100),
    "sheet_owner_name" VARCHAR(300),
    "invoice_count" INTEGER NOT NULL DEFAULT 0,
    "unit_count" INTEGER NOT NULL DEFAULT 0,
    "net_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "distributors_created" INTEGER NOT NULL DEFAULT 0,
    "distributors_updated" INTEGER NOT NULL DEFAULT 0,
    "created_by" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_item_classifications" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name_key" VARCHAR(300) NOT NULL,
    "raw_name" VARCHAR(300) NOT NULL,
    "category_id" TEXT,
    "brand" VARCHAR(200),
    "model_number" VARCHAR(200),
    "color" VARCHAR(50),
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "is_demo_unit" BOOLEAN NOT NULL DEFAULT false,
    "confidence" DECIMAL(3,2) NOT NULL DEFAULT 0,
    "decided_by" VARCHAR(10) NOT NULL DEFAULT 'ai',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_item_classifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "purchase_import_batches_tenant_id_idx" ON "purchase_import_batches"("tenant_id");

-- CreateIndex
CREATE INDEX "purchase_import_batches_shop_id_idx" ON "purchase_import_batches"("shop_id");

-- CreateIndex
CREATE INDEX "purchase_import_batches_created_at_idx" ON "purchase_import_batches"("created_at");

-- CreateIndex
CREATE INDEX "import_item_classifications_tenant_id_idx" ON "import_item_classifications"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "import_item_classifications_tenant_id_name_key_key" ON "import_item_classifications"("tenant_id", "name_key");

-- CreateIndex
CREATE INDEX "purchases_import_batch_id_idx" ON "purchases"("import_batch_id");

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "purchase_import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_import_batches" ADD CONSTRAINT "purchase_import_batches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_import_batches" ADD CONSTRAINT "purchase_import_batches_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_import_batches" ADD CONSTRAINT "purchase_import_batches_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_item_classifications" ADD CONSTRAINT "import_item_classifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_item_classifications" ADD CONSTRAINT "import_item_classifications_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Rows the earlier spreadsheet importer created are imports too, and should
-- show as such on the purchase list.
UPDATE "purchases" SET "source" = 'excel_import' WHERE "notes" = 'Imported from spreadsheet';
