/*
  Warnings:

  - A unique constraint covering the columns `[tenant_id,shop_id,key]` on the table `app_settings` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[tenant_id,customer_code]` on the table `customers` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[tenant_id,code]` on the table `roles` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[tenant_id,sale_number]` on the table `sale_records` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[tenant_id,code]` on the table `shops` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[tenant_id,gst_number]` on the table `shops` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[tenant_id,username]` on the table `users` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('active', 'trial', 'suspended', 'cancelled');

-- DropIndex
DROP INDEX "customers_customer_code_key";

-- DropIndex
DROP INDEX "roles_code_key";

-- DropIndex
DROP INDEX "sale_records_sale_number_key";

-- DropIndex
DROP INDEX "shops_code_key";

-- DropIndex
DROP INDEX "shops_gst_number_key";

-- DropIndex
DROP INDEX "users_username_key";

-- AlterTable
ALTER TABLE "app_settings" ADD COLUMN     "tenant_id" TEXT;

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "tenant_id" TEXT;

-- AlterTable
ALTER TABLE "bank_accounts" ADD COLUMN     "tenant_id" TEXT;

-- AlterTable
ALTER TABLE "bank_transactions" ADD COLUMN     "tenant_id" TEXT;

-- AlterTable
ALTER TABLE "category_attributes" ADD COLUMN     "tenant_id" TEXT;

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "tenant_id" TEXT;

-- AlterTable
ALTER TABLE "distributor_categories" ADD COLUMN     "tenant_id" TEXT;

-- AlterTable
ALTER TABLE "distributors" ADD COLUMN     "tenant_id" TEXT;

-- AlterTable
ALTER TABLE "employee_collection_assignments" ADD COLUMN     "tenant_id" TEXT;

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "tenant_id" TEXT;

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "tenant_id" TEXT;

-- AlterTable
ALTER TABLE "form_definitions" ADD COLUMN     "tenant_id" TEXT;

-- AlterTable
ALTER TABLE "form_fields" ADD COLUMN     "tenant_id" TEXT;

-- AlterTable
ALTER TABLE "installment_interest_applications" ADD COLUMN     "tenant_id" TEXT;

-- AlterTable
ALTER TABLE "installment_payments" ADD COLUMN     "tenant_id" TEXT;

-- AlterTable
ALTER TABLE "installment_roll_log" ADD COLUMN     "tenant_id" TEXT;

-- AlterTable
ALTER TABLE "installment_schedules" ADD COLUMN     "tenant_id" TEXT;

-- AlterTable
ALTER TABLE "installments" ADD COLUMN     "tenant_id" TEXT;

-- AlterTable
ALTER TABLE "inter_shop_transfers" ADD COLUMN     "tenant_id" TEXT;

-- AlterTable
ALTER TABLE "notification_tokens" ADD COLUMN     "tenant_id" TEXT;

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "tenant_id" TEXT;

-- AlterTable
ALTER TABLE "product_audit_trail" ADD COLUMN     "tenant_id" TEXT;

-- AlterTable
ALTER TABLE "product_categories" ADD COLUMN     "tenant_id" TEXT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "tenant_id" TEXT;

-- AlterTable
ALTER TABLE "purchase_payments" ADD COLUMN     "tenant_id" TEXT;

-- AlterTable
ALTER TABLE "purchases" ADD COLUMN     "tenant_id" TEXT;

-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN     "tenant_id" TEXT;

-- AlterTable
ALTER TABLE "role_permissions" ADD COLUMN     "tenant_id" TEXT;

-- AlterTable
ALTER TABLE "roles" ADD COLUMN     "tenant_id" TEXT;

-- AlterTable
ALTER TABLE "sale_records" ADD COLUMN     "tenant_id" TEXT;

-- AlterTable
ALTER TABLE "sale_records_sanitized" ADD COLUMN     "tenant_id" TEXT;

-- AlterTable
ALTER TABLE "shops" ADD COLUMN     "tenant_id" TEXT;

-- AlterTable
ALTER TABLE "user_permissions" ADD COLUMN     "tenant_id" TEXT;

-- AlterTable
ALTER TABLE "user_shops" ADD COLUMN     "tenant_id" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "tenant_id" TEXT;

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "slug" VARCHAR(63) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "contact_email" VARCHAR(255),
    "contact_phone" VARCHAR(15),
    "gst_number" VARCHAR(15),
    "custom_domain" VARCHAR(255),
    "status" "TenantStatus" NOT NULL DEFAULT 'active',
    "plan_id" TEXT NOT NULL,
    "trial_ends_at" TIMESTAMPTZ,
    "billing_meta" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "price_monthly" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "price_yearly" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_features" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "feature_key" VARCHAR(100) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "value_json" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_features_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_features" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "feature_key" VARCHAR(100) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "value_json" JSONB,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_features_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_users" (
    "id" TEXT NOT NULL,
    "username" VARCHAR(100) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "full_name" VARCHAR(200) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "totp_secret" VARCHAR(255),
    "last_login_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_refresh_tokens" (
    "id" TEXT NOT NULL,
    "platform_user_id" TEXT NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "device_info" VARCHAR(500),
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_audit_logs" (
    "id" TEXT NOT NULL,
    "platform_user_id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "action" VARCHAR(100) NOT NULL,
    "entity_type" VARCHAR(50),
    "entity_id" TEXT,
    "old_values" JSONB,
    "new_values" JSONB,
    "ip_address" VARCHAR(45),
    "user_agent" VARCHAR(500),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_custom_domain_key" ON "tenants"("custom_domain");

-- CreateIndex
CREATE INDEX "tenants_plan_id_idx" ON "tenants"("plan_id");

-- CreateIndex
CREATE INDEX "tenants_status_idx" ON "tenants"("status");

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- CreateIndex
CREATE INDEX "plan_features_plan_id_idx" ON "plan_features"("plan_id");

-- CreateIndex
CREATE UNIQUE INDEX "plan_features_plan_id_feature_key_key" ON "plan_features"("plan_id", "feature_key");

-- CreateIndex
CREATE INDEX "tenant_features_tenant_id_idx" ON "tenant_features"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_features_tenant_id_feature_key_key" ON "tenant_features"("tenant_id", "feature_key");

-- CreateIndex
CREATE UNIQUE INDEX "platform_users_username_key" ON "platform_users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "platform_users_email_key" ON "platform_users"("email");

-- CreateIndex
CREATE INDEX "platform_refresh_tokens_platform_user_id_idx" ON "platform_refresh_tokens"("platform_user_id");

-- CreateIndex
CREATE INDEX "platform_refresh_tokens_token_hash_idx" ON "platform_refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "platform_audit_logs_platform_user_id_idx" ON "platform_audit_logs"("platform_user_id");

-- CreateIndex
CREATE INDEX "platform_audit_logs_tenant_id_idx" ON "platform_audit_logs"("tenant_id");

-- CreateIndex
CREATE INDEX "platform_audit_logs_action_idx" ON "platform_audit_logs"("action");

-- CreateIndex
CREATE INDEX "platform_audit_logs_created_at_idx" ON "platform_audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "app_settings_tenant_id_idx" ON "app_settings"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "app_settings_tenant_id_shop_id_key_key" ON "app_settings"("tenant_id", "shop_id", "key");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_idx" ON "audit_logs"("tenant_id");

-- CreateIndex
CREATE INDEX "bank_accounts_tenant_id_idx" ON "bank_accounts"("tenant_id");

-- CreateIndex
CREATE INDEX "bank_transactions_tenant_id_idx" ON "bank_transactions"("tenant_id");

-- CreateIndex
CREATE INDEX "category_attributes_tenant_id_idx" ON "category_attributes"("tenant_id");

-- CreateIndex
CREATE INDEX "customers_tenant_id_idx" ON "customers"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenant_id_customer_code_key" ON "customers"("tenant_id", "customer_code");

-- CreateIndex
CREATE INDEX "distributor_categories_tenant_id_idx" ON "distributor_categories"("tenant_id");

-- CreateIndex
CREATE INDEX "distributors_tenant_id_idx" ON "distributors"("tenant_id");

-- CreateIndex
CREATE INDEX "employee_collection_assignments_tenant_id_idx" ON "employee_collection_assignments"("tenant_id");

-- CreateIndex
CREATE INDEX "employees_tenant_id_idx" ON "employees"("tenant_id");

-- CreateIndex
CREATE INDEX "expenses_tenant_id_idx" ON "expenses"("tenant_id");

-- CreateIndex
CREATE INDEX "form_definitions_tenant_id_idx" ON "form_definitions"("tenant_id");

-- CreateIndex
CREATE INDEX "form_fields_tenant_id_idx" ON "form_fields"("tenant_id");

-- CreateIndex
CREATE INDEX "installment_interest_applications_tenant_id_idx" ON "installment_interest_applications"("tenant_id");

-- CreateIndex
CREATE INDEX "installment_payments_tenant_id_idx" ON "installment_payments"("tenant_id");

-- CreateIndex
CREATE INDEX "installment_roll_log_tenant_id_idx" ON "installment_roll_log"("tenant_id");

-- CreateIndex
CREATE INDEX "installment_schedules_tenant_id_idx" ON "installment_schedules"("tenant_id");

-- CreateIndex
CREATE INDEX "installments_tenant_id_idx" ON "installments"("tenant_id");

-- CreateIndex
CREATE INDEX "inter_shop_transfers_tenant_id_idx" ON "inter_shop_transfers"("tenant_id");

-- CreateIndex
CREATE INDEX "notification_tokens_tenant_id_idx" ON "notification_tokens"("tenant_id");

-- CreateIndex
CREATE INDEX "notifications_tenant_id_idx" ON "notifications"("tenant_id");

-- CreateIndex
CREATE INDEX "product_audit_trail_tenant_id_idx" ON "product_audit_trail"("tenant_id");

-- CreateIndex
CREATE INDEX "product_categories_tenant_id_idx" ON "product_categories"("tenant_id");

-- CreateIndex
CREATE INDEX "products_tenant_id_idx" ON "products"("tenant_id");

-- CreateIndex
CREATE INDEX "purchase_payments_tenant_id_idx" ON "purchase_payments"("tenant_id");

-- CreateIndex
CREATE INDEX "purchases_tenant_id_idx" ON "purchases"("tenant_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_tenant_id_idx" ON "refresh_tokens"("tenant_id");

-- CreateIndex
CREATE INDEX "role_permissions_tenant_id_idx" ON "role_permissions"("tenant_id");

-- CreateIndex
CREATE INDEX "roles_tenant_id_idx" ON "roles"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_tenant_id_code_key" ON "roles"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "sale_records_tenant_id_idx" ON "sale_records"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "sale_records_tenant_id_sale_number_key" ON "sale_records"("tenant_id", "sale_number");

-- CreateIndex
CREATE INDEX "sale_records_sanitized_tenant_id_idx" ON "sale_records_sanitized"("tenant_id");

-- CreateIndex
CREATE INDEX "shops_tenant_id_idx" ON "shops"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "shops_tenant_id_code_key" ON "shops"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "shops_tenant_id_gst_number_key" ON "shops"("tenant_id", "gst_number");

-- CreateIndex
CREATE INDEX "user_permissions_tenant_id_idx" ON "user_permissions"("tenant_id");

-- CreateIndex
CREATE INDEX "user_shops_tenant_id_idx" ON "user_shops"("tenant_id");

-- CreateIndex
CREATE INDEX "users_tenant_id_idx" ON "users"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_username_key" ON "users"("tenant_id", "username");

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_features" ADD CONSTRAINT "plan_features_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_features" ADD CONSTRAINT "tenant_features_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_refresh_tokens" ADD CONSTRAINT "platform_refresh_tokens_platform_user_id_fkey" FOREIGN KEY ("platform_user_id") REFERENCES "platform_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_audit_logs" ADD CONSTRAINT "platform_audit_logs_platform_user_id_fkey" FOREIGN KEY ("platform_user_id") REFERENCES "platform_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_audit_logs" ADD CONSTRAINT "platform_audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shops" ADD CONSTRAINT "shops_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_shops" ADD CONSTRAINT "user_shops_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_attributes" ADD CONSTRAINT "category_attributes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_audit_trail" ADD CONSTRAINT "product_audit_trail_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distributors" ADD CONSTRAINT "distributors_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distributor_categories" ADD CONSTRAINT "distributor_categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_payments" ADD CONSTRAINT "purchase_payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_records" ADD CONSTRAINT "sale_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_records_sanitized" ADD CONSTRAINT "sale_records_sanitized_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_schedules" ADD CONSTRAINT "installment_schedules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installments" ADD CONSTRAINT "installments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_payments" ADD CONSTRAINT "installment_payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_interest_applications" ADD CONSTRAINT "installment_interest_applications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_roll_log" ADD CONSTRAINT "installment_roll_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_collection_assignments" ADD CONSTRAINT "employee_collection_assignments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inter_shop_transfers" ADD CONSTRAINT "inter_shop_transfers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_definitions" ADD CONSTRAINT "form_definitions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_fields" ADD CONSTRAINT "form_fields_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_tokens" ADD CONSTRAINT "notification_tokens_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
