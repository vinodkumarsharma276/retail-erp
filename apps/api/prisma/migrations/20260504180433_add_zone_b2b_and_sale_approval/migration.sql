-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('individual', 'business');

-- CreateEnum
CREATE TYPE "SaleApprovalStatus" AS ENUM ('pending', 'approved');

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "business_name" VARCHAR(200),
ADD COLUMN     "customer_type" "CustomerType" NOT NULL DEFAULT 'individual',
ADD COLUMN     "gst_number" VARCHAR(15),
ADD COLUMN     "zone" VARCHAR(20);

-- AlterTable
ALTER TABLE "sale_records" ADD COLUMN     "approval_status" "SaleApprovalStatus" NOT NULL DEFAULT 'approved',
ADD COLUMN     "approved_at" TIMESTAMPTZ,
ADD COLUMN     "approved_by_id" TEXT;

-- CreateIndex
CREATE INDEX "customers_zone_idx" ON "customers"("zone");

-- CreateIndex
CREATE INDEX "sale_records_approval_status_idx" ON "sale_records"("approval_status");

-- AddForeignKey
ALTER TABLE "sale_records" ADD CONSTRAINT "sale_records_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
