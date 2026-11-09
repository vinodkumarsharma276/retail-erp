-- DropForeignKey
ALTER TABLE "customer_search_entries" DROP CONSTRAINT "customer_search_entries_customer_id_fkey";

-- DropIndex
DROP INDEX "customer_search_entries_tenant_id_account_number_key";

-- AlterTable
ALTER TABLE "customer_search_entries" ADD COLUMN     "issues" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "raw_values" JSONB,
ALTER COLUMN "customer_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "customer_search_import_batches" ADD COLUMN     "flagged" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "moved" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "customer_search_entries_tenant_id_account_number_idx" ON "customer_search_entries"("tenant_id", "account_number");

-- CreateIndex
CREATE INDEX "customer_search_entries_issues_idx" ON "customer_search_entries" USING GIN ("issues");

-- AddForeignKey
ALTER TABLE "customer_search_entries" ADD CONSTRAINT "customer_search_entries_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
