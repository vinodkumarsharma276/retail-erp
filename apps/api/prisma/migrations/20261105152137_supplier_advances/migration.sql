-- AlterTable
ALTER TABLE "purchase_payments" ADD COLUMN     "supplier_advance_id" TEXT;

-- CreateTable
CREATE TABLE "supplier_advances" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "distributor_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "remaining" DECIMAL(12,2) NOT NULL,
    "payment_mode" "PaymentMode" NOT NULL,
    "payment_date" DATE NOT NULL,
    "reference_number" VARCHAR(100),
    "notes" TEXT,
    "statement_transaction_id" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_advances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_advances_tenant_id_idx" ON "supplier_advances"("tenant_id");

-- CreateIndex
CREATE INDEX "supplier_advances_shop_id_distributor_id_idx" ON "supplier_advances"("shop_id", "distributor_id");

-- CreateIndex
CREATE INDEX "supplier_advances_statement_transaction_id_idx" ON "supplier_advances"("statement_transaction_id");

-- CreateIndex
CREATE INDEX "purchase_payments_supplier_advance_id_idx" ON "purchase_payments"("supplier_advance_id");

-- AddForeignKey
ALTER TABLE "purchase_payments" ADD CONSTRAINT "purchase_payments_supplier_advance_id_fkey" FOREIGN KEY ("supplier_advance_id") REFERENCES "supplier_advances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_advances" ADD CONSTRAINT "supplier_advances_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_advances" ADD CONSTRAINT "supplier_advances_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_advances" ADD CONSTRAINT "supplier_advances_distributor_id_fkey" FOREIGN KEY ("distributor_id") REFERENCES "distributors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_advances" ADD CONSTRAINT "supplier_advances_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_advances" ADD CONSTRAINT "supplier_advances_statement_transaction_id_fkey" FOREIGN KEY ("statement_transaction_id") REFERENCES "statement_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
