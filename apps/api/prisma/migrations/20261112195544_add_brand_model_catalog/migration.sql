-- CreateTable
CREATE TABLE "catalog_brands" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_models" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "key" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_models_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "catalog_brands_tenant_id_idx" ON "catalog_brands"("tenant_id");

-- CreateIndex
CREATE INDEX "catalog_brands_category_id_idx" ON "catalog_brands"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_brands_tenant_id_category_id_key_key" ON "catalog_brands"("tenant_id", "category_id", "key");

-- CreateIndex
CREATE INDEX "catalog_models_tenant_id_idx" ON "catalog_models"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_models_brand_id_key_key" ON "catalog_models"("brand_id", "key");

-- AddForeignKey
ALTER TABLE "catalog_brands" ADD CONSTRAINT "catalog_brands_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_brands" ADD CONSTRAINT "catalog_brands_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "product_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_models" ADD CONSTRAINT "catalog_models_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_models" ADD CONSTRAINT "catalog_models_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "catalog_brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
