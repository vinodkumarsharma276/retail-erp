-- The register's order: newest purchase first, undated entries last (as every list asks for),
-- so the first page is read straight off this index instead of sorting every entry.
CREATE INDEX "customer_search_entries_tenant_id_purchase_date_account_num_idx" ON "customer_search_entries"("tenant_id", "purchase_date" DESC NULLS LAST, "account_number");