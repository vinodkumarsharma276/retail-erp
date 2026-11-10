-- AlterTable
ALTER TABLE "customer_search_entries" ADD COLUMN     "client_request_id" UUID;

-- CreateTable
CREATE TABLE "customer_search_changes" (
    "seq" BIGSERIAL NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "entry_id" TEXT NOT NULL,
    "txid" BIGINT NOT NULL,
    "op" CHAR(1) NOT NULL,
    "changed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_search_changes_pkey" PRIMARY KEY ("seq")
);

-- CreateIndex
CREATE INDEX "customer_search_changes_tenant_id_txid_seq_idx" ON "customer_search_changes"("tenant_id", "txid", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "customer_search_entries_tenant_id_client_request_id_key" ON "customer_search_entries"("tenant_id", "client_request_id");

-- Every change to a register entry, from any code path (app, import, issue
-- refresh, scripts, FK SET NULL actions), is logged in the same transaction.
-- pg_current_xact_id() is the writer's transaction id; the sync API only
-- returns rows whose txid is below the oldest still-running transaction, so a
-- change that commits late is never skipped.
CREATE FUNCTION customer_search_log_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO customer_search_changes (tenant_id, entry_id, txid, op)
    VALUES (OLD.tenant_id, OLD.id, pg_current_xact_id()::text::bigint, 'D');
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
    INSERT INTO customer_search_changes (tenant_id, entry_id, txid, op)
    VALUES (OLD.tenant_id, OLD.id, pg_current_xact_id()::text::bigint, 'D');
  END IF;
  INSERT INTO customer_search_changes (tenant_id, entry_id, txid, op)
  VALUES (NEW.tenant_id, NEW.id, pg_current_xact_id()::text::bigint, CASE WHEN TG_OP = 'INSERT' THEN 'I' ELSE 'U' END);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER customer_search_entries_log_insert_delete
AFTER INSERT OR DELETE ON customer_search_entries
FOR EACH ROW EXECUTE FUNCTION customer_search_log_change();

CREATE TRIGGER customer_search_entries_log_update
AFTER UPDATE ON customer_search_entries
FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
EXECUTE FUNCTION customer_search_log_change();
