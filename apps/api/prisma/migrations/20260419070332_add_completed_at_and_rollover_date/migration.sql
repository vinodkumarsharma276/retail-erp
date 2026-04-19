-- AlterTable
ALTER TABLE "installment_schedules" ADD COLUMN     "last_rollover_date" DATE;

-- AlterTable
ALTER TABLE "sale_records" ADD COLUMN     "completed_at" TIMESTAMPTZ;

-- CreateIndex
CREATE INDEX "sale_records_completed_at_idx" ON "sale_records"("completed_at");
