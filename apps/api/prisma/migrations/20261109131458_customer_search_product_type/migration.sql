-- AlterTable
ALTER TABLE "customer_search_entries" ADD COLUMN     "category_id" TEXT;

-- CreateTable
CREATE TABLE "customer_search_product_mappings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "text_key" VARCHAR(200) NOT NULL,
    "category_id" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_search_product_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_search_product_mappings_tenant_id_idx" ON "customer_search_product_mappings"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_search_product_mappings_tenant_id_text_key_key" ON "customer_search_product_mappings"("tenant_id", "text_key");

-- CreateIndex
CREATE INDEX "customer_search_entries_category_id_idx" ON "customer_search_entries"("category_id");

-- AddForeignKey
ALTER TABLE "customer_search_entries" ADD CONSTRAINT "customer_search_entries_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_search_product_mappings" ADD CONSTRAINT "customer_search_product_mappings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_search_product_mappings" ADD CONSTRAINT "customer_search_product_mappings_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
