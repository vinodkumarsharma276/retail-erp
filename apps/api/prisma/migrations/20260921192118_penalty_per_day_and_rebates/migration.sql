-- AlterTable
ALTER TABLE "installment_interest_applications" ADD COLUMN     "charged_through" DATE;

-- AlterTable
ALTER TABLE "sale_records" ADD COLUMN     "penalty_per_day" DECIMAL(10,2);

-- CreateTable
CREATE TABLE "installment_rebates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "schedule_id" TEXT NOT NULL,
    "installment_id" TEXT NOT NULL,
    "source_installment_id" TEXT NOT NULL,
    "payment_ids" TEXT[],
    "amount" DECIMAL(12,2) NOT NULL,
    "days_early" INTEGER NOT NULL,
    "applied_by" TEXT NOT NULL,
    "applied_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "rolled_back_at" TIMESTAMPTZ,
    "rolled_back_by" TEXT,
    "rollback_reason" TEXT,

    CONSTRAINT "installment_rebates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "installment_rebates_tenant_id_idx" ON "installment_rebates"("tenant_id");

-- CreateIndex
CREATE INDEX "installment_rebates_schedule_id_idx" ON "installment_rebates"("schedule_id");

-- CreateIndex
CREATE INDEX "installment_rebates_installment_id_idx" ON "installment_rebates"("installment_id");

-- CreateIndex
CREATE INDEX "installment_rebates_source_installment_id_idx" ON "installment_rebates"("source_installment_id");

-- AddForeignKey
ALTER TABLE "installment_rebates" ADD CONSTRAINT "installment_rebates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_rebates" ADD CONSTRAINT "installment_rebates_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "installment_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_rebates" ADD CONSTRAINT "installment_rebates_installment_id_fkey" FOREIGN KEY ("installment_id") REFERENCES "installments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
