-- AlterTable
ALTER TABLE "installments" ADD COLUMN     "planned_amount" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "installment_carry_forwards" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "schedule_id" TEXT NOT NULL,
    "from_installment_id" TEXT NOT NULL,
    "to_installment_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "payment_ids" TEXT[],
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rolled_back_at" TIMESTAMPTZ,
    "rolled_back_by" TEXT,
    "rollback_reason" TEXT,

    CONSTRAINT "installment_carry_forwards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "installment_carry_forwards_tenant_id_idx" ON "installment_carry_forwards"("tenant_id");

-- CreateIndex
CREATE INDEX "installment_carry_forwards_schedule_id_idx" ON "installment_carry_forwards"("schedule_id");

-- CreateIndex
CREATE INDEX "installment_carry_forwards_from_installment_id_idx" ON "installment_carry_forwards"("from_installment_id");

-- CreateIndex
CREATE INDEX "installment_carry_forwards_to_installment_id_idx" ON "installment_carry_forwards"("to_installment_id");

-- AddForeignKey
ALTER TABLE "installment_carry_forwards" ADD CONSTRAINT "installment_carry_forwards_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_carry_forwards" ADD CONSTRAINT "installment_carry_forwards_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "installment_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_carry_forwards" ADD CONSTRAINT "installment_carry_forwards_from_installment_id_fkey" FOREIGN KEY ("from_installment_id") REFERENCES "installments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_carry_forwards" ADD CONSTRAINT "installment_carry_forwards_to_installment_id_fkey" FOREIGN KEY ("to_installment_id") REFERENCES "installments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: the planned amount is today's amount minus any penalty charged
-- onto the EMI, plus any early-payment deduction taken off it.
UPDATE "installments" i
SET "planned_amount" = i."amount_due"
  - COALESCE((SELECT SUM(a."applied_amount") FROM "installment_interest_applications" a
              WHERE a."installment_id" = i."id" AND a."rolled_back_at" IS NULL), 0)
  + COALESCE((SELECT SUM(r."amount") FROM "installment_rebates" r
              WHERE r."installment_id" = i."id" AND r."rolled_back_at" IS NULL), 0);
