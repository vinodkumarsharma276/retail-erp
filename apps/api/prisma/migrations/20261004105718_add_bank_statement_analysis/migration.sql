-- CreateTable
CREATE TABLE "bank_statements" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "file_name" VARCHAR(300) NOT NULL,
    "file_hash" VARCHAR(64) NOT NULL,
    "file_type" VARCHAR(10) NOT NULL,
    "file_size" INTEGER NOT NULL,
    "bank" VARCHAR(80) NOT NULL,
    "account_hint" VARCHAR(20),
    "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "parse_method" VARCHAR(20) NOT NULL,
    "reconciliation" REAL,
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "period_start" DATE,
    "period_end" DATE,
    "tx_count" INTEGER NOT NULL DEFAULT 0,
    "uploaded_by_id" TEXT,
    "uploaded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "statement_transactions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "statement_id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "bank" VARCHAR(80) NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "direction" VARCHAR(6) NOT NULL,
    "balance" DECIMAL(16,2),
    "reference" VARCHAR(100),
    "counterparty" VARCHAR(120),
    "channel" VARCHAR(20) NOT NULL DEFAULT 'Other',
    "category" VARCHAR(60) NOT NULL DEFAULT 'Uncategorized',
    "category_source" VARCHAR(10) NOT NULL DEFAULT 'none',
    "confidence" REAL,
    "ai_note" TEXT,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "flag_reasons" JSONB NOT NULL DEFAULT '[]',
    "review_status" VARCHAR(12),
    "reviewer_note" TEXT,
    "reviewed_at" TIMESTAMPTZ,
    "reviewed_by" VARCHAR(120),
    "fingerprint" TEXT NOT NULL,
    "row_index" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "statement_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "statement_rules" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "shop_id" TEXT,
    "pattern" VARCHAR(200) NOT NULL,
    "match_type" VARCHAR(10) NOT NULL DEFAULT 'contains',
    "category" VARCHAR(60) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "statement_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "statement_settings" (
    "tenant_id" TEXT NOT NULL,
    "values" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "statement_settings_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateIndex
CREATE INDEX "bank_statements_tenant_id_shop_id_idx" ON "bank_statements"("tenant_id", "shop_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_statements_shop_id_file_hash_key" ON "bank_statements"("shop_id", "file_hash");

-- CreateIndex
CREATE INDEX "statement_transactions_tenant_id_shop_id_date_idx" ON "statement_transactions"("tenant_id", "shop_id", "date");

-- CreateIndex
CREATE INDEX "statement_transactions_statement_id_idx" ON "statement_transactions"("statement_id");

-- CreateIndex
CREATE INDEX "statement_transactions_flagged_review_status_idx" ON "statement_transactions"("flagged", "review_status");

-- CreateIndex
CREATE INDEX "statement_transactions_category_idx" ON "statement_transactions"("category");

-- CreateIndex
CREATE INDEX "statement_transactions_fingerprint_idx" ON "statement_transactions"("fingerprint");

-- CreateIndex
CREATE INDEX "statement_rules_tenant_id_idx" ON "statement_rules"("tenant_id");

-- AddForeignKey
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statement_transactions" ADD CONSTRAINT "statement_transactions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statement_transactions" ADD CONSTRAINT "statement_transactions_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statement_transactions" ADD CONSTRAINT "statement_transactions_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "bank_statements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statement_rules" ADD CONSTRAINT "statement_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statement_rules" ADD CONSTRAINT "statement_rules_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statement_settings" ADD CONSTRAINT "statement_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
