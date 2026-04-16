-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'accountant', 'others', 'employee');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('in_stock', 'sold', 'transferred', 'returned', 'damaged');

-- CreateEnum
CREATE TYPE "SaleType" AS ENUM ('full_payment', 'partial_with_promise', 'self_finance', 'company_finance');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('cash', 'credit_card', 'debit_card', 'upi', 'bank_transfer', 'cheque');

-- CreateEnum
CREATE TYPE "InstallmentStatus" AS ENUM ('upcoming', 'due_today', 'paid', 'partially_paid', 'overdue', 'rescheduled');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('initiated', 'in_transit', 'received', 'cancelled');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('rent', 'electricity', 'salary', 'transport', 'maintenance', 'marketing', 'purchase', 'misc');

-- CreateEnum
CREATE TYPE "FinancePaymentStatus" AS ENUM ('pending', 'received', 'overdue', 'partial');

-- CreateEnum
CREATE TYPE "FormFieldType" AS ENUM ('text', 'number', 'select', 'multi_select', 'date', 'tel', 'email', 'textarea', 'checkbox', 'radio', 'file', 'hidden');

-- CreateEnum
CREATE TYPE "BankTxnType" AS ENUM ('credit', 'debit');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('unmatched', 'matched', 'manual_match', 'disputed');

-- CreateTable
CREATE TABLE "shops" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "gst_number" VARCHAR(15) NOT NULL,
    "pan_number" VARCHAR(10) NOT NULL,
    "address_line1" VARCHAR(255) NOT NULL,
    "address_line2" VARCHAR(255),
    "city" VARCHAR(100) NOT NULL,
    "state" VARCHAR(100) NOT NULL,
    "pincode" VARCHAR(6) NOT NULL,
    "phone" VARCHAR(15) NOT NULL,
    "email" VARCHAR(255),
    "bank_name" VARCHAR(200),
    "bank_account_number" VARCHAR(20),
    "bank_ifsc" VARCHAR(11),
    "bank_branch" VARCHAR(200),
    "logo_url" VARCHAR(500),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" VARCHAR(100) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "full_name" VARCHAR(200) NOT NULL,
    "email" VARCHAR(255),
    "phone" VARCHAR(15) NOT NULL,
    "role" "UserRole" NOT NULL,
    "is_mobile_only" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_shops" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_shops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "device_info" VARCHAR(500),
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_categories" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "slug" VARCHAR(200) NOT NULL,
    "parent_id" TEXT,
    "level" INTEGER NOT NULL DEFAULT 0,
    "path" VARCHAR(1000) NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_leaf" BOOLEAN NOT NULL DEFAULT false,
    "icon" VARCHAR(100),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_attributes" (
    "id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "attribute_name" VARCHAR(100) NOT NULL,
    "attribute_label" VARCHAR(200) NOT NULL,
    "attribute_type" "FormFieldType" NOT NULL,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "validation_rules" JSONB,
    "options" JSONB,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "category_attributes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "brand" VARCHAR(200) NOT NULL,
    "model_number" VARCHAR(200) NOT NULL,
    "serial_number" VARCHAR(200),
    "mrp" DECIMAL(12,2) NOT NULL,
    "selling_price" DECIMAL(12,2) NOT NULL,
    "purchase_price" DECIMAL(12,2) NOT NULL,
    "color" VARCHAR(50),
    "weight_kg" DECIMAL(8,2),
    "distributor_id" TEXT,
    "purchase_id" TEXT,
    "status" "ProductStatus" NOT NULL DEFAULT 'in_stock',
    "dynamic_attributes" JSONB NOT NULL DEFAULT '{}',
    "warranty_months" INTEGER,
    "warranty_expiry" DATE,
    "barcode" VARCHAR(100),
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_audit_trail" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "event_type" VARCHAR(50) NOT NULL,
    "from_shop_id" TEXT,
    "to_shop_id" TEXT,
    "reference_id" TEXT,
    "reference_type" VARCHAR(50),
    "notes" TEXT,
    "performed_by" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_audit_trail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "distributors" (
    "id" TEXT NOT NULL,
    "company_name" VARCHAR(300) NOT NULL,
    "contact_person" VARCHAR(200) NOT NULL,
    "phone" VARCHAR(15) NOT NULL,
    "alt_phone" VARCHAR(15),
    "email" VARCHAR(255),
    "gst_number" VARCHAR(15),
    "pan_number" VARCHAR(10),
    "address_line1" VARCHAR(255) NOT NULL,
    "address_line2" VARCHAR(255),
    "city" VARCHAR(100) NOT NULL,
    "state" VARCHAR(100) NOT NULL,
    "pincode" VARCHAR(6) NOT NULL,
    "bank_name" VARCHAR(200),
    "bank_account_number" VARCHAR(20),
    "bank_ifsc" VARCHAR(11),
    "bank_branch" VARCHAR(200),
    "payment_terms" VARCHAR(500),
    "credit_limit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "dynamic_attributes" JSONB NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "distributors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "distributor_categories" (
    "id" TEXT NOT NULL,
    "distributor_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,

    CONSTRAINT "distributor_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchases" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "distributor_id" TEXT NOT NULL,
    "invoice_number" VARCHAR(100) NOT NULL,
    "invoice_date" DATE NOT NULL,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "gst_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "net_amount" DECIMAL(12,2) NOT NULL,
    "amount_paid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "payment_status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_payments" (
    "id" TEXT NOT NULL,
    "purchase_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "payment_mode" "PaymentMode" NOT NULL,
    "payment_date" DATE NOT NULL,
    "reference_number" VARCHAR(100),
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "customer_code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "phone" VARCHAR(15) NOT NULL,
    "alt_phone" VARCHAR(15),
    "aadhaar_number" VARCHAR(12),
    "address_line1" VARCHAR(255),
    "address_line2" VARCHAR(255),
    "city" VARCHAR(100),
    "state" VARCHAR(100),
    "pincode" VARCHAR(6),
    "photo_id_url" VARCHAR(500),
    "is_guarantor" BOOLEAN NOT NULL DEFAULT false,
    "guarantor_id" TEXT,
    "dynamic_attributes" JSONB NOT NULL DEFAULT '{}',
    "shop_id" TEXT NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_companies" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "contact_phone" VARCHAR(15),
    "contact_email" VARCHAR(255),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_records" (
    "id" TEXT NOT NULL,
    "sale_number" VARCHAR(30) NOT NULL,
    "ledger_number" VARCHAR(50) NOT NULL,
    "shop_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "sale_date" DATE NOT NULL,
    "sale_type" "SaleType" NOT NULL,
    "mrp" DECIMAL(12,2) NOT NULL,
    "selling_price" DECIMAL(12,2) NOT NULL,
    "discount_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "net_amount" DECIMAL(12,2) NOT NULL,
    "gst_rate" DECIMAL(4,2) NOT NULL DEFAULT 0,
    "gst_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "down_payment" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "payment_mode" "PaymentMode" NOT NULL,
    "promise_date" DATE,
    "pending_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "interest_rate" DECIMAL(4,2),
    "file_charge" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_financed_amount" DECIMAL(12,2),
    "num_installments" INTEGER,
    "emi_amount" DECIMAL(12,2),
    "guarantor_id" TEXT,
    "finance_company_id" TEXT,
    "financed_amount" DECIMAL(12,2),
    "expected_payment_date" DATE,
    "finance_payment_status" "FinancePaymentStatus",
    "finance_payment_received_date" DATE,
    "finance_reference_number" VARCHAR(100),
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_records_sanitized" (
    "id" TEXT NOT NULL,
    "sale_number" VARCHAR(30) NOT NULL,
    "ledger_number" VARCHAR(50) NOT NULL,
    "shop_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "sale_date" DATE NOT NULL,
    "sale_type" VARCHAR(20) NOT NULL DEFAULT 'full_payment',
    "selling_price" DECIMAL(12,2) NOT NULL,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "payment_mode" VARCHAR(20) NOT NULL DEFAULT 'cash',
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_records_sanitized_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installment_schedules" (
    "id" TEXT NOT NULL,
    "sale_id" TEXT NOT NULL,
    "total_principal" DECIMAL(12,2) NOT NULL,
    "total_interest" DECIMAL(12,2) NOT NULL,
    "file_charge" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_payable" DECIMAL(12,2) NOT NULL,
    "num_installments" INTEGER NOT NULL,
    "emi_amount" DECIMAL(12,2) NOT NULL,
    "start_date" DATE NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "installment_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installments" (
    "id" TEXT NOT NULL,
    "schedule_id" TEXT NOT NULL,
    "installment_number" INTEGER NOT NULL,
    "due_date" DATE NOT NULL,
    "amount_due" DECIMAL(12,2) NOT NULL,
    "amount_paid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "remaining_amount" DECIMAL(12,2) NOT NULL,
    "status" "InstallmentStatus" NOT NULL DEFAULT 'upcoming',
    "is_rescheduled" BOOLEAN NOT NULL DEFAULT false,
    "rescheduled_from_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installment_payments" (
    "id" TEXT NOT NULL,
    "installment_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "payment_mode" "PaymentMode" NOT NULL,
    "payment_date" DATE NOT NULL,
    "collected_by" TEXT,
    "reference_number" VARCHAR(100),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "installment_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_collection_assignments" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "schedule_id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_collection_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inter_shop_transfers" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "from_shop_id" TEXT NOT NULL,
    "to_shop_id" TEXT NOT NULL,
    "transfer_date" DATE NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'initiated',
    "transfer_price" DECIMAL(12,2),
    "gst_amount" DECIMAL(12,2),
    "invoice_number" VARCHAR(100),
    "notes" TEXT,
    "initiated_by" TEXT NOT NULL,
    "received_by" TEXT,
    "received_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inter_shop_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "expense_date" DATE NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "vendor_name" VARCHAR(200),
    "description" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "gst_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "invoice_number" VARCHAR(100),
    "invoice_url" VARCHAR(500),
    "is_gst_claimable" BOOLEAN NOT NULL DEFAULT false,
    "created_by" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "bank_name" VARCHAR(200) NOT NULL,
    "account_number" VARCHAR(20) NOT NULL,
    "ifsc_code" VARCHAR(11) NOT NULL,
    "account_type" VARCHAR(20) NOT NULL DEFAULT 'current',
    "opening_balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_transactions" (
    "id" TEXT NOT NULL,
    "bank_account_id" TEXT NOT NULL,
    "transaction_date" DATE NOT NULL,
    "value_date" DATE,
    "description" VARCHAR(500),
    "reference_number" VARCHAR(100),
    "txn_type" "BankTxnType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "balance" DECIMAL(14,2),
    "reconciliation_status" "ReconciliationStatus" NOT NULL DEFAULT 'unmatched',
    "reconciled_with_type" VARCHAR(50),
    "reconciled_with_id" TEXT,
    "reconciled_by" TEXT,
    "reconciled_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_definitions" (
    "id" TEXT NOT NULL,
    "form_name" VARCHAR(100) NOT NULL,
    "shop_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "description" VARCHAR(500),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_fields" (
    "id" TEXT NOT NULL,
    "form_definition_id" TEXT NOT NULL,
    "field_name" VARCHAR(100) NOT NULL,
    "field_label" VARCHAR(200) NOT NULL,
    "field_type" "FormFieldType" NOT NULL,
    "placeholder" VARCHAR(200),
    "default_value" VARCHAR(500),
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "validation_rules" JSONB,
    "options" JSONB,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "section_name" VARCHAR(100),
    "is_visible" BOOLEAN NOT NULL DEFAULT true,
    "css_class" VARCHAR(200),
    "depends_on" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expo_push_token" VARCHAR(200) NOT NULL,
    "device_info" VARCHAR(200),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "sent_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "shop_id" TEXT,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" TEXT NOT NULL,
    "action" VARCHAR(20) NOT NULL,
    "old_values" JSONB,
    "new_values" JSONB,
    "ip_address" VARCHAR(45),
    "user_agent" VARCHAR(500),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "designation" VARCHAR(100),
    "date_of_joining" DATE,
    "salary" DECIMAL(10,2),
    "aadhaar_number" VARCHAR(12),
    "address" TEXT,
    "emergency_contact" VARCHAR(15),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT,
    "key" VARCHAR(100) NOT NULL,
    "value" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shops_code_key" ON "shops"("code");

-- CreateIndex
CREATE UNIQUE INDEX "shops_gst_number_key" ON "shops"("gst_number");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "user_shops_user_id_idx" ON "user_shops"("user_id");

-- CreateIndex
CREATE INDEX "user_shops_shop_id_idx" ON "user_shops"("shop_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_shops_user_id_shop_id_key" ON "user_shops"("user_id", "shop_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_token_hash_idx" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "product_categories_parent_id_idx" ON "product_categories"("parent_id");

-- CreateIndex
CREATE INDEX "product_categories_path_idx" ON "product_categories"("path");

-- CreateIndex
CREATE INDEX "product_categories_slug_idx" ON "product_categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "product_categories_slug_parent_id_key" ON "product_categories"("slug", "parent_id");

-- CreateIndex
CREATE INDEX "category_attributes_category_id_idx" ON "category_attributes"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "category_attributes_category_id_attribute_name_key" ON "category_attributes"("category_id", "attribute_name");

-- CreateIndex
CREATE INDEX "products_shop_id_idx" ON "products"("shop_id");

-- CreateIndex
CREATE INDEX "products_category_id_idx" ON "products"("category_id");

-- CreateIndex
CREATE INDEX "products_status_idx" ON "products"("status");

-- CreateIndex
CREATE INDEX "products_brand_model_number_idx" ON "products"("brand", "model_number");

-- CreateIndex
CREATE INDEX "products_serial_number_idx" ON "products"("serial_number");

-- CreateIndex
CREATE INDEX "products_distributor_id_idx" ON "products"("distributor_id");

-- CreateIndex
CREATE INDEX "product_audit_trail_product_id_idx" ON "product_audit_trail"("product_id");

-- CreateIndex
CREATE INDEX "product_audit_trail_created_at_idx" ON "product_audit_trail"("created_at");

-- CreateIndex
CREATE INDEX "distributors_company_name_idx" ON "distributors"("company_name");

-- CreateIndex
CREATE INDEX "distributors_gst_number_idx" ON "distributors"("gst_number");

-- CreateIndex
CREATE INDEX "distributors_phone_idx" ON "distributors"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "distributor_categories_distributor_id_category_id_key" ON "distributor_categories"("distributor_id", "category_id");

-- CreateIndex
CREATE INDEX "purchases_shop_id_idx" ON "purchases"("shop_id");

-- CreateIndex
CREATE INDEX "purchases_distributor_id_idx" ON "purchases"("distributor_id");

-- CreateIndex
CREATE INDEX "purchases_invoice_number_idx" ON "purchases"("invoice_number");

-- CreateIndex
CREATE INDEX "purchases_invoice_date_idx" ON "purchases"("invoice_date");

-- CreateIndex
CREATE INDEX "purchase_payments_purchase_id_idx" ON "purchase_payments"("purchase_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_customer_code_key" ON "customers"("customer_code");

-- CreateIndex
CREATE INDEX "customers_phone_idx" ON "customers"("phone");

-- CreateIndex
CREATE INDEX "customers_customer_code_idx" ON "customers"("customer_code");

-- CreateIndex
CREATE INDEX "customers_name_idx" ON "customers"("name");

-- CreateIndex
CREATE INDEX "customers_shop_id_idx" ON "customers"("shop_id");

-- CreateIndex
CREATE INDEX "customers_guarantor_id_idx" ON "customers"("guarantor_id");

-- CreateIndex
CREATE INDEX "customers_aadhaar_number_idx" ON "customers"("aadhaar_number");

-- CreateIndex
CREATE UNIQUE INDEX "finance_companies_code_key" ON "finance_companies"("code");

-- CreateIndex
CREATE UNIQUE INDEX "sale_records_sale_number_key" ON "sale_records"("sale_number");

-- CreateIndex
CREATE INDEX "sale_records_shop_id_idx" ON "sale_records"("shop_id");

-- CreateIndex
CREATE INDEX "sale_records_product_id_idx" ON "sale_records"("product_id");

-- CreateIndex
CREATE INDEX "sale_records_customer_id_idx" ON "sale_records"("customer_id");

-- CreateIndex
CREATE INDEX "sale_records_sale_date_idx" ON "sale_records"("sale_date");

-- CreateIndex
CREATE INDEX "sale_records_sale_type_idx" ON "sale_records"("sale_type");

-- CreateIndex
CREATE INDEX "sale_records_sale_number_idx" ON "sale_records"("sale_number");

-- CreateIndex
CREATE INDEX "sale_records_ledger_number_idx" ON "sale_records"("ledger_number");

-- CreateIndex
CREATE INDEX "sale_records_finance_company_id_idx" ON "sale_records"("finance_company_id");

-- CreateIndex
CREATE INDEX "sale_records_guarantor_id_idx" ON "sale_records"("guarantor_id");

-- CreateIndex
CREATE INDEX "sale_records_created_by_idx" ON "sale_records"("created_by");

-- CreateIndex
CREATE INDEX "sale_records_sanitized_shop_id_idx" ON "sale_records_sanitized"("shop_id");

-- CreateIndex
CREATE INDEX "sale_records_sanitized_sale_date_idx" ON "sale_records_sanitized"("sale_date");

-- CreateIndex
CREATE UNIQUE INDEX "installment_schedules_sale_id_key" ON "installment_schedules"("sale_id");

-- CreateIndex
CREATE INDEX "installment_schedules_sale_id_idx" ON "installment_schedules"("sale_id");

-- CreateIndex
CREATE INDEX "installments_schedule_id_idx" ON "installments"("schedule_id");

-- CreateIndex
CREATE INDEX "installments_due_date_idx" ON "installments"("due_date");

-- CreateIndex
CREATE INDEX "installments_status_idx" ON "installments"("status");

-- CreateIndex
CREATE INDEX "installments_rescheduled_from_id_idx" ON "installments"("rescheduled_from_id");

-- CreateIndex
CREATE INDEX "installment_payments_installment_id_idx" ON "installment_payments"("installment_id");

-- CreateIndex
CREATE INDEX "installment_payments_payment_date_idx" ON "installment_payments"("payment_date");

-- CreateIndex
CREATE INDEX "installment_payments_collected_by_idx" ON "installment_payments"("collected_by");

-- CreateIndex
CREATE INDEX "employee_collection_assignments_employee_id_idx" ON "employee_collection_assignments"("employee_id");

-- CreateIndex
CREATE INDEX "employee_collection_assignments_schedule_id_idx" ON "employee_collection_assignments"("schedule_id");

-- CreateIndex
CREATE INDEX "inter_shop_transfers_product_id_idx" ON "inter_shop_transfers"("product_id");

-- CreateIndex
CREATE INDEX "inter_shop_transfers_from_shop_id_idx" ON "inter_shop_transfers"("from_shop_id");

-- CreateIndex
CREATE INDEX "inter_shop_transfers_to_shop_id_idx" ON "inter_shop_transfers"("to_shop_id");

-- CreateIndex
CREATE INDEX "inter_shop_transfers_transfer_date_idx" ON "inter_shop_transfers"("transfer_date");

-- CreateIndex
CREATE INDEX "expenses_shop_id_idx" ON "expenses"("shop_id");

-- CreateIndex
CREATE INDEX "expenses_expense_date_idx" ON "expenses"("expense_date");

-- CreateIndex
CREATE INDEX "expenses_category_idx" ON "expenses"("category");

-- CreateIndex
CREATE INDEX "bank_accounts_shop_id_idx" ON "bank_accounts"("shop_id");

-- CreateIndex
CREATE INDEX "bank_transactions_bank_account_id_idx" ON "bank_transactions"("bank_account_id");

-- CreateIndex
CREATE INDEX "bank_transactions_transaction_date_idx" ON "bank_transactions"("transaction_date");

-- CreateIndex
CREATE INDEX "bank_transactions_reconciliation_status_idx" ON "bank_transactions"("reconciliation_status");

-- CreateIndex
CREATE INDEX "form_definitions_form_name_idx" ON "form_definitions"("form_name");

-- CreateIndex
CREATE UNIQUE INDEX "form_definitions_form_name_shop_id_version_key" ON "form_definitions"("form_name", "shop_id", "version");

-- CreateIndex
CREATE INDEX "form_fields_form_definition_id_idx" ON "form_fields"("form_definition_id");

-- CreateIndex
CREATE UNIQUE INDEX "form_fields_form_definition_id_field_name_key" ON "form_fields"("form_definition_id", "field_name");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "employees_user_id_key" ON "employees"("user_id");

-- CreateIndex
CREATE INDEX "employees_shop_id_idx" ON "employees"("shop_id");

-- CreateIndex
CREATE INDEX "employees_user_id_idx" ON "employees"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "app_settings_shop_id_key_key" ON "app_settings"("shop_id", "key");

-- AddForeignKey
ALTER TABLE "user_shops" ADD CONSTRAINT "user_shops_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_shops" ADD CONSTRAINT "user_shops_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_attributes" ADD CONSTRAINT "category_attributes_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "product_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "product_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_distributor_id_fkey" FOREIGN KEY ("distributor_id") REFERENCES "distributors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_audit_trail" ADD CONSTRAINT "product_audit_trail_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_audit_trail" ADD CONSTRAINT "product_audit_trail_performed_by_fkey" FOREIGN KEY ("performed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distributors" ADD CONSTRAINT "distributors_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distributor_categories" ADD CONSTRAINT "distributor_categories_distributor_id_fkey" FOREIGN KEY ("distributor_id") REFERENCES "distributors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distributor_categories" ADD CONSTRAINT "distributor_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "product_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_distributor_id_fkey" FOREIGN KEY ("distributor_id") REFERENCES "distributors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_payments" ADD CONSTRAINT "purchase_payments_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_payments" ADD CONSTRAINT "purchase_payments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_guarantor_id_fkey" FOREIGN KEY ("guarantor_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_records" ADD CONSTRAINT "sale_records_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_records" ADD CONSTRAINT "sale_records_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_records" ADD CONSTRAINT "sale_records_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_records" ADD CONSTRAINT "sale_records_guarantor_id_fkey" FOREIGN KEY ("guarantor_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_records" ADD CONSTRAINT "sale_records_finance_company_id_fkey" FOREIGN KEY ("finance_company_id") REFERENCES "finance_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_records" ADD CONSTRAINT "sale_records_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_records_sanitized" ADD CONSTRAINT "sale_records_sanitized_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_records_sanitized" ADD CONSTRAINT "sale_records_sanitized_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_records_sanitized" ADD CONSTRAINT "sale_records_sanitized_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_records_sanitized" ADD CONSTRAINT "sale_records_sanitized_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_schedules" ADD CONSTRAINT "installment_schedules_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sale_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installments" ADD CONSTRAINT "installments_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "installment_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installments" ADD CONSTRAINT "installments_rescheduled_from_id_fkey" FOREIGN KEY ("rescheduled_from_id") REFERENCES "installments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_payments" ADD CONSTRAINT "installment_payments_installment_id_fkey" FOREIGN KEY ("installment_id") REFERENCES "installments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_payments" ADD CONSTRAINT "installment_payments_collected_by_fkey" FOREIGN KEY ("collected_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_collection_assignments" ADD CONSTRAINT "employee_collection_assignments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_collection_assignments" ADD CONSTRAINT "employee_collection_assignments_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "installment_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_collection_assignments" ADD CONSTRAINT "employee_collection_assignments_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inter_shop_transfers" ADD CONSTRAINT "inter_shop_transfers_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inter_shop_transfers" ADD CONSTRAINT "inter_shop_transfers_from_shop_id_fkey" FOREIGN KEY ("from_shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inter_shop_transfers" ADD CONSTRAINT "inter_shop_transfers_to_shop_id_fkey" FOREIGN KEY ("to_shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inter_shop_transfers" ADD CONSTRAINT "inter_shop_transfers_initiated_by_fkey" FOREIGN KEY ("initiated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inter_shop_transfers" ADD CONSTRAINT "inter_shop_transfers_received_by_fkey" FOREIGN KEY ("received_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_reconciled_by_fkey" FOREIGN KEY ("reconciled_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_definitions" ADD CONSTRAINT "form_definitions_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_fields" ADD CONSTRAINT "form_fields_form_definition_id_fkey" FOREIGN KEY ("form_definition_id") REFERENCES "form_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_tokens" ADD CONSTRAINT "notification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE SET NULL ON UPDATE CASCADE;
