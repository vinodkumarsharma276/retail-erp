-- AlterTable
ALTER TABLE "purchase_payments" ADD COLUMN     "statement_transaction_id" TEXT;

-- AlterTable
ALTER TABLE "statement_transactions" ADD COLUMN     "distributor_id" TEXT,
ADD COLUMN     "distributor_source" VARCHAR(10);

-- CreateIndex
CREATE INDEX "purchase_payments_statement_transaction_id_idx" ON "purchase_payments"("statement_transaction_id");

-- CreateIndex
CREATE INDEX "statement_transactions_distributor_id_idx" ON "statement_transactions"("distributor_id");

-- AddForeignKey
ALTER TABLE "purchase_payments" ADD CONSTRAINT "purchase_payments_statement_transaction_id_fkey" FOREIGN KEY ("statement_transaction_id") REFERENCES "statement_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statement_transactions" ADD CONSTRAINT "statement_transactions_distributor_id_fkey" FOREIGN KEY ("distributor_id") REFERENCES "distributors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
