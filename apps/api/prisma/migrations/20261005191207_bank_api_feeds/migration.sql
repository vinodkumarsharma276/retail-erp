-- AlterTable
ALTER TABLE "bank_statements" ADD COLUMN     "source" VARCHAR(10) NOT NULL DEFAULT 'upload';

-- CreateTable
CREATE TABLE "bank_feed_connections" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "bank_account_id" TEXT NOT NULL,
    "provider" VARCHAR(20) NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'active',
    "credentials" TEXT,
    "auto_sync" BOOLEAN NOT NULL DEFAULT true,
    "synced_through" DATE,
    "last_sync_at" TIMESTAMPTZ,
    "last_error" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_feed_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_feed_runs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "trigger" VARCHAR(10) NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "status" VARCHAR(10) NOT NULL,
    "fetched" INTEGER NOT NULL DEFAULT 0,
    "imported" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "statement_id" TEXT,
    "error" TEXT,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ,

    CONSTRAINT "bank_feed_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bank_feed_connections_bank_account_id_key" ON "bank_feed_connections"("bank_account_id");

-- CreateIndex
CREATE INDEX "bank_feed_connections_tenant_id_idx" ON "bank_feed_connections"("tenant_id");

-- CreateIndex
CREATE INDEX "bank_feed_runs_connection_id_started_at_idx" ON "bank_feed_runs"("connection_id", "started_at");

-- AddForeignKey
ALTER TABLE "bank_feed_connections" ADD CONSTRAINT "bank_feed_connections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_feed_connections" ADD CONSTRAINT "bank_feed_connections_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_feed_runs" ADD CONSTRAINT "bank_feed_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_feed_runs" ADD CONSTRAINT "bank_feed_runs_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "bank_feed_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
