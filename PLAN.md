# RetailERP -- Comprehensive Implementation Plan

## 1. COMPLETE DATABASE SCHEMA

### Enums

```sql
-- Role-based access
CREATE TYPE user_role AS ENUM ('admin', 'accountant', 'others', 'employee');

-- Product lifecycle
CREATE TYPE product_status AS ENUM ('in_stock', 'sold', 'transferred', 'returned', 'damaged');

-- Sale types
CREATE TYPE sale_type AS ENUM ('full_payment', 'partial_with_promise', 'self_finance', 'company_finance');

-- Payment modes
CREATE TYPE payment_mode AS ENUM ('cash', 'credit_card', 'debit_card', 'upi', 'bank_transfer', 'cheque');

-- Installment statuses
CREATE TYPE installment_status AS ENUM ('upcoming', 'due_today', 'paid', 'partially_paid', 'overdue', 'rescheduled');

-- Transfer status
CREATE TYPE transfer_status AS ENUM ('initiated', 'in_transit', 'received', 'cancelled');

-- Expense category
CREATE TYPE expense_category AS ENUM ('rent', 'electricity', 'salary', 'transport', 'maintenance', 'marketing', 'purchase', 'misc');

-- Finance company payment status
CREATE TYPE finance_payment_status AS ENUM ('pending', 'received', 'overdue', 'partial');

-- Form field types
CREATE TYPE form_field_type AS ENUM ('text', 'number', 'select', 'multi_select', 'date', 'tel', 'email', 'textarea', 'checkbox', 'radio', 'file', 'hidden');

-- Bank transaction type
CREATE TYPE bank_txn_type AS ENUM ('credit', 'debit');

-- Reconciliation status
CREATE TYPE reconciliation_status AS ENUM ('unmatched', 'matched', 'manual_match', 'disputed');
```

### Table Definitions

**shops** -- Core multi-tenancy anchor

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | UUID | PK, DEFAULT gen_random_uuid() | |
| name | VARCHAR(200) | NOT NULL | e.g. "Vinod Electronics" |
| code | VARCHAR(20) | NOT NULL, UNIQUE | Short code: VE, NE, VHA, NHE |
| gst_number | VARCHAR(15) | NOT NULL, UNIQUE | GSTIN |
| pan_number | VARCHAR(10) | NOT NULL | |
| address_line1 | VARCHAR(255) | NOT NULL | |
| address_line2 | VARCHAR(255) | | |
| city | VARCHAR(100) | NOT NULL | |
| state | VARCHAR(100) | NOT NULL | |
| pincode | VARCHAR(6) | NOT NULL | |
| phone | VARCHAR(15) | NOT NULL | |
| email | VARCHAR(255) | | |
| bank_name | VARCHAR(200) | | |
| bank_account_number | VARCHAR(20) | | |
| bank_ifsc | VARCHAR(11) | | |
| bank_branch | VARCHAR(200) | | |
| logo_url | VARCHAR(500) | | |
| is_active | BOOLEAN | DEFAULT true | |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() | |

Indexes: `idx_shops_code` on (code), `idx_shops_gst` on (gst_number)

---

**users**

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | UUID | PK | |
| username | VARCHAR(100) | NOT NULL, UNIQUE | |
| password_hash | VARCHAR(255) | NOT NULL | bcrypt |
| full_name | VARCHAR(200) | NOT NULL | |
| email | VARCHAR(255) | | |
| phone | VARCHAR(15) | NOT NULL | |
| role | user_role | NOT NULL | |
| is_mobile_only | BOOLEAN | DEFAULT false | true for 'employee' role |
| is_active | BOOLEAN | DEFAULT true | |
| last_login_at | TIMESTAMPTZ | | |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() | |

Indexes: `idx_users_username` on (username), `idx_users_role` on (role)

---

**user_shops** -- Many-to-many: user <-> shop assignments

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | UUID | PK | |
| user_id | UUID | FK -> users(id), NOT NULL | |
| shop_id | UUID | FK -> shops(id), NOT NULL | |
| is_primary | BOOLEAN | DEFAULT false | Default shop at login |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | |

Indexes: `idx_user_shops_user` on (user_id), `idx_user_shops_shop` on (shop_id), UNIQUE(user_id, shop_id)

---

**refresh_tokens**

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | UUID | PK | |
| user_id | UUID | FK -> users(id), NOT NULL | |
| token_hash | VARCHAR(255) | NOT NULL | SHA-256 of refresh token |
| device_info | VARCHAR(500) | | User agent / device |
| expires_at | TIMESTAMPTZ | NOT NULL | |
| revoked_at | TIMESTAMPTZ | | NULL = active |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | |

Indexes: `idx_refresh_tokens_user` on (user_id), `idx_refresh_tokens_hash` on (token_hash)

---

**product_categories** -- Hierarchical categories (adjacency list + materialized path)

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | UUID | PK | |
| name | VARCHAR(200) | NOT NULL | |
| slug | VARCHAR(200) | NOT NULL | URL-friendly |
| parent_id | UUID | FK -> product_categories(id), NULLABLE | NULL = root |
| level | INTEGER | NOT NULL, DEFAULT 0 | 0=root, 1=L1, 2=L2 ... |
| path | VARCHAR(1000) | NOT NULL | Materialized path: "root.tv.led" |
| display_order | INTEGER | DEFAULT 0 | |
| is_leaf | BOOLEAN | DEFAULT false | Only leaves hold products |
| icon | VARCHAR(100) | | Icon identifier |
| is_active | BOOLEAN | DEFAULT true | |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() | |

Indexes: `idx_categories_parent` on (parent_id), `idx_categories_path` on (path), `idx_categories_slug` on (slug), UNIQUE(slug, parent_id)

---

**category_attributes** -- Dynamic attributes per leaf category

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | UUID | PK | |
| category_id | UUID | FK -> product_categories(id), NOT NULL | |
| attribute_name | VARCHAR(100) | NOT NULL | e.g. "imei", "tonnage" |
| attribute_label | VARCHAR(200) | NOT NULL | e.g. "IMEI Number" |
| attribute_type | form_field_type | NOT NULL | |
| is_required | BOOLEAN | DEFAULT false | |
| validation_rules | JSONB | | {"pattern":"^[0-9]{15}$"} |
| options | JSONB | | For select: ["1 Star","2 Star",...] |
| display_order | INTEGER | DEFAULT 0 | |
| is_active | BOOLEAN | DEFAULT true | |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | |

Indexes: `idx_cat_attrs_category` on (category_id), UNIQUE(category_id, attribute_name)

---

**products**

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | UUID | PK | |
| shop_id | UUID | FK -> shops(id), NOT NULL | Current owning shop |
| category_id | UUID | FK -> product_categories(id), NOT NULL | Leaf category |
| brand | VARCHAR(200) | NOT NULL | |
| model_number | VARCHAR(200) | NOT NULL | |
| serial_number | VARCHAR(200) | | |
| mrp | DECIMAL(12,2) | NOT NULL | |
| selling_price | DECIMAL(12,2) | NOT NULL | |
| purchase_price | DECIMAL(12,2) | NOT NULL | |
| color | VARCHAR(50) | | |
| weight_kg | DECIMAL(8,2) | | |
| distributor_id | UUID | FK -> distributors(id) | |
| purchase_id | UUID | FK -> purchases(id) | Link to purchase record |
| status | product_status | NOT NULL, DEFAULT 'in_stock' | |
| dynamic_attributes | JSONB | NOT NULL, DEFAULT '{}' | {"imei":"123...", "tonnage":"1.5"} |
| warranty_months | INTEGER | | |
| warranty_expiry | DATE | | |
| barcode | VARCHAR(100) | | |
| notes | TEXT | | |
| created_by | UUID | FK -> users(id) | |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() | |

Indexes: `idx_products_shop` on (shop_id), `idx_products_category` on (category_id), `idx_products_status` on (status), `idx_products_brand_model` on (brand, model_number), `idx_products_serial` on (serial_number), `idx_products_distributor` on (distributor_id), `idx_products_dynamic_attrs` GIN on (dynamic_attributes)

---

**product_audit_trail** -- Full lifecycle tracking

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | UUID | PK | |
| product_id | UUID | FK -> products(id), NOT NULL | |
| event_type | VARCHAR(50) | NOT NULL | 'purchased','transferred_out','transferred_in','sold','returned' |
| from_shop_id | UUID | FK -> shops(id) | |
| to_shop_id | UUID | FK -> shops(id) | |
| reference_id | UUID | | FK to sale/transfer/purchase |
| reference_type | VARCHAR(50) | | 'sale','transfer','purchase','return' |
| notes | TEXT | | |
| performed_by | UUID | FK -> users(id) | |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | |

Indexes: `idx_audit_product` on (product_id), `idx_audit_created` on (created_at)

---

**distributors**

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | UUID | PK | |
| company_name | VARCHAR(300) | NOT NULL | |
| contact_person | VARCHAR(200) | NOT NULL | |
| phone | VARCHAR(15) | NOT NULL | |
| alt_phone | VARCHAR(15) | | |
| email | VARCHAR(255) | | |
| gst_number | VARCHAR(15) | | |
| pan_number | VARCHAR(10) | | |
| address_line1 | VARCHAR(255) | NOT NULL | |
| address_line2 | VARCHAR(255) | | |
| city | VARCHAR(100) | NOT NULL | |
| state | VARCHAR(100) | NOT NULL | |
| pincode | VARCHAR(6) | NOT NULL | |
| bank_name | VARCHAR(200) | | |
| bank_account_number | VARCHAR(20) | | |
| bank_ifsc | VARCHAR(11) | | |
| bank_branch | VARCHAR(200) | | |
| payment_terms | VARCHAR(500) | | "Net 30", "COD" etc. |
| credit_limit | DECIMAL(12,2) | DEFAULT 0 | |
| dynamic_attributes | JSONB | DEFAULT '{}' | |
| is_active | BOOLEAN | DEFAULT true | |
| created_by | UUID | FK -> users(id) | |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() | |

Indexes: `idx_dist_name` on (company_name), `idx_dist_gst` on (gst_number), `idx_dist_phone` on (phone)

---

**distributor_categories** -- Which categories a distributor supplies

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | UUID | PK | |
| distributor_id | UUID | FK -> distributors(id), NOT NULL | |
| category_id | UUID | FK -> product_categories(id), NOT NULL | |

UNIQUE(distributor_id, category_id)

---

**purchases** -- Purchase invoices from distributors

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | UUID | PK | |
| shop_id | UUID | FK -> shops(id), NOT NULL | |
| distributor_id | UUID | FK -> distributors(id), NOT NULL | |
| invoice_number | VARCHAR(100) | NOT NULL | |
| invoice_date | DATE | NOT NULL | |
| total_amount | DECIMAL(12,2) | NOT NULL | |
| gst_amount | DECIMAL(12,2) | DEFAULT 0 | |
| discount_amount | DECIMAL(12,2) | DEFAULT 0 | |
| net_amount | DECIMAL(12,2) | NOT NULL | total - discount + gst |
| amount_paid | DECIMAL(12,2) | DEFAULT 0 | |
| payment_status | VARCHAR(20) | DEFAULT 'pending' | pending/partial/paid |
| notes | TEXT | | |
| created_by | UUID | FK -> users(id) | |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() | |

Indexes: `idx_purchases_shop` on (shop_id), `idx_purchases_dist` on (distributor_id), `idx_purchases_invoice` on (invoice_number), `idx_purchases_date` on (invoice_date)

---

**purchase_payments** -- Payments made against purchase invoices

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | UUID | PK | |
| purchase_id | UUID | FK -> purchases(id), NOT NULL | |
| amount | DECIMAL(12,2) | NOT NULL | |
| payment_mode | payment_mode | NOT NULL | |
| payment_date | DATE | NOT NULL | |
| reference_number | VARCHAR(100) | | Cheque/txn no |
| notes | TEXT | | |
| created_by | UUID | FK -> users(id) | |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | |

Indexes: `idx_pp_purchase` on (purchase_id)

---

**customers**

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | UUID | PK | |
| customer_code | VARCHAR(20) | NOT NULL, UNIQUE | Auto-generated: CUST-0001 |
| name | VARCHAR(200) | NOT NULL | |
| phone | VARCHAR(15) | NOT NULL | |
| alt_phone | VARCHAR(15) | | |
| aadhaar_number | VARCHAR(12) | | Encrypted at rest |
| address_line1 | VARCHAR(255) | | |
| address_line2 | VARCHAR(255) | | |
| city | VARCHAR(100) | | |
| state | VARCHAR(100) | | |
| pincode | VARCHAR(6) | | |
| photo_id_url | VARCHAR(500) | | Path to uploaded ID |
| is_guarantor | BOOLEAN | DEFAULT false | Marks if this record is a guarantor |
| guarantor_id | UUID | FK -> customers(id) | The guarantor for this customer |
| dynamic_attributes | JSONB | DEFAULT '{}' | |
| shop_id | UUID | FK -> shops(id), NOT NULL | Shop where first registered |
| created_by | UUID | FK -> users(id) | |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() | |

Indexes: `idx_customers_phone` on (phone), `idx_customers_code` on (customer_code), `idx_customers_name` on (name), `idx_customers_shop` on (shop_id), `idx_customers_guarantor` on (guarantor_id), `idx_customers_aadhaar` on (aadhaar_number)

---

**finance_companies**

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | UUID | PK | |
| name | VARCHAR(200) | NOT NULL | Bajaj Finance, HDB, Home Credit |
| code | VARCHAR(20) | NOT NULL, UNIQUE | |
| contact_phone | VARCHAR(15) | | |
| contact_email | VARCHAR(255) | | |
| is_active | BOOLEAN | DEFAULT true | |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | |

---

**sale_records** -- TRUE sale data (visible to Admin and Accountant)

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | UUID | PK | |
| sale_number | VARCHAR(30) | NOT NULL, UNIQUE | Auto: SALE-VE-20260416-001 |
| ledger_number | VARCHAR(50) | NOT NULL | Manual office register account number for redundancy with physical records |
| shop_id | UUID | FK -> shops(id), NOT NULL | |
| product_id | UUID | FK -> products(id), NOT NULL | |
| customer_id | UUID | FK -> customers(id), NOT NULL | |
| sale_date | DATE | NOT NULL | |
| sale_type | sale_type | NOT NULL | |
| mrp | DECIMAL(12,2) | NOT NULL | Snapshot at sale time |
| selling_price | DECIMAL(12,2) | NOT NULL | Actual sale price |
| discount_amount | DECIMAL(12,2) | DEFAULT 0 | |
| net_amount | DECIMAL(12,2) | NOT NULL | selling_price - discount |
| gst_rate | DECIMAL(4,2) | DEFAULT 0 | GST percentage |
| gst_amount | DECIMAL(12,2) | DEFAULT 0 | |
| total_amount | DECIMAL(12,2) | NOT NULL | net + gst |
| down_payment | DECIMAL(12,2) | DEFAULT 0 | |
| payment_mode | payment_mode | NOT NULL | For down_payment / full payment |
| -- Fields for partial_with_promise -- | | | |
| promise_date | DATE | | When remaining will be paid |
| pending_amount | DECIMAL(12,2) | DEFAULT 0 | |
| -- Fields for self_finance -- | | | |
| interest_rate | DECIMAL(4,2) | | 1, 1.5, 2, 2.5, 3 % per month |
| file_charge | DECIMAL(12,2) | DEFAULT 0 | |
| total_financed_amount | DECIMAL(12,2) | | principal + interest + file_charge |
| num_installments | INTEGER | | Number of EMI months |
| emi_amount | DECIMAL(12,2) | | Monthly EMI |
| guarantor_id | UUID | FK -> customers(id) | Required for self_finance |
| -- Fields for company_finance -- | | | |
| finance_company_id | UUID | FK -> finance_companies(id) | |
| financed_amount | DECIMAL(12,2) | | Amount financed by company |
| expected_payment_date | DATE | | Default: sale_date + 1 day |
| finance_payment_status | finance_payment_status | | |
| finance_payment_received_date | DATE | | |
| finance_reference_number | VARCHAR(100) | | |
| -- Metadata -- | | | |
| notes | TEXT | | |
| created_by | UUID | FK -> users(id), NOT NULL | |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() | |

Indexes: `idx_sales_shop` on (shop_id), `idx_sales_product` on (product_id), `idx_sales_customer` on (customer_id), `idx_sales_date` on (sale_date), `idx_sales_type` on (sale_type), `idx_sales_number` on (sale_number), `idx_sales_ledger` on (ledger_number), `idx_sales_finance_co` on (finance_company_id), `idx_sales_guarantor` on (guarantor_id), `idx_sales_created_by` on (created_by)

---

**sale_records_sanitized** -- Sanitized view (visible to "Others" role)

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | UUID | PK | Same UUID as sale_records |
| sale_number | VARCHAR(30) | NOT NULL | Same as real |
| ledger_number | VARCHAR(50) | NOT NULL | Same as real — office register number |
| shop_id | UUID | FK -> shops(id), NOT NULL | |
| product_id | UUID | FK -> products(id), NOT NULL | |
| customer_id | UUID | FK -> customers(id), NOT NULL | |
| sale_date | DATE | NOT NULL | Same date |
| sale_type | VARCHAR(20) | DEFAULT 'full_payment' | ALWAYS 'full_payment' |
| selling_price | DECIMAL(12,2) | NOT NULL | Same selling price |
| total_amount | DECIMAL(12,2) | NOT NULL | Same total |
| payment_mode | VARCHAR(20) | DEFAULT 'cash' | ALWAYS 'cash' |
| created_by | UUID | FK -> users(id), NOT NULL | |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | |

Indexes: `idx_sales_san_shop` on (shop_id), `idx_sales_san_date` on (sale_date)

---

**installment_schedules** -- Master schedule for self-finance sales

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | UUID | PK | |
| sale_id | UUID | FK -> sale_records(id), NOT NULL, UNIQUE | |
| total_principal | DECIMAL(12,2) | NOT NULL | selling_price - down_payment |
| total_interest | DECIMAL(12,2) | NOT NULL | |
| file_charge | DECIMAL(12,2) | DEFAULT 0 | |
| total_payable | DECIMAL(12,2) | NOT NULL | principal + interest + file_charge |
| num_installments | INTEGER | NOT NULL | |
| emi_amount | DECIMAL(12,2) | NOT NULL | |
| start_date | DATE | NOT NULL | First EMI date |
| status | VARCHAR(20) | DEFAULT 'active' | active/completed/defaulted |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() | |

Indexes: `idx_inst_sched_sale` on (sale_id)

---

**installments** -- Individual EMI records

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | UUID | PK | |
| schedule_id | UUID | FK -> installment_schedules(id), NOT NULL | |
| installment_number | INTEGER | NOT NULL | |
| due_date | DATE | NOT NULL | |
| amount_due | DECIMAL(12,2) | NOT NULL | |
| amount_paid | DECIMAL(12,2) | DEFAULT 0 | |
| remaining_amount | DECIMAL(12,2) | NOT NULL | amount_due - amount_paid |
| status | installment_status | NOT NULL, DEFAULT 'upcoming' | |
| is_rescheduled | BOOLEAN | DEFAULT false | |
| rescheduled_from_id | UUID | FK -> installments(id) | Original installment if this is a reschedule |
| notes | TEXT | | |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() | |

Indexes: `idx_inst_schedule` on (schedule_id), `idx_inst_due_date` on (due_date), `idx_inst_status` on (status), `idx_inst_rescheduled_from` on (rescheduled_from_id)

---

**installment_payments** -- Actual payment events against installments

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | UUID | PK | |
| installment_id | UUID | FK -> installments(id), NOT NULL | |
| amount | DECIMAL(12,2) | NOT NULL | |
| payment_mode | payment_mode | NOT NULL | |
| payment_date | DATE | NOT NULL | |
| collected_by | UUID | FK -> users(id) | Employee who collected |
| reference_number | VARCHAR(100) | | |
| notes | TEXT | | |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | |

Indexes: `idx_inst_pay_installment` on (installment_id), `idx_inst_pay_date` on (payment_date), `idx_inst_pay_collector` on (collected_by)

---

**employee_collection_assignments** -- Which employee collects from which customer

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | UUID | PK | |
| employee_id | UUID | FK -> users(id), NOT NULL | |
| schedule_id | UUID | FK -> installment_schedules(id), NOT NULL | |
| shop_id | UUID | FK -> shops(id), NOT NULL | |
| is_active | BOOLEAN | DEFAULT true | |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | |

Indexes: `idx_eca_employee` on (employee_id), `idx_eca_schedule` on (schedule_id)

---

**inter_shop_transfers**

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | UUID | PK | |
| product_id | UUID | FK -> products(id), NOT NULL | |
| from_shop_id | UUID | FK -> shops(id), NOT NULL | |
| to_shop_id | UUID | FK -> shops(id), NOT NULL | |
| transfer_date | DATE | NOT NULL | |
| status | transfer_status | NOT NULL, DEFAULT 'initiated' | |
| transfer_price | DECIMAL(12,2) | | GST inter-entity price |
| gst_amount | DECIMAL(12,2) | | |
| invoice_number | VARCHAR(100) | | Transfer invoice |
| notes | TEXT | | |
| initiated_by | UUID | FK -> users(id), NOT NULL | |
| received_by | UUID | FK -> users(id) | |
| received_at | TIMESTAMPTZ | | |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() | |

Indexes: `idx_transfer_product` on (product_id), `idx_transfer_from` on (from_shop_id), `idx_transfer_to` on (to_shop_id), `idx_transfer_date` on (transfer_date)

---

**expenses**

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | UUID | PK | |
| shop_id | UUID | FK -> shops(id), NOT NULL | |
| expense_date | DATE | NOT NULL | |
| category | expense_category | NOT NULL | |
| vendor_name | VARCHAR(200) | | |
| description | TEXT | | |
| amount | DECIMAL(12,2) | NOT NULL | |
| gst_amount | DECIMAL(12,2) | DEFAULT 0 | |
| invoice_number | VARCHAR(100) | | |
| invoice_url | VARCHAR(500) | | Scanned invoice |
| is_gst_claimable | BOOLEAN | DEFAULT false | |
| created_by | UUID | FK -> users(id) | |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() | |

Indexes: `idx_expenses_shop` on (shop_id), `idx_expenses_date` on (expense_date), `idx_expenses_category` on (category)

---

**bank_accounts**

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | UUID | PK | |
| shop_id | UUID | FK -> shops(id), NOT NULL | |
| bank_name | VARCHAR(200) | NOT NULL | |
| account_number | VARCHAR(20) | NOT NULL | |
| ifsc_code | VARCHAR(11) | NOT NULL | |
| account_type | VARCHAR(20) | DEFAULT 'current' | current/savings |
| opening_balance | DECIMAL(14,2) | DEFAULT 0 | |
| is_active | BOOLEAN | DEFAULT true | |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | |

Indexes: `idx_bank_acc_shop` on (shop_id)

---

**bank_transactions**

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | UUID | PK | |
| bank_account_id | UUID | FK -> bank_accounts(id), NOT NULL | |
| transaction_date | DATE | NOT NULL | |
| value_date | DATE | | |
| description | VARCHAR(500) | | Statement narration |
| reference_number | VARCHAR(100) | | Cheque/UTR number |
| txn_type | bank_txn_type | NOT NULL | credit/debit |
| amount | DECIMAL(12,2) | NOT NULL | |
| balance | DECIMAL(14,2) | | Running balance |
| reconciliation_status | reconciliation_status | DEFAULT 'unmatched' | |
| reconciled_with_type | VARCHAR(50) | | 'sale','purchase_payment','expense','installment_payment' |
| reconciled_with_id | UUID | | Reference to matched record |
| reconciled_by | UUID | FK -> users(id) | |
| reconciled_at | TIMESTAMPTZ | | |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | |

Indexes: `idx_bank_txn_account` on (bank_account_id), `idx_bank_txn_date` on (transaction_date), `idx_bank_txn_recon` on (reconciliation_status)

---

**form_definitions**

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | UUID | PK | |
| form_name | VARCHAR(100) | NOT NULL | 'product', 'customer', 'distributor', 'sale' |
| shop_id | UUID | FK -> shops(id), NULLABLE | NULL = global definition |
| version | INTEGER | NOT NULL, DEFAULT 1 | |
| is_active | BOOLEAN | DEFAULT true | |
| description | VARCHAR(500) | | |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() | |

Indexes: `idx_form_def_name` on (form_name), UNIQUE(form_name, shop_id, version)

---

**form_fields**

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | UUID | PK | |
| form_definition_id | UUID | FK -> form_definitions(id), NOT NULL | |
| field_name | VARCHAR(100) | NOT NULL | DB column / JSON key |
| field_label | VARCHAR(200) | NOT NULL | Display label |
| field_type | form_field_type | NOT NULL | |
| placeholder | VARCHAR(200) | | |
| default_value | VARCHAR(500) | | |
| is_required | BOOLEAN | DEFAULT false | |
| validation_rules | JSONB | | {"min":0, "max":999999, "pattern":"..."} |
| options | JSONB | | For select/radio: [{"value":"v","label":"l"}] |
| display_order | INTEGER | NOT NULL, DEFAULT 0 | |
| section_name | VARCHAR(100) | | Group fields into sections |
| is_visible | BOOLEAN | DEFAULT true | |
| css_class | VARCHAR(200) | | "col-span-2" etc. |
| depends_on | JSONB | | {"field":"sale_type","value":"self_finance"} |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | |

Indexes: `idx_form_fields_def` on (form_definition_id), UNIQUE(form_definition_id, field_name)

---

**notification_tokens** -- Push notification tokens for mobile

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | UUID | PK | |
| user_id | UUID | FK -> users(id), NOT NULL | |
| expo_push_token | VARCHAR(200) | NOT NULL | |
| device_info | VARCHAR(200) | | |
| is_active | BOOLEAN | DEFAULT true | |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | |

---

**notifications**

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | UUID | PK | |
| user_id | UUID | FK -> users(id), NOT NULL | |
| title | VARCHAR(200) | NOT NULL | |
| body | TEXT | NOT NULL | |
| data | JSONB | | Deep link info |
| is_read | BOOLEAN | DEFAULT false | |
| sent_at | TIMESTAMPTZ | | |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | |

---

**audit_log** -- System-wide audit

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | UUID | PK | |
| user_id | UUID | FK -> users(id) | |
| shop_id | UUID | FK -> shops(id) | |
| entity_type | VARCHAR(50) | NOT NULL | 'product','sale','customer', etc. |
| entity_id | UUID | NOT NULL | |
| action | VARCHAR(20) | NOT NULL | 'create','update','delete' |
| old_values | JSONB | | |
| new_values | JSONB | | |
| ip_address | VARCHAR(45) | | |
| user_agent | VARCHAR(500) | | |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | |

Indexes: `idx_audit_entity` on (entity_type, entity_id), `idx_audit_user` on (user_id), `idx_audit_created` on (created_at)

---

**employees** -- Placeholder for future expansion

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | UUID | PK | |
| user_id | UUID | FK -> users(id), UNIQUE | |
| shop_id | UUID | FK -> shops(id), NOT NULL | |
| designation | VARCHAR(100) | | |
| date_of_joining | DATE | | |
| salary | DECIMAL(10,2) | | |
| aadhaar_number | VARCHAR(12) | | |
| address | TEXT | | |
| emergency_contact | VARCHAR(15) | | |
| is_active | BOOLEAN | DEFAULT true | |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() | |

Indexes: `idx_employees_shop` on (shop_id), `idx_employees_user` on (user_id)

---

**app_settings** -- Key-value configuration

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | UUID | PK | |
| shop_id | UUID | FK -> shops(id), NULLABLE | NULL = global |
| key | VARCHAR(100) | NOT NULL | |
| value | JSONB | NOT NULL | |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() | |

UNIQUE(shop_id, key)

---

### Entity-Relationship Summary

```
shops 1--* user_shops *--1 users
shops 1--* products
shops 1--* sale_records
shops 1--* purchases
shops 1--* expenses
shops 1--* bank_accounts 1--* bank_transactions
shops 1--* employees

product_categories self-referencing (parent_id)
product_categories 1--* category_attributes
product_categories 1--* products

distributors 1--* purchases 1--* products
distributors *--* product_categories (via distributor_categories)
purchases 1--* purchase_payments

customers 1--* sale_records
customers self-referencing (guarantor_id)

sale_records 1--1 sale_records_sanitized (same id)
sale_records 1--0..1 installment_schedules 1--* installments 1--* installment_payments
sale_records *--1 finance_companies (optional)

products 1--* product_audit_trail
products 1--* inter_shop_transfers

form_definitions 1--* form_fields
```

---

## 2. MONOREPO FOLDER STRUCTURE

```
retail-erp/
├── turbo.json
├── package.json                      # Root workspace config
├── tsconfig.base.json               # Shared TS config
├── .gitignore
├── .env.example
├── .eslintrc.js
├── .prettierrc
├── docker-compose.yml               # Local dev: PostgreSQL, Redis (optional)
├── CLAUDE.md
├── README.md
│
├── apps/
│   ├── api/                         # Backend API
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── .env.example
│   │   ├── Dockerfile
│   │   ├── src/
│   │   │   ├── index.ts             # Entry point, server bootstrap
│   │   │   ├── app.ts              # Express/Fastify app setup
│   │   │   ├── config/
│   │   │   │   ├── index.ts        # Environment config loader
│   │   │   │   ├── database.ts     # Prisma client singleton
│   │   │   │   └── auth.ts         # JWT config
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts         # JWT verification
│   │   │   │   ├── rbac.ts         # Role-based access control
│   │   │   │   ├── shop-scope.ts   # Multi-tenant shop scoping
│   │   │   │   ├── error-handler.ts
│   │   │   │   ├── rate-limiter.ts
│   │   │   │   ├── audit-logger.ts # Auto-log changes
│   │   │   │   └── validate.ts     # Zod validation middleware
│   │   │   ├── modules/
│   │   │   │   ├── auth/
│   │   │   │   │   ├── auth.routes.ts
│   │   │   │   │   ├── auth.controller.ts
│   │   │   │   │   ├── auth.service.ts
│   │   │   │   │   └── auth.validation.ts
│   │   │   │   ├── shops/
│   │   │   │   │   ├── shops.routes.ts
│   │   │   │   │   ├── shops.controller.ts
│   │   │   │   │   ├── shops.service.ts
│   │   │   │   │   └── shops.validation.ts
│   │   │   │   ├── users/
│   │   │   │   │   ├── users.routes.ts
│   │   │   │   │   ├── users.controller.ts
│   │   │   │   │   ├── users.service.ts
│   │   │   │   │   └── users.validation.ts
│   │   │   │   ├── products/
│   │   │   │   │   ├── products.routes.ts
│   │   │   │   │   ├── products.controller.ts
│   │   │   │   │   ├── products.service.ts
│   │   │   │   │   ├── products.validation.ts
│   │   │   │   │   └── product-audit.service.ts
│   │   │   │   ├── categories/
│   │   │   │   │   ├── categories.routes.ts
│   │   │   │   │   ├── categories.controller.ts
│   │   │   │   │   ├── categories.service.ts
│   │   │   │   │   └── categories.validation.ts
│   │   │   │   ├── distributors/
│   │   │   │   │   ├── distributors.routes.ts
│   │   │   │   │   ├── distributors.controller.ts
│   │   │   │   │   ├── distributors.service.ts
│   │   │   │   │   └── distributors.validation.ts
│   │   │   │   ├── purchases/
│   │   │   │   │   ├── purchases.routes.ts
│   │   │   │   │   ├── purchases.controller.ts
│   │   │   │   │   ├── purchases.service.ts
│   │   │   │   │   └── purchases.validation.ts
│   │   │   │   ├── customers/
│   │   │   │   │   ├── customers.routes.ts
│   │   │   │   │   ├── customers.controller.ts
│   │   │   │   │   ├── customers.service.ts
│   │   │   │   │   └── customers.validation.ts
│   │   │   │   ├── sales/
│   │   │   │   │   ├── sales.routes.ts
│   │   │   │   │   ├── sales.controller.ts
│   │   │   │   │   ├── sales.service.ts
│   │   │   │   │   ├── sales.validation.ts
│   │   │   │   │   └── sanitized-sales.service.ts
│   │   │   │   ├── installments/
│   │   │   │   │   ├── installments.routes.ts
│   │   │   │   │   ├── installments.controller.ts
│   │   │   │   │   ├── installments.service.ts
│   │   │   │   │   ├── installments.validation.ts
│   │   │   │   │   ├── emi-calculator.ts
│   │   │   │   │   └── collection-list.service.ts
│   │   │   │   ├── transfers/
│   │   │   │   │   ├── transfers.routes.ts
│   │   │   │   │   ├── transfers.controller.ts
│   │   │   │   │   ├── transfers.service.ts
│   │   │   │   │   └── transfers.validation.ts
│   │   │   │   ├── expenses/
│   │   │   │   │   ├── expenses.routes.ts
│   │   │   │   │   ├── expenses.controller.ts
│   │   │   │   │   ├── expenses.service.ts
│   │   │   │   │   └── expenses.validation.ts
│   │   │   │   ├── bank/
│   │   │   │   │   ├── bank.routes.ts
│   │   │   │   │   ├── bank.controller.ts
│   │   │   │   │   ├── bank.service.ts
│   │   │   │   │   └── bank.validation.ts
│   │   │   │   ├── dashboard/
│   │   │   │   │   ├── dashboard.routes.ts
│   │   │   │   │   ├── dashboard.controller.ts
│   │   │   │   │   └── dashboard.service.ts
│   │   │   │   ├── forms/
│   │   │   │   │   ├── forms.routes.ts
│   │   │   │   │   ├── forms.controller.ts
│   │   │   │   │   ├── forms.service.ts
│   │   │   │   │   └── forms.validation.ts
│   │   │   │   ├── employees/
│   │   │   │   │   ├── employees.routes.ts
│   │   │   │   │   ├── employees.controller.ts
│   │   │   │   │   ├── employees.service.ts
│   │   │   │   │   └── employees.validation.ts
│   │   │   │   └── notifications/
│   │   │   │       ├── notifications.routes.ts
│   │   │   │       ├── notifications.controller.ts
│   │   │   │       ├── notifications.service.ts
│   │   │   │       └── push.service.ts  # Expo push
│   │   │   ├── utils/
│   │   │   │   ├── id-generator.ts     # CUST-0001, SALE-VE-... 
│   │   │   │   ├── pagination.ts
│   │   │   │   ├── date-helpers.ts
│   │   │   │   ├── encryption.ts       # Aadhaar encryption
│   │   │   │   └── response.ts         # Standard API response shape
│   │   │   └── types/
│   │   │       └── express.d.ts        # Augment Request with user/shop
│   │   └── prisma/
│   │       ├── schema.prisma
│   │       ├── migrations/
│   │       └── seed/
│   │           ├── index.ts            # Seed runner
│   │           ├── shops.seed.ts
│   │           ├── users.seed.ts
│   │           ├── categories.seed.ts
│   │           ├── distributors.seed.ts
│   │           ├── products.seed.ts
│   │           ├── customers.seed.ts
│   │           ├── sales.seed.ts
│   │           ├── installments.seed.ts
│   │           ├── form-definitions.seed.ts
│   │           └── finance-companies.seed.ts
│   │
│   ├── web/                            # React Web App
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vite.config.ts
│   │   ├── tailwind.config.ts
│   │   ├── postcss.config.js
│   │   ├── components.json            # shadcn/ui config
│   │   ├── index.html
│   │   ├── public/
│   │   │   └── favicon.ico
│   │   └── src/
│   │       ├── main.tsx
│   │       ├── App.tsx
│   │       ├── routes/
│   │       │   ├── index.tsx          # Route definitions (React Router v7)
│   │       │   ├── ProtectedRoute.tsx
│   │       │   └── RoleGuard.tsx
│   │       ├── layouts/
│   │       │   ├── AuthLayout.tsx     # Login page layout
│   │       │   ├── DashboardLayout.tsx # Sidebar + header + main content
│   │       │   └── components/
│   │       │       ├── Sidebar.tsx
│   │       │       ├── Header.tsx     # Shop switcher, user menu
│   │       │       ├── ShopSwitcher.tsx
│   │       │       └── Breadcrumbs.tsx
│   │       ├── pages/
│   │       │   ├── auth/
│   │       │   │   └── LoginPage.tsx
│   │       │   ├── dashboard/
│   │       │   │   ├── DashboardPage.tsx
│   │       │   │   └── components/
│   │       │   │       ├── SalesChart.tsx
│   │       │   │       ├── TopProductsCard.tsx
│   │       │   │       ├── YoYComparison.tsx
│   │       │   │       └── OverdueInstallments.tsx
│   │       │   ├── products/
│   │       │   │   ├── ProductListPage.tsx
│   │       │   │   ├── ProductAddPage.tsx
│   │       │   │   ├── ProductEditPage.tsx
│   │       │   │   ├── ProductDetailPage.tsx
│   │       │   │   └── components/
│   │       │   │       ├── ProductTable.tsx
│   │       │   │       ├── ProductForm.tsx        # Dynamic
│   │       │   │       ├── CategoryCascader.tsx
│   │       │   │       ├── DynamicAttributeFields.tsx
│   │       │   │       ├── ProductSearch.tsx
│   │       │   │       ├── ProductTimeline.tsx    # Audit trail
│   │       │   │       └── GlobalSearch.tsx
│   │       │   ├── distributors/
│   │       │   │   ├── DistributorListPage.tsx
│   │       │   │   ├── DistributorAddPage.tsx
│   │       │   │   ├── DistributorEditPage.tsx
│   │       │   │   ├── DistributorDetailPage.tsx
│   │       │   │   └── components/
│   │       │   │       ├── DistributorTable.tsx
│   │       │   │       ├── DistributorForm.tsx    # Dynamic
│   │       │   │       └── DistributorProducts.tsx
│   │       │   ├── purchases/
│   │       │   │   ├── PurchaseListPage.tsx
│   │       │   │   ├── PurchaseAddPage.tsx
│   │       │   │   ├── PurchaseDetailPage.tsx
│   │       │   │   └── components/
│   │       │   │       ├── PurchaseForm.tsx
│   │       │   │       ├── PurchaseProductAdder.tsx
│   │       │   │       └── PurchasePaymentTracker.tsx
│   │       │   ├── customers/
│   │       │   │   ├── CustomerListPage.tsx
│   │       │   │   ├── CustomerAddPage.tsx
│   │       │   │   ├── CustomerDetailPage.tsx
│   │       │   │   └── components/
│   │       │   │       ├── CustomerTable.tsx
│   │       │   │       ├── CustomerForm.tsx       # Dynamic
│   │       │   │       └── CustomerSearch.tsx
│   │       │   ├── sales/
│   │       │   │   ├── SaleListPage.tsx
│   │       │   │   ├── SaleCreatePage.tsx
│   │       │   │   ├── SaleDetailPage.tsx
│   │       │   │   └── components/
│   │       │   │       ├── SaleForm.tsx
│   │       │   │       ├── SaleProductSection.tsx
│   │       │   │       ├── SaleCustomerSection.tsx
│   │       │   │       ├── SalePaymentSection.tsx
│   │       │   │       ├── InstallmentCalculator.tsx
│   │       │   │       ├── EMISchedulePreview.tsx
│   │       │   │       ├── GuarantorSection.tsx
│   │       │   │       └── CompanyFinanceSection.tsx
│   │       │   ├── installments/
│   │       │   │   ├── InstallmentListPage.tsx
│   │       │   │   ├── InstallmentDetailPage.tsx
│   │       │   │   ├── CollectionListPage.tsx
│   │       │   │   └── components/
│   │       │   │       ├── InstallmentTable.tsx
│   │       │   │       ├── PaymentTimeline.tsx
│   │       │   │       ├── RecordPaymentDialog.tsx
│   │       │   │       ├── RescheduleDialog.tsx
│   │       │   │       └── CollectionDayList.tsx
│   │       │   ├── transfers/
│   │       │   │   ├── TransferListPage.tsx
│   │       │   │   ├── TransferCreatePage.tsx
│   │       │   │   └── components/
│   │       │   │       ├── TransferForm.tsx
│   │       │   │       └── TransferTable.tsx
│   │       │   ├── expenses/
│   │       │   │   ├── ExpenseListPage.tsx
│   │       │   │   ├── ExpenseAddPage.tsx
│   │       │   │   └── components/
│   │       │   │       ├── ExpenseTable.tsx
│   │       │   │       └── ExpenseForm.tsx
│   │       │   ├── bank/
│   │       │   │   ├── BankAccountsPage.tsx
│   │       │   │   ├── BankTransactionsPage.tsx
│   │       │   │   └── components/
│   │       │   │       ├── TransactionTable.tsx
│   │       │   │       ├── UploadStatementDialog.tsx
│   │       │   │       └── ReconciliationPanel.tsx
│   │       │   ├── employees/
│   │       │   │   ├── EmployeeListPage.tsx
│   │       │   │   ├── EmployeeAddPage.tsx
│   │       │   │   └── components/
│   │       │   │       ├── EmployeeTable.tsx
│   │       │   │       └── EmployeeForm.tsx
│   │       │   └── settings/
│   │       │       ├── FormBuilderPage.tsx        # Manage form_definitions
│   │       │       ├── CategoryManagerPage.tsx    # Manage categories + attrs
│   │       │       └── components/
│   │       │           ├── FormFieldEditor.tsx
│   │       │           └── CategoryTree.tsx
│   │       ├── components/                # Shared app components
│   │       │   ├── ui/                   # shadcn/ui components
│   │       │   ├── DynamicForm.tsx       # Renders form from form_definitions
│   │       │   ├── DataTable.tsx         # Reusable paginated table
│   │       │   ├── SearchInput.tsx
│   │       │   ├── DateRangePicker.tsx
│   │       │   ├── ConfirmDialog.tsx
│   │       │   ├── LoadingSpinner.tsx
│   │       │   ├── EmptyState.tsx
│   │       │   ├── StatusBadge.tsx
│   │       │   └── FileUpload.tsx
│   │       ├── hooks/
│   │       │   ├── useAuth.ts
│   │       │   ├── useShop.ts           # Current shop context
│   │       │   ├── useRBAC.ts
│   │       │   ├── usePagination.ts
│   │       │   ├── useDebounce.ts
│   │       │   ├── useDynamicForm.ts    # Fetch & render form definitions
│   │       │   └── useApi.ts            # TanStack Query wrapper
│   │       ├── lib/
│   │       │   ├── api-client.ts        # Axios instance with interceptors
│   │       │   ├── query-client.ts      # TanStack Query setup
│   │       │   ├── auth.ts             # Token management
│   │       │   └── utils.ts            # cn() etc.
│   │       ├── stores/
│   │       │   ├── auth-store.ts       # Zustand store
│   │       │   └── shop-store.ts
│   │       └── types/
│   │           └── index.ts
│   │
│   └── mobile/                          # React Native (Expo)
│       ├── package.json
│       ├── tsconfig.json
│       ├── app.json                    # Expo config
│       ├── eas.json                    # EAS Build config
│       ├── app/                        # Expo Router (file-based routing)
│       │   ├── _layout.tsx            # Root layout
│       │   ├── (auth)/
│       │   │   ├── _layout.tsx
│       │   │   └── login.tsx
│       │   └── (app)/
│       │       ├── _layout.tsx        # Tab layout
│       │       ├── collections/
│       │       │   ├── index.tsx      # Today's collection list
│       │       │   └── [id].tsx       # Sale detail + timeline
│       │       ├── record-payment/
│       │       │   └── [installmentId].tsx
│       │       └── profile/
│       │           └── index.tsx
│       ├── components/
│       │   ├── CollectionCard.tsx
│       │   ├── PaymentForm.tsx
│       │   ├── InstallmentTimeline.tsx
│       │   ├── ShopPicker.tsx
│       │   └── LoadingScreen.tsx
│       ├── hooks/
│       │   ├── useAuth.ts
│       │   ├── useCollections.ts
│       │   └── usePushNotifications.ts
│       ├── lib/
│       │   ├── api-client.ts
│       │   └── storage.ts            # SecureStore for tokens
│       └── types/
│           └── index.ts
│
├── packages/
│   ├── shared-types/                   # Shared TypeScript types/interfaces
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── shop.types.ts
│   │       ├── user.types.ts
│   │       ├── product.types.ts
│   │       ├── sale.types.ts
│   │       ├── installment.types.ts
│   │       ├── customer.types.ts
│   │       ├── distributor.types.ts
│   │       ├── form.types.ts
│   │       ├── api-response.types.ts
│   │       └── enums.ts
│   │
│   ├── shared-utils/                   # Shared utility functions
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── emi-calculator.ts      # EMI calculation shared between web preview & API
│   │       ├── validators.ts          # Phone, GST, Aadhaar format validators
│   │       ├── formatters.ts          # Currency, date formatting (INR)
│   │       └── constants.ts           # Interest rates, pagination defaults
│   │
│   └── eslint-config/                  # Shared ESLint config
│       ├── package.json
│       └── index.js
│
└── infra/                              # Deployment / infrastructure
    ├── azure/
    │   ├── bicep/                     # Azure Bicep IaC templates
    │   │   ├── main.bicep
    │   │   ├── app-service.bicep
    │   │   ├── postgres.bicep
    │   │   ├── static-web-app.bicep
    │   │   └── blob-storage.bicep
    │   └── scripts/
    │       ├── deploy.sh
    │       └── setup-env.sh
    ├── docker/
    │   ├── Dockerfile.api
    │   └── docker-compose.yml
    └── .github/
        └── workflows/
            ├── ci.yml                 # Lint, test, build
            └── deploy.yml             # Deploy to Azure
```

---

## 3. API ENDPOINT INVENTORY

All endpoints prefixed with `/api/v1`. All data-returning endpoints scoped to the currently active shop via middleware (from JWT + header `X-Shop-Id`).

### Auth Module

| Method | Path | Description | Auth | Roles |
|--------|------|-------------|------|-------|
| GET | /auth/shops | List all active shops (for login dropdown) | No | Public |
| POST | /auth/login | Login with username, password, shop_id | No | Public |
| POST | /auth/refresh | Refresh access token | Refresh token | Any |
| POST | /auth/logout | Revoke refresh token | Yes | Any |
| GET | /auth/me | Current user profile + permissions | Yes | Any |
| PUT | /auth/change-password | Change own password | Yes | Any |
| POST | /auth/switch-shop | Switch active shop (returns new token) | Yes | Admin, Accountant |

### Shops Module

| Method | Path | Description | Auth | Roles |
|--------|------|-------------|------|-------|
| GET | /shops | List all shops | Yes | Admin |
| GET | /shops/:id | Shop details | Yes | Admin |
| PUT | /shops/:id | Update shop details | Yes | Admin |

### Users Module

| Method | Path | Description | Auth | Roles |
|--------|------|-------------|------|-------|
| GET | /users | List users (optionally filter by shop, role) | Yes | Admin |
| POST | /users | Create user | Yes | Admin |
| GET | /users/:id | User detail | Yes | Admin |
| PUT | /users/:id | Update user | Yes | Admin |
| DELETE | /users/:id | Soft delete / deactivate | Yes | Admin |
| PUT | /users/:id/assign-shops | Assign shops to user | Yes | Admin |

### Product Categories Module

| Method | Path | Description | Auth | Roles |
|--------|------|-------------|------|-------|
| GET | /categories | Full category tree | Yes | Any |
| GET | /categories/:id | Category with attributes | Yes | Any |
| POST | /categories | Create category | Yes | Admin |
| PUT | /categories/:id | Update category | Yes | Admin |
| DELETE | /categories/:id | Soft delete (only if no products) | Yes | Admin |
| GET | /categories/:id/attributes | Category-specific attributes | Yes | Any |
| POST | /categories/:id/attributes | Add attribute to category | Yes | Admin |
| PUT | /categories/:id/attributes/:attrId | Update attribute | Yes | Admin |
| DELETE | /categories/:id/attributes/:attrId | Remove attribute | Yes | Admin |

### Products Module

| Method | Path | Description | Auth | Roles |
|--------|------|-------------|------|-------|
| GET | /products | List (paginated, filter by category, status, brand) | Yes | Any |
| GET | /products/search | Global search (3+ chars) on model/brand/serial | Yes | Any |
| POST | /products | Create product | Yes | Admin, Accountant |
| GET | /products/:id | Product detail + dynamic attrs | Yes | Any |
| PUT | /products/:id | Update product | Yes | Admin, Accountant |
| GET | /products/:id/history | Audit trail timeline | Yes | Any |
| GET | /products/:id/can-sell | Check if product is sellable | Yes | Any |

### Distributors Module

| Method | Path | Description | Auth | Roles |
|--------|------|-------------|------|-------|
| GET | /distributors | List (paginated, search) | Yes | Admin, Accountant |
| POST | /distributors | Create | Yes | Admin, Accountant |
| GET | /distributors/:id | Detail with aggregates | Yes | Admin, Accountant |
| PUT | /distributors/:id | Update | Yes | Admin, Accountant |
| GET | /distributors/:id/products | Products purchased from distributor (date filter) | Yes | Admin, Accountant |
| GET | /distributors/:id/payments | Payment history | Yes | Admin, Accountant |

### Purchases Module

| Method | Path | Description | Auth | Roles |
|--------|------|-------------|------|-------|
| GET | /purchases | List (paginated, filter by distributor, date, status) | Yes | Admin, Accountant |
| POST | /purchases | Create purchase + products | Yes | Admin, Accountant |
| GET | /purchases/:id | Purchase detail | Yes | Admin, Accountant |
| PUT | /purchases/:id | Update purchase | Yes | Admin, Accountant |
| POST | /purchases/:id/payments | Record payment against purchase | Yes | Admin, Accountant |

### Customers Module

| Method | Path | Description | Auth | Roles |
|--------|------|-------------|------|-------|
| GET | /customers | List (paginated, search) | Yes | Admin, Accountant, Others |
| GET | /customers/search | Quick search by phone/name | Yes | Any |
| POST | /customers | Create customer | Yes | Admin, Accountant, Others |
| GET | /customers/:id | Customer detail + purchase history | Yes | Admin, Accountant, Others |
| PUT | /customers/:id | Update | Yes | Admin, Accountant |
| GET | /customers/:id/sales | Sales to this customer | Yes | Admin, Accountant |

### Sales Module

| Method | Path | Description | Auth | Roles |
|--------|------|-------------|------|-------|
| GET | /sales | List sales (paginated, date filter). RBAC: Others see sanitized. | Yes | Admin, Accountant, Others |
| POST | /sales | Create sale (writes both real + sanitized) | Yes | Admin, Accountant |
| GET | /sales/:id | Sale detail. RBAC: Others see sanitized version. | Yes | Admin, Accountant, Others |
| GET | /sales/:id/installments | Installment schedule for sale | Yes | Admin, Accountant |
| PUT | /sales/:id/finance-payment | Record company finance payment received | Yes | Admin, Accountant |

### Installments Module

| Method | Path | Description | Auth | Roles |
|--------|------|-------------|------|-------|
| GET | /installments | List all installment schedules (filter by status) | Yes | Admin, Accountant |
| GET | /installments/overdue | Overdue installments | Yes | Admin, Accountant |
| GET | /installments/collections/today | Today's collection list (filter by employee) | Yes | Admin, Accountant, Employee |
| GET | /installments/collections/date/:date | Collection list for specific date | Yes | Admin, Accountant, Employee |
| GET | /installments/:scheduleId | Schedule detail with all installments | Yes | Admin, Accountant, Employee |
| GET | /installments/:scheduleId/timeline | Visual timeline data | Yes | Admin, Accountant |
| POST | /installments/:installmentId/pay | Record payment (full/partial) | Yes | Admin, Accountant, Employee |
| POST | /installments/:installmentId/reschedule | Reschedule to new date | Yes | Admin, Accountant |
| POST | /installments/:installmentId/partial-reschedule | Partial pay + reschedule remainder | Yes | Admin, Accountant, Employee |

### Transfers Module

| Method | Path | Description | Auth | Roles |
|--------|------|-------------|------|-------|
| GET | /transfers | List transfers (filter by from/to shop, status) | Yes | Admin, Accountant |
| POST | /transfers | Initiate transfer | Yes | Admin |
| GET | /transfers/:id | Transfer detail | Yes | Admin, Accountant |
| PUT | /transfers/:id/receive | Mark received at destination shop | Yes | Admin |
| PUT | /transfers/:id/cancel | Cancel transfer | Yes | Admin |

### Expenses Module

| Method | Path | Description | Auth | Roles |
|--------|------|-------------|------|-------|
| GET | /expenses | List (paginated, filter by category, date) | Yes | Admin, Accountant |
| POST | /expenses | Create expense | Yes | Admin, Accountant |
| GET | /expenses/:id | Expense detail | Yes | Admin, Accountant |
| PUT | /expenses/:id | Update | Yes | Admin, Accountant |
| DELETE | /expenses/:id | Soft delete | Yes | Admin |

### Bank Module

| Method | Path | Description | Auth | Roles |
|--------|------|-------------|------|-------|
| GET | /bank/accounts | List bank accounts for shop | Yes | Admin, Accountant |
| POST | /bank/accounts | Create bank account | Yes | Admin |
| GET | /bank/accounts/:id/transactions | Transactions (paginated, date filter) | Yes | Admin, Accountant |
| POST | /bank/accounts/:id/transactions | Add single transaction | Yes | Admin, Accountant |
| POST | /bank/accounts/:id/upload-statement | Upload CSV/XLS statement (bulk import) | Yes | Admin, Accountant |
| PUT | /bank/transactions/:id/reconcile | Reconcile with a sale/payment/expense | Yes | Admin, Accountant |
| GET | /bank/transactions/unmatched | Unreconciled transactions | Yes | Admin, Accountant |

### Dashboard Module

| Method | Path | Description | Auth | Roles |
|--------|------|-------------|------|-------|
| GET | /dashboard/sales-graph | Sales data (date range, default 30 days) | Yes | Admin |
| GET | /dashboard/top-products | Top 10 products sold (date range) | Yes | Admin |
| GET | /dashboard/yoy-comparison | Year-over-year comparison | Yes | Admin |
| GET | /dashboard/overdue-installments | Overdue installments summary | Yes | Admin |
| GET | /dashboard/summary | Key metrics: total sales, pending installments, stock value | Yes | Admin |

### Forms Module

| Method | Path | Description | Auth | Roles |
|--------|------|-------------|------|-------|
| GET | /forms/definitions | List all form definitions | Yes | Admin |
| GET | /forms/definitions/:formName | Get active form definition with fields | Yes | Any |
| POST | /forms/definitions | Create form definition | Yes | Admin |
| PUT | /forms/definitions/:id | Update form definition | Yes | Admin |
| GET | /forms/definitions/:id/fields | Get fields for definition | Yes | Any |
| POST | /forms/definitions/:id/fields | Add field | Yes | Admin |
| PUT | /forms/fields/:id | Update field | Yes | Admin |
| DELETE | /forms/fields/:id | Remove field | Yes | Admin |
| PUT | /forms/definitions/:id/fields/reorder | Reorder fields | Yes | Admin |

### Employees Module (Placeholder)

| Method | Path | Description | Auth | Roles |
|--------|------|-------------|------|-------|
| GET | /employees | List employees for shop | Yes | Admin |
| POST | /employees | Create employee | Yes | Admin |
| GET | /employees/:id | Employee detail | Yes | Admin |
| PUT | /employees/:id | Update employee | Yes | Admin |

### Notifications Module

| Method | Path | Description | Auth | Roles |
|--------|------|-------------|------|-------|
| POST | /notifications/register-token | Register Expo push token | Yes | Employee |
| GET | /notifications | User's notifications | Yes | Any |
| PUT | /notifications/:id/read | Mark as read | Yes | Any |

---

## 4. UI SCREEN/PAGE DESCRIPTIONS

### 4.1 Login Page (`/login`)

**Layout**: Centered card on a neutral background with RetailERP logo at top.

**Content**:
- Shop selector dropdown (fetches from `/auth/shops`). Large dropdown with shop icons/logos. Required selection first.
- Once shop selected, username and password fields appear with a slide-down animation.
- "Login" button. Loading state with spinner.
- Error messages displayed inline below the field and/or as a toast.
- No "forgot password" -- admin resets manually (small business).

**Behavior**: On success, stores access token in memory and refresh token in httpOnly cookie (web) or SecureStore (mobile). Redirects to Dashboard (admin) or Products (others).

---

### 4.2 Dashboard (`/dashboard`) -- Admin Only

**Layout**: Full-width content area within DashboardLayout. Four-card summary row at top, two charts row below, two tables/lists at bottom.

**Summary Cards** (top row, 4 cards):
1. **Total Sales This Month** -- Amount in INR, percentage change from last month
2. **Pending Installments** -- Count and total amount overdue
3. **Stock Value** -- Total inventory value at selling price
4. **Today's Collections** -- Expected collections today, amount collected so far

**Charts Row**:
1. **Sales Graph** (left, 60% width): Recharts `LineChart` or `BarChart`. Toggle between line/bar. Date range picker (default: last 30 days). X-axis: dates. Y-axis: sale amount. Optionally overlay previous year for comparison.
2. **Top 10 Products Sold** (right, 40% width): Horizontal `BarChart` showing product name + count. Date range picker.

**Bottom Row**:
1. **Year-over-Year Comparison** (left): Side-by-side bar chart. Same month last year vs this year. Useful for purchasing decisions.
2. **Overdue Installments** (right): Table showing customer name, phone, product, EMI#, days overdue, amount. Clickable rows.

---

### 4.3 Product List (`/products`)

**Layout**: Page header with title "Products" + "Add Product" button. Search bar. Filters row. Table.

**Search Section**:
- Category cascade dropdowns (Level 1 -> Level 2 -> Level 3 if exists). Selecting category filters products.
- Text search input (model/brand/serial). Minimum 3 chars triggers search.
- Status filter dropdown: All / In Stock / Sold / Transferred.
- "Clear Filters" button.

**Separate Global Search**: In the header bar (accessible from any page). A search icon that expands to a full-width search bar. 3+ characters triggers search across all products regardless of category. Shows results in a dropdown overlay with product name, category, status, shop.

**Table**: `DataTable` component with columns: S.No, Brand, Model, Category, Serial Number, MRP, Selling Price, Status (badge), Actions.
- Actions column: Edit (pencil icon), "Sell Item" button (green, only visible for `in_stock` items).
- Pagination: 20 per page, page numbers, prev/next.
- Clickable row -> Product Detail page.

---

### 4.4 Product Add/Edit (`/products/new`, `/products/:id/edit`)

**Layout**: Two-column form within a card.

**Section 1: Category Selection** (top):
- Cascading dropdowns. On selecting leaf category, dynamic fields below update.

**Section 2: Common Fields**:
- Brand (text), Model Number (text), Serial Number (text)
- MRP (number), Selling Price (number), Purchase Price (number)
- Color (text), Weight (number)
- Distributor (searchable select, fetches from distributors)
- Warranty Months (number), Barcode (text)

**Section 3: Dynamic Attributes** (rendered from `category_attributes`):
- For Mobile: IMEI (text, 15-digit validation), IMEI2 (text, optional)
- For AC: Tonnage (select: 1, 1.5, 2), Star Rating (select: 1-5)
- For TV: Screen Size (number, inches), Resolution (select: HD/FHD/4K/8K)
- For Furniture: Material (select: Wood/Metal/Fabric/Leather), Dimensions (text)

**Section 4: Notes** (optional textarea)

**Footer**: "Save Product" / "Update Product" button + "Cancel".

All form fields are dynamically fetched from `form_definitions` and `category_attributes`.

---

### 4.5 Product Detail (`/products/:id`)

**Layout**: Left column (60%) with product info card, right column (40%) with audit trail timeline.

**Product Info Card**: All product details displayed in a clean label-value grid. Status badge prominently displayed. Dynamic attributes shown in their own section. If `in_stock`, show "Sell Item" and "Transfer" action buttons.

**Audit Trail Timeline** (`ProductTimeline`): Vertical timeline showing every event:
- Purchased from [Distributor] on [Date] at [Shop]
- Transferred from [Shop A] to [Shop B] on [Date]
- Sold to [Customer] on [Date] at [Shop]
Each node is color-coded: green (purchase), blue (transfer), red (sale), orange (return).

---

### 4.6 Distributor List (`/distributors`)

**Layout**: Header + search + table.

**Search**: Text input (company name, contact, phone, GST).

**Table**: Company Name, Contact Person, Phone, GST Number, Total Products Purchased (computed), Total Payment Paid (computed), Pending Payment (computed), Actions (edit icon).

Each row clickable -> Distributor Detail. Paginated 20/page.

---

### 4.7 Distributor Detail (`/distributors/:id`)

**Layout**: Top card with distributor info. Below: tabbed view.

**Tabs**:
1. **Products Purchased**: Table of all products from this distributor. Date range filter. Columns: Product, Category, Purchase Date, Invoice#, Purchase Price.
2. **Payment History**: Table of all payments. Columns: Date, Amount, Mode, Reference, Invoice#.
3. **Pending Invoices**: Open invoices with amounts due.

---

### 4.8 Purchase Recording (`/purchases/new`)

**Layout**: Multi-step form.

**Step 1: Select Distributor**: Searchable dropdown. Once selected, distributor info summary shown.

**Step 2: Invoice Details**: Invoice Number (text), Invoice Date (date picker), Notes.

**Step 3: Add Products**: Repeating section. For each product:
- Category cascade -> dynamic fields
- Brand, Model, Serial, MRP, Selling Price, Purchase Price
- Dynamic attributes based on category
- "Add Another Product" button (adds another row)

**Step 4: Payment**: Total Amount (auto-calculated), GST Amount, Discount, Net Amount. Payment: Amount Paid, Payment Mode, Reference Number. Calculates pending automatically.

**Step 5: Review & Submit**: Summary of all entered data. "Confirm Purchase" button.

---

### 4.9 Sale Create (`/sales/new?productId=xxx`)

**Layout**: Single-page multi-section form. Product section at top (pre-filled, non-editable if navigated from "Sell Item").

**Section 1: Product** (read-only if pre-populated):
- Product name, category, brand, model, serial, selling price displayed in a highlighted card.

**Section 1.5: Ledger Number**:
- `ledger_number` (text input, required): The office register account number. This is the manual ID recorded in the physical register for redundancy with offline records. Entered by the user at the time of sale.

**Section 2: Customer**:
- Search bar: "Search by phone or name". Results dropdown.
- If found: Customer details auto-filled (read-only). "Change Customer" link.
- If not found: "Create New Customer" button expands inline form (name, phone, alt_phone, aadhaar, address, photo_id upload). Auto-generates customer_code on save.

**Section 3: Sale Type** (radio buttons / segmented control):
- **Full Payment**: Shows amount field + payment mode dropdown.
- **Partial with Promise**: Shows down_payment, payment_mode, promise_date, pending_amount (auto-calc).
- **Self Finance (Installment)**: Expands to show:
  - Down Payment (number)
  - Interest Rate (radio: 1%, 1.5%, 2%, 2.5%, 3%)
  - File Charge (optional number)
  - Number of Months (select: 3, 6, 9, 12, 15, 18, 24)
  - **EMI Preview**: Real-time recalculation. Shows: Principal = Selling Price - Down Payment. Total Interest. File Charge. Total Payable. EMI Amount.
  - **Schedule Preview Table**: Month#, Due Date, Amount. Scrollable.
  - **Guarantor Section**: Same fields as customer form but labels say "Guarantor Name", "Guarantor Phone", etc. Search existing customer or enter new. Linked via guarantor_id.
- **Company Finance**: Shows:
  - Finance Company (dropdown: Bajaj Finance, HDB, Home Credit)
  - Down Payment (optional)
  - Financed Amount (number)
  - Expected Payment Date (date picker, default: tomorrow)

**Section 4: Notes** (optional textarea)

**Footer**: "Complete Sale" button. On submit: creates sale_records, sale_records_sanitized, installment_schedule + installments (if self-finance), updates product status to "sold", records audit trail.

---

### 4.10 Sale List (`/sales`)

**Layout**: Date range picker + sale type filter + table.

**Table Columns**: Sale#, Ledger#, Date, Customer, Product, Sale Type (badge), Total Amount, Payment Status, Created By, Actions.

**RBAC**: "Others" role sees same table but Sale Type always shows "Full Payment" and Total Amount is the same. No installment columns visible. Data comes from `sale_records_sanitized`.

---

### 4.11 Sale Detail (`/sales/:id`)

**Layout**: Top card with sale info. If installment sale, installment timeline below.

**For Others role**: Shows sanitized version -- full payment, cash, no installment info at all.

**For Admin/Accountant**: Full detail including installment schedule, guarantor info, finance company info. If company finance, shows payment status from finance company with "Record Payment Received" button.

---

### 4.12 Installment Management (`/installments`)

**Not visible to Others role at all.**

**Layout**: Tab navigation: "Active Schedules" | "Overdue" | "Completed" | "Today's Collections"

**Active Schedules Tab**: Table of all active installment schedules. Columns: Customer, Product, EMI Amount, Total/Paid/Remaining, Next Due Date, Status. Clickable row -> Schedule Detail.

**Overdue Tab**: Filtered view showing only overdue installments. Highlighted in red. Shows days overdue.

**Today's Collections Tab** (`CollectionDayList`): Date picker (default: today). List view (not table, card-style for mobile friendliness):
- Each card: Customer Name, Phone (clickable to call), Product Name, EMI # of Total, Amount Due, Address
- Filter by assigned employee
- "Record Payment" button on each card

---

### 4.13 Installment Schedule Detail (`/installments/:scheduleId`)

**Layout**: Top: Sale summary card (customer, product, terms). Below: Payment Timeline visualization. Below that: Installment table.

**Payment Timeline** (`PaymentTimeline`): Visual horizontal or vertical timeline.
- Each node = one installment. Color coded: Green (paid on time), Yellow (paid late), Red (overdue), Blue (upcoming), Gray (rescheduled/split).
- Hover/click on node shows: due date, paid date, amount, payment mode, who collected, notes.
- Rescheduled installments shown as branching lines with notes.

**Installment Table**: Number, Due Date, Amount Due, Amount Paid, Remaining, Status (badge), Payment Date, Mode, Actions.
- Actions: "Record Payment" (opens dialog), "Reschedule" (opens dialog).

**Record Payment Dialog** (`RecordPaymentDialog`):
- Scenario selection: "Full Payment" | "Give New Date" | "Partial + New Date"
- Full Payment: Amount (pre-filled), Payment Mode, Notes. Submit.
- Give New Date: New Date picker. If new_date < next_installment, creates additional record. If new_date > next_installment, shows warning and option to add note. Submit.
- Partial + New Date: Amount Paid (number), Payment Mode, Remaining (auto-calc), New Date for Remainder. Same sub-logic for new date vs next installment. Submit.

---

### 4.14 Transfers (`/transfers`)

**Layout**: "New Transfer" button + table.

**Table**: Transfer#, Product, From Shop, To Shop, Date, Status (badge), Transfer Price, Actions.

**Create Transfer**: Select product (search, must be in_stock at current shop). Select destination shop. Transfer price, GST amount, notes. Submit = status "initiated", product status "transferred".

**Receive**: At destination shop, admin sees incoming transfers. "Receive" button confirms, product now belongs to destination shop with status "in_stock".

---

### 4.15 Expenses (`/expenses`)

**Layout**: "Add Expense" button, date filter, category filter, table.

**Table**: Date, Category (badge), Vendor, Description, Amount, GST, Invoice#, Actions (edit).

**Form**: Date, Category (select from enum), Vendor Name, Description, Amount, GST Amount, Invoice Number, Invoice Upload (file), Is GST Claimable (checkbox). DB-driven via form_definitions.

---

### 4.16 Bank Statements (`/bank`)

**Layout**: Tab for each bank account. Within each tab: Upload button, transaction table, reconciliation panel.

**Upload**: Accepts CSV. Parses columns (date, description, debit, credit, balance). Preview before import.

**Transaction Table**: Date, Description, Reference, Debit, Credit, Balance, Reconciliation Status (badge). Filter by date, status.

**Reconciliation**: Click on unmatched transaction. Side panel shows potential matches (sales, payments, expenses around that date/amount). Click to link. Or "Manual Match" with free-text reference.

---

### 4.17 Settings Pages

**Form Builder** (`/settings/forms`): Admin-only. Lists all form definitions. Click to edit. Field editor: drag-and-drop reorder, add field, edit field properties (label, type, required, validation, options, visibility, conditional display). Live preview.

**Category Manager** (`/settings/categories`): Tree view of categories. Add/edit/delete. For each leaf category, manage dynamic attributes.

---

### 4.18 DashboardLayout (Shared Shell)

**Sidebar** (left, collapsible):
- Logo + App name at top
- Navigation items with icons:
  - Dashboard (chart icon) -- Admin only
  - Products (box icon)
  - Distributors (truck icon)
  - Purchases (receipt icon)
  - Customers (users icon)
  - Sales (shopping-cart icon)
  - Installments (calendar icon) -- Admin, Accountant only
  - Transfers (arrow-right-left icon)
  - Expenses (wallet icon)
  - Bank Statements (building-bank icon)
  - Employees (user-check icon)
  - Settings (gear icon) -- Admin only
- Items hidden based on RBAC (not just disabled -- completely invisible)

**Header** (top):
- Breadcrumbs (left)
- Global Search (center)
- Shop Switcher dropdown (right, only for Admin/Accountant with multiple shops)
- User avatar + dropdown menu (right): Profile, Change Password, Logout

---

## 5. COMPONENT ARCHITECTURE

### Shared/Reusable Components

**`DynamicForm`**: The cornerstone component. Accepts a `formName` prop (e.g., "product", "customer"). Fetches form definition from API. Renders fields dynamically using a field type registry. Handles validation, conditional visibility (`depends_on`), section grouping. Uses React Hook Form under the hood. Supports read-only mode for detail views.

**`DataTable`**: Wrapper around shadcn/ui Table + TanStack Table. Props: columns config, data, pagination state, sort state, onSort, onPageChange, isLoading, emptyState. Handles 20-per-page default. Server-side pagination.

**`CategoryCascader`**: Fetches category tree. Renders cascading dropdowns. On leaf selection, emits category_id and triggers dynamic attribute fetch.

**`DynamicAttributeFields`**: Given a category_id, fetches category_attributes and renders form fields accordingly. Integrates with parent form via React Hook Form context.

**`SearchInput`**: Debounced input (300ms) with loading indicator. Used for global search, customer search, product search.

**`DateRangePicker`**: Two date pickers for from/to. Presets: Today, Last 7 Days, Last 30 Days, This Month, Last Month, Custom.

**`StatusBadge`**: Color-coded badge. Maps status string to variant (success/warning/error/info/default).

**`ConfirmDialog`**: Modal for destructive actions. Title, message, confirm/cancel buttons.

**`FileUpload`**: Drag-and-drop zone + file browser. Accepts image/PDF. Uploads to Azure Blob Storage via presigned URL.

### State Management

- **Server State**: TanStack Query (React Query). All API calls go through custom hooks that wrap `useQuery`/`useMutation`. Caching, refetching, optimistic updates.
- **Auth State**: Zustand store (`auth-store.ts`). Access token in memory (not localStorage), refresh token in httpOnly cookie. Store holds: user, currentShop, permissions.
- **Shop State**: Zustand store (`shop-store.ts`). Current shop selection. Persisted to localStorage for convenience.
- **Form State**: React Hook Form. Ephemeral per-page.
- **No Redux needed**. The combination of TanStack Query (server state) + Zustand (client state) is lighter and sufficient.

### API Layer

- `api-client.ts`: Axios instance with:
  - Base URL from env
  - Request interceptor: attaches Authorization header + X-Shop-Id header
  - Response interceptor: on 401, attempts refresh. On refresh failure, redirects to login.
- Each module has its own API functions file (e.g., `src/api/products.ts`) with typed functions.
- TanStack Query hooks wrap these API functions (e.g., `useProducts`, `useCreateProduct`).

### Mobile Component Architecture

- Expo Router for file-based navigation
- React Native Paper or custom components (no shadcn/ui in RN)
- Same TanStack Query pattern for API calls
- SecureStore for token persistence
- Expo Notifications for push
- Shared types from `packages/shared-types`
- Shared EMI calculator from `packages/shared-utils`

---

## 6. RBAC MATRIX

### Web Application Access Matrix

| Section / Feature | Admin | Accountant | Others | Employee |
|---|---|---|---|---|
| **Login (Web)** | Yes | Yes | Yes | NO (mobile only) |
| **Dashboard** | Full | NO | NO | NO |
| **Products - View** | All | All | All (shop-scoped) | NO |
| **Products - Add/Edit** | Yes | Yes | NO | NO |
| **Products - Sell Item** | Yes | Yes | Yes (creates sanitized) | NO |
| **Product History** | Yes | Yes | Yes | NO |
| **Distributors - View** | Yes | Yes | NO | NO |
| **Distributors - Add/Edit** | Yes | Yes | NO | NO |
| **Purchases - View** | Yes | Yes | NO | NO |
| **Purchases - Create** | Yes | Yes | NO | NO |
| **Customers - View** | Yes | Yes | Yes | NO |
| **Customers - Add** | Yes | Yes | Yes | NO |
| **Customers - Edit** | Yes | Yes | NO | NO |
| **Sales - View** | Real data | Real data | **Sanitized only** | NO |
| **Sales - Create** | Yes | Yes | Yes (creates both records) | NO |
| **Installments - View** | Full | Full | **NEVER** | NO |
| **Installments - Manage** | Full | Full | **NEVER** | NO |
| **Collection List (Web)** | Yes | Yes | NO | NO |
| **Transfers - View** | Yes | Yes | Yes (read-only) | NO |
| **Transfers - Create/Receive** | Yes | NO | NO | NO |
| **Expenses - View** | Yes | Yes | NO | NO |
| **Expenses - Add/Edit** | Yes | Yes | NO | NO |
| **Bank Statements** | Yes | Yes | NO | NO |
| **Employees** | Yes | NO | NO | NO |
| **Settings (Forms, Categories)** | Yes | NO | NO | NO |
| **User Management** | Yes | NO | NO | NO |
| **Shop Switching** | Yes | Yes | NO | NO |

### Mobile Application Access Matrix

| Feature | Employee | Admin | Accountant | Others |
|---|---|---|---|---|
| **Login (Mobile)** | Yes | Yes* | Yes* | NO |
| **Today's Collections** | Yes (assigned only) | Yes (all) | Yes (all) | NO |
| **Sale Detail + Timeline** | Yes | Yes | Yes | NO |
| **Record Payment** | Yes | Yes | Yes | NO |
| **Push Notifications** | Yes | Yes | Yes | NO |

*Admin/Accountant CAN use mobile app for field collection purposes, but primary interface is web.

### Data Isolation Rules

1. **Others role** API endpoints for `/sales` and `/sales/:id` return data from `sale_records_sanitized` table. The real `sale_records` table is never queried for this role.
2. **Others role** sidebar does not render "Installments" link. Routes are also server-guarded.
3. **Others role** product "Sell Item" action creates the sale, but the service layer automatically creates the sanitized record. The "Others" user never sees installment fields in the sale form -- the sale form conditionally hides installment options based on role.
4. **Employee role** cannot access web app at all. JWT contains `is_mobile_only: true`. Web app checks this on token decode and shows "Access Denied -- Please use the mobile app."
5. All shop-scoped data enforced at middleware level. A user's token contains their `shop_id`. All Prisma queries include `WHERE shop_id = ?` via the `shop-scope` middleware that injects the filter.

### Implementation Notes for RBAC

The `rbac.ts` middleware takes a configuration object:

```typescript
// Usage in routes:
router.get('/dashboard/sales-graph', 
  authenticate, 
  authorize(['admin']), 
  shopScope, 
  dashboardController.salesGraph
);

router.get('/sales', 
  authenticate, 
  authorize(['admin', 'accountant', 'others']), 
  shopScope, 
  salesController.list  // Service checks role to decide real vs sanitized
);
```

The `authorize` middleware checks `req.user.role` against the allowed array. The `shopScope` middleware adds `shop_id` to `req.shopFilter` which services use in queries.

For the "Others" role sale creation, the `sales.service.ts` `createSale` method ALWAYS writes both `sale_records` and `sale_records_sanitized`, regardless of which user creates it. But the sale form shown to "Others" only presents "Full Payment" and "Partial with Promise" options -- installment options are hidden. However, the dual-write still happens because Admin/Accountant sales also need sanitized records.

**Critical security boundary**: The decision of which table to read from is made in the service layer, NOT the controller or frontend. The frontend sends the same API call; the backend returns different data based on the authenticated user's role. This prevents any client-side tampering from exposing installment data to "Others" users.

---

## 7. PHASED IMPLEMENTATION ROADMAP

### Phase 0: Project Scaffolding (Days 1-3)

**Goal**: Fully configured monorepo with all tooling, empty apps that build and run.

- Initialize Turborepo monorepo with `apps/api`, `apps/web`, `apps/mobile`, `packages/shared-types`, `packages/shared-utils`, `packages/eslint-config`
- Configure TypeScript (base tsconfig, per-app tsconfigs)
- Set up ESLint + Prettier across the monorepo
- Set up apps/api: Fastify (recommended over Express for performance + built-in schema validation), Prisma, environment config
- Set up apps/web: Vite + React 19 + TailwindCSS + shadcn/ui initialization
- Set up apps/mobile: Expo SDK 52+ with Expo Router
- Docker compose for local PostgreSQL
- Prisma schema with all tables (full schema from Section 1)
- Run initial migration
- Seed script structure (empty seed files)
- CI pipeline skeleton (lint + typecheck + build)

**Deliverables**: `turbo dev` starts all three apps. Prisma migration creates all tables. DB is empty but schema is complete.

---

### Phase 1: Authentication & Multi-Tenancy Foundation (Days 4-8)

**Goal**: Users can log in, select shops, and the RBAC + shop-scoping middleware works end-to-end.

**Backend**:
- Seed the 4 shops and initial users (2 admin + 3 accountant + 2 others + 3 employee per shop)
- Auth module: login, logout, refresh, me, change-password, switch-shop
- JWT generation (access token 15min, refresh token 7days)
- Middleware stack: authenticate -> authorize -> shopScope
- User CRUD API
- Shop listing API (for login page)

**Frontend Web**:
- Login page with shop selector
- AuthLayout and DashboardLayout shells
- Sidebar navigation with role-based visibility
- Header with shop switcher and user menu
- Protected route wrapper
- Role guard component
- Auth store (Zustand) + API client with interceptors

**Deliverables**: Full login flow. Role-based navigation. Shop switching for admins. Token refresh working.

---

### Phase 2: Product Management (Days 9-16)

**Goal**: Full product lifecycle: categories, dynamic attributes, CRUD, search, history.

**Backend**:
- Product categories CRUD with hierarchy (tree operations)
- Category attributes CRUD
- Products CRUD with dynamic attribute validation
- Product search (category-first + global)
- Product audit trail service
- Seed: categories (TV, Mobile, AC, Refrigerator, Washing Machine, Furniture with L2 subcategories), category attributes, 20 sample products

**Frontend Web**:
- CategoryCascader component
- DynamicAttributeFields component
- Product list page with search + filters + paginated table
- Product add/edit form with cascading categories and dynamic fields
- Product detail page with timeline
- Global search in header

**Deliverables**: Can create categories, add products with dynamic attributes, search and filter, view audit trail.

---

### Phase 3: Distributor & Purchase Management (Days 17-22)

**Goal**: Distributors onboarded, purchases recorded, payment tracking.

**Backend**:
- Distributor CRUD with aggregated columns (computed on query)
- Purchase CRUD with nested product creation
- Purchase payment recording
- Seed: 5 distributors with varied categories

**Frontend Web**:
- Distributor list + detail pages
- Distributor form (DB-driven)
- Purchase creation wizard (multi-step form)
- Purchase payment tracker
- Distributor detail with tabbed view (products, payments, pending)

**Deliverables**: Full purchase flow from distributor onboarding to invoice recording to payment.

---

### Phase 4: Customer & Sale Management (Days 23-33)

**Goal**: Customers, all sale types, dual recording, sanitized views.

**Backend**:
- Customer CRUD with auto-generated customer_code
- Sale creation service with ALL four sale types
- Dual write: sale_records + sale_records_sanitized (transactional)
- EMI calculation logic (shared-utils)
- Installment schedule + installment generation for self-finance
- Company finance tracking
- Guarantor linking
- Role-based sale retrieval (real vs sanitized)
- Seed: 5 customers, sample sales of each type

**Frontend Web**:
- Customer list + search + detail pages
- Customer form (DB-driven)
- Sale creation page with all four modes
- InstallmentCalculator with real-time EMI preview
- EMISchedulePreview table
- GuarantorSection (reuses customer form)
- CompanyFinanceSection
- Sale list page (role-aware)
- Sale detail page (role-aware)

**Deliverables**: Complete sale flow for all types. "Others" role sees only sanitized data. Installment schedules created automatically.

---

### Phase 5: Installment Management (Days 34-42)

**Goal**: Full installment lifecycle, payment recording with all scenarios, collection lists, timeline.

**Backend**:
- Installment payment recording (full/reschedule/partial+reschedule)
- Rescheduling logic with date comparisons and record creation
- Daily collection list generation (query installments due on date, join with customer + product + sale)
- Employee assignment to collections
- Timeline data aggregation
- Overdue detection (cron job or on-demand query)

**Frontend Web**:
- Installment list page (tabs: active, overdue, completed, today's collections)
- Installment schedule detail page with PaymentTimeline
- RecordPaymentDialog with all three scenarios
- RescheduleDialog
- CollectionDayList (card-style list)

**Deliverables**: Can record payments in all three scenarios. Rescheduling works correctly. Timeline visualization. Collection list for any date.

---

### Phase 6: Inter-Shop Transfers (Days 43-46)

**Goal**: Transfer products between shops with full audit trail.

**Backend**:
- Transfer initiation (validates product is in_stock at source shop)
- Transfer receiving (updates product.shop_id, status back to in_stock)
- Transfer cancellation
- Audit trail entries for transfers
- GST implications data capture (transfer price, GST amount)

**Frontend Web**:
- Transfer list page
- Transfer creation form
- Incoming transfers view (for destination shop)
- Transfer detail with timeline integration in product history

**Deliverables**: Products can move between shops. Full audit trail. GST-compliant transfer records.

---

### Phase 7: Expenses & Bank Statements (Days 47-53)

**Goal**: Expense recording, bank statement upload and reconciliation.

**Backend**:
- Expense CRUD
- Bank account CRUD
- Bank transaction CRUD + CSV upload parsing
- Reconciliation matching engine (auto-suggest based on amount + date proximity)
- Manual reconciliation

**Frontend Web**:
- Expense list + form pages
- Bank accounts page (tab per account)
- Transaction table with filters
- CSV upload dialog with preview
- Reconciliation panel (side panel on transaction click showing potential matches)

**Deliverables**: Expenses tracked for GST claims. Bank statements uploaded. Basic reconciliation working.

---

### Phase 8: Dashboard & Reporting (Days 54-58)

**Goal**: Admin dashboard with all four visualizations plus summary cards.

**Backend**:
- Dashboard aggregation queries (optimized with date-range indexes)
- Sales graph data (daily aggregated totals)
- Top products query (GROUP BY product, COUNT, ORDER BY)
- YoY comparison query (same period last year)
- Overdue installments query

**Frontend Web**:
- Dashboard page with Recharts integration
- SalesChart (line/bar toggle, date range picker)
- TopProductsCard (horizontal bar)
- YoYComparison (grouped bar chart)
- OverdueInstallments table
- Summary cards with sparklines

**Deliverables**: Admin dashboard fully functional with real data.

---

### Phase 9: DB-Driven Dynamic Forms & Settings (Days 59-64)

**Goal**: Form builder UI, category manager, all forms reading from DB.

**Backend**:
- Form definitions CRUD
- Form fields CRUD with reordering
- Seed: default form definitions for product, customer, distributor, sale forms

**Frontend Web**:
- DynamicForm component (the big one -- renders any form from definition)
- Migrate product/customer/distributor forms to use DynamicForm
- Form builder page (admin settings)
- FormFieldEditor (inline editing of field properties)
- Category manager with tree view

**Deliverables**: Forms are truly DB-driven. Admin can modify form fields without code changes.

---

### Phase 10: Mobile App (Days 65-75)

**Goal**: Employee mobile app with login, collection list, payment recording, push notifications.

**Mobile App**:
- Login screen with shop selector
- Today's collections screen (list of installments due, filterable by date)
- Sale detail screen (view sale + installment timeline)
- Record payment screen (full/reschedule/partial+reschedule)
- Push notification setup (Expo Notifications)
- Pull-to-refresh, offline indicator
- Biometric auth (optional, Expo SecureStore + LocalAuthentication)

**Backend**:
- Push notification token registration
- Daily morning notification job (sends collection count to employees)
- Mobile-specific API optimizations (lighter payloads)

**Deliverables**: Employee mobile app fully functional for daily collections.

---

### Phase 11: Employee Section & Polishing (Days 76-80)

**Goal**: Employee CRUD, system-wide polish, edge case handling.

**Backend**:
- Employee CRUD (basic, placeholder for future expansion)
- Audit log viewing API

**Frontend Web**:
- Employee list + form pages
- System-wide: loading states, error boundaries, empty states, toast notifications
- Accessibility pass (keyboard nav, ARIA labels)
- Responsive design pass (tablets)

**Deliverables**: Employee section live. All pages polished.

---

### Phase 12: Testing, Security & Deployment (Days 81-90)

**Goal**: Production-ready deployment on Azure.

- Unit tests for critical services (EMI calculator, sanitized sale logic, RBAC)
- Integration tests for API endpoints (Vitest + Supertest)
- E2E tests for critical flows (Playwright): login, create sale, record payment
- Security hardening: rate limiting, input sanitization, SQL injection prevention (Prisma handles), XSS headers, CORS config, Aadhaar encryption at rest
- Azure deployment (see Section 8)
- Environment configuration (production secrets in Azure Key Vault)
- Database backups (Azure PG auto-backup)
- Monitoring (Application Insights)

**Deliverables**: Production deployment on Azure. All critical paths tested. Monitoring in place.

---

## 8. DEPLOYMENT ARCHITECTURE ON AZURE

### Architecture Diagram (Text)

```
                    ┌─────────────────────┐
                    │   Azure Front Door   │  (Optional, for custom domain + SSL)
                    │   or direct access   │
                    └──────┬──────────────┘
                           │
              ┌────────────┴────────────┐
              │                         │
    ┌─────────▼─────────┐   ┌──────────▼──────────┐
    │ Azure Static Web  │   │  Azure App Service   │
    │ Apps (Free tier)  │   │  (B1 Basic tier)     │
    │                   │   │                      │
    │ React Web App     │   │  Node.js API         │
    │ (Built by Vite,   │   │  (Fastify + Prisma)  │
    │  served as static │   │                      │
    │  SPA)             │   │  Custom domain + SSL │
    └───────────────────┘   └──────────┬───────────┘
                                       │
                           ┌───────────┴───────────┐
                           │                       │
              ┌────────────▼──────────┐ ┌─────────▼──────────┐
              │  Azure Database for   │ │  Azure Blob Storage │
              │  PostgreSQL           │ │  (Hot tier)         │
              │  Flexible Server      │ │                     │
              │  (Burstable B1ms)     │ │  - Photo IDs        │
              │                       │ │  - Invoice scans    │
              │  1 vCore, 2GB RAM     │ │  - Bank statements  │
              │  32GB storage         │ │                     │
              └───────────────────────┘ └─────────────────────┘
                                       
              ┌───────────────────────┐
              │  Expo Application     │
              │  Services (EAS)       │
              │                       │
              │  Build + OTA updates  │
              │  for React Native app │
              │  (Free tier for small │
              │  teams)               │
              └───────────────────────┘
```

### Cost Estimates (Monthly, INR approximate at 83 INR/USD)

| Service | Tier | Monthly Cost (USD) | Monthly Cost (INR) | Notes |
|---------|------|-------------------|--------------------| ------|
| Azure Static Web Apps | Free | $0 | 0 | 100GB bandwidth/mo, custom domain, SSL |
| Azure App Service | B1 Basic | ~$13 | ~1,080 | 1 core, 1.75GB RAM. Sufficient for 4-shop ERP. |
| Azure Database for PostgreSQL Flexible Server | Burstable B1ms | ~$12.50 | ~1,040 | 1 vCore, 2GB RAM, 32GB storage. Can stop when not in use. |
| Azure Blob Storage | Hot tier | ~$1-2 | ~80-160 | For photo IDs, invoices. Minimal storage needs. |
| **Total** | | **~$27/mo** | **~2,250/mo** | |

**With Azure free credits**: If you have $200/month free credits, this runs entirely within free tier for many months.

### Cost Optimization Strategies

1. **PostgreSQL auto-stop**: Enable auto-pause when idle (if using dev/test, saves ~50% on DB costs during non-business hours). For production, keep running.
2. **App Service scaling**: B1 is fine for 4 shops, ~20 users. If load increases, scale to B2 ($26/mo).
3. **Static Web Apps**: Free tier is genuinely free and includes CI/CD from GitHub.
4. **Blob Storage**: Use lifecycle management to move old invoice scans to Cool tier after 90 days.
5. **No separate Redis needed**: For 20 concurrent users, in-memory rate limiting and JWT validation is sufficient. Add Azure Cache for Redis ($15/mo) only if scaling beyond this.
6. **Alternative**: Azure Container Apps (consumption plan) instead of App Service -- pay per request, could be cheaper for low-traffic periods. But App Service is simpler to manage.

### CI/CD Pipeline

- GitHub Actions (free for public repos, 2000 min/mo for private)
- On push to `main`:
  1. `turbo lint` + `turbo typecheck` + `turbo test`
  2. `turbo build` (builds all apps)
  3. Deploy `apps/web/dist` to Azure Static Web Apps
  4. Deploy `apps/api` to Azure App Service (via ZIP deploy or Docker)
  5. Run `prisma migrate deploy` against production DB

---

## 9. SEED SCRIPT PLAN

The seed scripts in `apps/api/prisma/seed/` execute in dependency order via the main `index.ts` runner:

### Execution Order and Content

**1. `shops.seed.ts`** -- 4 shops

| Shop | Code | GST (sample) | City |
|------|------|--------------|------|
| Vinod Electronics | VE | 09AXXXX1234A1Z5 | (User's city) |
| Naveen Electronics | NE | 09AXXXX5678B1Z3 | (User's city) |
| Vinod Home Appliances | VHA | 09AXXXX9012C1Z1 | (User's city) |
| New Harshita Electronics | NHE | 09AXXXX3456D1Z9 | (User's city) |

Each with full address, bank details (fictional), phone, email.

**2. `users.seed.ts`** -- Per shop: 2 Admin, 3 Accountant, 2 Others, 3 Employee (mobile-only)

Sample for Vinod Electronics:
- vinod_admin (Admin), vinod_admin2 (Admin)
- vinod_acc1, vinod_acc2, vinod_acc3 (Accountant)
- vinod_staff1, vinod_staff2 (Others)
- vinod_emp1, vinod_emp2, vinod_emp3 (Employee, is_mobile_only=true)

Passwords: All set to "RetailERP@2026" (bcrypt hashed). Document this in README.

**3. `categories.seed.ts`** -- Full hierarchy

```
Root
├── TV
│   ├── LED TV
│   ├── OLED TV
│   ├── QLED TV
│   └── Plasma TV
├── Mobile
│   ├── Smartphone
│   └── Feature Phone
├── Washing Machine
│   ├── Top Load
│   ├── Front Load
│   └── Semi Automatic
├── AC
│   ├── Window AC
│   ├── Split AC
│   └── Tower AC
├── Refrigerator
│   ├── Single Door
│   ├── Double Door
│   └── Side by Side
├── Furniture
│   ├── Sofa
│   ├── Bed
│   ├── Dining Table
│   └── Wardrobe
└── Small Appliances
    ├── Mixer Grinder
    ├── Water Purifier
    └── Iron
```

Category attributes seeded per leaf (e.g., Smartphone gets IMEI, IMEI2, RAM, Storage, OS; Split AC gets Tonnage, Star Rating, Inverter; LED TV gets Screen Size, Resolution, Smart TV, HDMI Ports).

**4. `finance-companies.seed.ts`** -- 3 companies

- Bajaj Finance (code: BAJAJ)
- HDB Financial Services (code: HDB)
- Home Credit (code: HOMECREDIT)

**5. `distributors.seed.ts`** -- 5 distributors

| Distributor | Supplies | City |
|-------------|----------|------|
| Samsung India Electronics | TV, Mobile, AC, Refrigerator, Washing Machine | Delhi |
| LG Electronics India | TV, AC, Refrigerator, Washing Machine | Mumbai |
| Xiaomi Technology India | Mobile, TV | Bangalore |
| Godrej Interio | Furniture | Mumbai |
| Whirlpool India | Washing Machine, Refrigerator, AC | Pune |

Each with full GST, PAN, bank details, contact info, payment terms, credit limit.

**6. `products.seed.ts`** -- 20 products across shops and categories

5 products per shop. Mix of categories:
- VE: 2 TVs, 1 Mobile, 1 AC, 1 Washing Machine
- NE: 2 Mobiles, 1 TV, 1 Refrigerator, 1 Furniture
- VHA: 2 Furniture, 1 AC, 1 Refrigerator, 1 Washing Machine
- NHE: 2 TVs, 1 Mobile, 1 AC, 1 Small Appliance

Each with realistic brand/model (Samsung 55" QLED, iPhone 15, LG 1.5T Split AC, Godrej Sofa, etc.), MRP, selling price, purchase price, serial numbers, dynamic attributes filled.

**7. `customers.seed.ts`** -- 5 customers + 2 guarantors

| Customer | Phone | Aadhaar (sample) | Shop |
|----------|-------|-------------------|------|
| Rajesh Kumar | 9876543210 | 1234-5678-9012 | VE |
| Priya Sharma | 9876543211 | 2345-6789-0123 | NE |
| Amit Verma | 9876543212 | 3456-7890-1234 | VHA |
| Sunita Devi | 9876543213 | 4567-8901-2345 | NHE |
| Mohit Singh | 9876543214 | 5678-9012-3456 | VE |
| Ravi Guarantor1 (guarantor) | 9876543215 | 6789-0123-4567 | VE |
| Suresh Guarantor2 (guarantor) | 9876543216 | 7890-1234-5678 | NE |

**8. `sales.seed.ts`** -- 5 sample sales (one of each type + a duplicate)

1. **Full Payment sale** (VE): Rajesh buys Samsung TV, full cash payment.
2. **Partial with Promise** (NE): Priya buys iPhone, 50% down, promise date in 15 days.
3. **Self Finance** (VHA): Amit buys Godrej Sofa, 20% down, 2% interest, 12 months, file charge 500. Guarantor: Suresh.
4. **Company Finance** (NHE): Sunita buys LG AC via Bajaj Finance, 10% down, financed amount, expected payment tomorrow.
5. **Self Finance** (VE): Mohit buys Samsung Mobile, 30% down, 1.5% interest, 6 months. Guarantor: Ravi.

Each sale also creates the sanitized record.

**9. `installments.seed.ts`** -- Schedules for sales #3 and #5

For Amit's 12-month schedule: Generate 12 installment records. Mark first 2 as "paid" (with payment records), 3rd as "overdue", rest as "upcoming". Include one rescheduled installment example.

For Mohit's 6-month schedule: Generate 6 installment records. Mark first as "paid", 2nd as "partially_paid" with a reschedule, rest as "upcoming".

**10. `form-definitions.seed.ts`** -- Default form definitions

- Product form: All common fields + dynamic section placeholder
- Customer form: name, phone, alt_phone, aadhaar, address fields, photo_id
- Distributor form: company_name through credit_limit
- Sale form: All sale fields with conditional visibility rules

Each form definition has versioned fields with display_order, section_name groupings, validation rules, and conditional dependencies (e.g., "interest_rate" field depends_on sale_type being "self_finance").

---

## 10. UI/UX IMPROVEMENT SUGGESTIONS BEYOND STATED REQUIREMENTS

### 1. Quick Actions / Command Palette

Add a keyboard shortcut (Ctrl+K) that opens a command palette (similar to VS Code). Commands: "New Sale", "Add Product", "Search Customer", "Switch to Vinod Electronics", etc. For power users managing multiple shops, this drastically reduces click-through.

### 2. Receipt / Invoice PDF Generation

After each sale, auto-generate a printable PDF receipt/invoice. Use `@react-pdf/renderer` or server-side PDF generation. Include shop logo, GST details, product info, payment terms. For installment sales (admin view), optionally generate an installment agreement PDF with guarantor signature lines.

### 3. Bulk Operations

- **Bulk product import**: CSV upload for products (useful when receiving large shipments).
- **Bulk transfer**: Select multiple products, transfer to another shop in one operation.
- **Bulk expense import**: CSV upload for multiple expense entries.

### 4. Notifications Center (Web)

A bell icon in the header with a notification dropdown. Notifications for:
- Overdue installments (daily, for admins)
- Company finance payment not received past expected date
- Low stock alerts (configurable threshold per category)
- Transfer pending receipt at destination shop

### 5. Customer Communication

- **WhatsApp Integration**: "Send Reminder" button on overdue installments that opens WhatsApp web with a pre-filled payment reminder message. Use `https://wa.me/{phone}?text={encoded_message}`. Zero-cost, very effective in Indian retail.
- **SMS Templates**: Optional Twilio/MSG91 integration for automated payment reminders.

### 6. Offline Support for Mobile

Service worker on web (limited), and SQLite/WatermelonDB on mobile for offline-first collection recording. Sync when back online. Employees in field may have spotty connectivity.

### 7. Data Export

Every table should have an "Export to Excel" button. Use `xlsx` library. For compliance and tax filing purposes, export sales data in a format compatible with GST filing requirements (GSTR-1 format).

### 8. Dashboard Drill-Down

Charts should be interactive. Click on a bar in the sales graph to drill down to individual sales for that day. Click on a product in top-10 to see all sales of that product. Click on an overdue installment to go directly to the schedule.

### 9. Keyboard Shortcuts Throughout

- `N` then `P` = New Product, `N` then `S` = New Sale (with the command palette)
- `Esc` to close modals/dialogs
- Arrow keys in tables for row navigation
- `Enter` to open selected row

### 10. Duplicate Detection

When entering a customer phone number, auto-detect if a customer with that phone exists across any shop. Show a warning: "Customer 'Rajesh Kumar' already exists at Vinod Electronics. Link this sale to existing customer?" Prevents duplicate customer records.

### 11. Activity Feed

A real-time (or near-real-time via polling) activity feed on the dashboard showing recent actions: "Priya Sharma created a sale at Naveen Electronics", "Amit Verma's EMI #3 was collected by vinod_emp1". Useful for admins monitoring multiple shops.

### 12. Dark Mode

TailwindCSS + shadcn/ui support dark mode natively. Add a theme toggle in user preferences. Useful for evening/night work.

### 13. Multi-Currency Display Improvements

All currency values should use the Indian number system formatting (12,34,567.00 not 1,234,567.00). Use `Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })` consistently everywhere via the `formatters.ts` utility.

### 14. Product Photo Gallery

Allow uploading 1-3 photos per product (stored in Blob Storage). Displayed in product detail page as a small gallery. Helpful for expensive items like furniture where visual identification matters.

### 15. Installment Calendar View

In addition to the table/timeline views, offer a calendar month view where each day shows which customers have EMIs due. Color-coded: green (paid), red (overdue), blue (upcoming). Drag-and-drop reschedule would be a future enhancement.

### 16. Smart Defaults Based on History

When creating a sale, if the customer has previous purchases, pre-fill common patterns: "This customer's last 3 purchases were self-finance with 2% interest, 12 months." Suggest same terms. Reduces data entry time.

### 17. Role-Specific Home Pages

Instead of redirecting everyone to Dashboard/Products after login:
- **Admin**: Dashboard (as designed)
- **Accountant**: Sales list for today (most common task)
- **Others**: Products list (their primary use case)
- **Employee (mobile)**: Today's collection list (the only thing they need)

### 18. Progressive Disclosure in Sale Form

The sale form is complex. Use progressive disclosure: start with just product + customer. Then reveal payment section. Then, based on sale type selection, reveal only the relevant sub-section with a smooth animation. Collapse irrelevant sections. This prevents form overwhelm.

---

### Critical Files for Implementation

- `C:\Users\vinodsharma\personal_workspace\retail-erp\apps\api\prisma\schema.prisma` -- The Prisma schema file that defines the entire database, all 25+ models, relationships, enums, and indexes. This is the foundational artifact from which everything else is generated.
- `C:\Users\vinodsharma\personal_workspace\retail-erp\apps\api\src\modules\sales\sales.service.ts` -- The sale creation service that implements dual-write (real + sanitized), all four sale types, EMI schedule generation, guarantor linking, and role-based data retrieval. This is the most complex business logic file.
- `C:\Users\vinodsharma\personal_workspace\retail-erp\apps\api\src\middleware\rbac.ts` -- The RBAC middleware that enforces role-based access and, critically, the data isolation between real and sanitized sale records for the "Others" role.
- `C:\Users\vinodsharma\personal_workspace\retail-erp\apps\web\src\components\DynamicForm.tsx` -- The dynamic form renderer that reads form definitions from the API and generates complete forms with validation, conditional fields, and section grouping. Used by product, customer, distributor, and sale forms.
- `C:\Users\vinodsharma\personal_workspace\retail-erp\apps\api\src\modules\installments\installments.service.ts` -- The installment management service handling the three payment scenarios (full, reschedule, partial+reschedule), date comparison logic, collection list generation, and timeline data aggregation.