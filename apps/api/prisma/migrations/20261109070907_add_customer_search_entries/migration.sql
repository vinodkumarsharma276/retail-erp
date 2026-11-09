-- CreateTable
CREATE TABLE "customer_search_entries" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "account_number" VARCHAR(30) NOT NULL,
    "prefix" VARCHAR(10) NOT NULL,
    "series_no" INTEGER,
    "customer_id" TEXT NOT NULL,
    "customer_name" VARCHAR(200) NOT NULL,
    "mobile" VARCHAR(15) NOT NULL,
    "address" VARCHAR(500),
    "area" VARCHAR(100),
    "co_customer_id" TEXT,
    "co_name" VARCHAR(200),
    "co_mobile" VARCHAR(15),
    "purchase_date" DATE,
    "product" VARCHAR(200),
    "brand" VARCHAR(100),
    "model" VARCHAR(200),
    "source" VARCHAR(10) NOT NULL DEFAULT 'app',
    "import_batch_id" TEXT,
    "sheet_row_number" INTEGER,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_search_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_search_import_batches" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "row_from" INTEGER NOT NULL,
    "row_to" INTEGER NOT NULL,
    "inserted" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "invalid" INTEGER NOT NULL DEFAULT 0,
    "customers_created" INTEGER NOT NULL DEFAULT 0,
    "customers_linked" INTEGER NOT NULL DEFAULT 0,
    "name_decisions" JSONB,
    "created_by" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_search_import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_search_entries_tenant_id_idx" ON "customer_search_entries"("tenant_id");

-- CreateIndex
CREATE INDEX "customer_search_entries_tenant_id_prefix_idx" ON "customer_search_entries"("tenant_id", "prefix");

-- CreateIndex
CREATE INDEX "customer_search_entries_customer_id_idx" ON "customer_search_entries"("customer_id");

-- CreateIndex
CREATE INDEX "customer_search_entries_co_customer_id_idx" ON "customer_search_entries"("co_customer_id");

-- CreateIndex
CREATE INDEX "customer_search_entries_mobile_idx" ON "customer_search_entries"("mobile");

-- CreateIndex
CREATE INDEX "customer_search_entries_shop_id_idx" ON "customer_search_entries"("shop_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_search_entries_tenant_id_account_number_key" ON "customer_search_entries"("tenant_id", "account_number");

-- CreateIndex
CREATE INDEX "customer_search_import_batches_tenant_id_idx" ON "customer_search_import_batches"("tenant_id");

-- AddForeignKey
ALTER TABLE "customer_search_entries" ADD CONSTRAINT "customer_search_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_search_entries" ADD CONSTRAINT "customer_search_entries_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_search_entries" ADD CONSTRAINT "customer_search_entries_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_search_entries" ADD CONSTRAINT "customer_search_entries_co_customer_id_fkey" FOREIGN KEY ("co_customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_search_entries" ADD CONSTRAINT "customer_search_entries_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "customer_search_import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_search_entries" ADD CONSTRAINT "customer_search_entries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_search_import_batches" ADD CONSTRAINT "customer_search_import_batches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_search_import_batches" ADD CONSTRAINT "customer_search_import_batches_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_search_import_batches" ADD CONSTRAINT "customer_search_import_batches_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Customer Searching ships switched on for the Enterprise plan.
INSERT INTO "plan_features" ("id", "plan_id", "feature_key", "enabled")
SELECT gen_random_uuid()::text, "id", 'customer_search', true FROM "plans" WHERE "code" = 'enterprise'
ON CONFLICT ("plan_id", "feature_key") DO NOTHING;
