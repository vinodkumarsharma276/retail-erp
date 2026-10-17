-- AlterTable
ALTER TABLE "bank_accounts" ALTER COLUMN "ifsc_code" DROP NOT NULL;

-- AlterTable
ALTER TABLE "bank_statements" ADD COLUMN     "bank_account_id" TEXT;

-- CreateTable
CREATE TABLE "statement_files" (
    "statement_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "content" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "statement_files_pkey" PRIMARY KEY ("statement_id")
);

-- CreateIndex
CREATE INDEX "statement_files_tenant_id_idx" ON "statement_files"("tenant_id");

-- AddForeignKey
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statement_files" ADD CONSTRAINT "statement_files_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "bank_statements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statement_files" ADD CONSTRAINT "statement_files_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
