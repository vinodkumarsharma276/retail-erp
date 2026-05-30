-- CreateEnum
CREATE TYPE "InstallmentPromiseStatus" AS ENUM ('pending', 'kept', 'partially_kept', 'broken');

-- AlterTable
ALTER TABLE "installment_schedules" ADD COLUMN     "credit_balance" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "sale_records" ADD COLUMN     "penal_rate" DECIMAL(4,2);

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "settings" JSONB;

-- CreateTable
CREATE TABLE "promises" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "schedule_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "covered_installment_ids" TEXT[],
    "promised_date" DATE NOT NULL,
    "promised_amount" DECIMAL(12,2) NOT NULL,
    "status" "InstallmentPromiseStatus" NOT NULL DEFAULT 'pending',
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ,
    "collected_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "notes" TEXT,

    CONSTRAINT "promises_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "promises_tenant_id_idx" ON "promises"("tenant_id");

-- CreateIndex
CREATE INDEX "promises_schedule_id_status_idx" ON "promises"("schedule_id", "status");

-- CreateIndex
CREATE INDEX "promises_customer_id_status_idx" ON "promises"("customer_id", "status");

-- CreateIndex
CREATE INDEX "promises_promised_date_status_idx" ON "promises"("promised_date", "status");

-- AddForeignKey
ALTER TABLE "promises" ADD CONSTRAINT "promises_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promises" ADD CONSTRAINT "promises_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "installment_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promises" ADD CONSTRAINT "promises_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promises" ADD CONSTRAINT "promises_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
