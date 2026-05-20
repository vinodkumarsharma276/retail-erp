/*
  Warnings:

  - Made the column `tenant_id` on table `app_settings` required. This step will fail if there are existing NULL values in that column.
  - Made the column `tenant_id` on table `bank_accounts` required. This step will fail if there are existing NULL values in that column.
  - Made the column `tenant_id` on table `bank_transactions` required. This step will fail if there are existing NULL values in that column.
  - Made the column `tenant_id` on table `category_attributes` required. This step will fail if there are existing NULL values in that column.
  - Made the column `tenant_id` on table `customers` required. This step will fail if there are existing NULL values in that column.
  - Made the column `tenant_id` on table `distributor_categories` required. This step will fail if there are existing NULL values in that column.
  - Made the column `tenant_id` on table `distributors` required. This step will fail if there are existing NULL values in that column.
  - Made the column `tenant_id` on table `employee_collection_assignments` required. This step will fail if there are existing NULL values in that column.
  - Made the column `tenant_id` on table `employees` required. This step will fail if there are existing NULL values in that column.
  - Made the column `tenant_id` on table `expenses` required. This step will fail if there are existing NULL values in that column.
  - Made the column `tenant_id` on table `form_definitions` required. This step will fail if there are existing NULL values in that column.
  - Made the column `tenant_id` on table `form_fields` required. This step will fail if there are existing NULL values in that column.
  - Made the column `tenant_id` on table `installment_interest_applications` required. This step will fail if there are existing NULL values in that column.
  - Made the column `tenant_id` on table `installment_payments` required. This step will fail if there are existing NULL values in that column.
  - Made the column `tenant_id` on table `installment_roll_log` required. This step will fail if there are existing NULL values in that column.
  - Made the column `tenant_id` on table `installment_schedules` required. This step will fail if there are existing NULL values in that column.
  - Made the column `tenant_id` on table `installments` required. This step will fail if there are existing NULL values in that column.
  - Made the column `tenant_id` on table `inter_shop_transfers` required. This step will fail if there are existing NULL values in that column.
  - Made the column `tenant_id` on table `notification_tokens` required. This step will fail if there are existing NULL values in that column.
  - Made the column `tenant_id` on table `notifications` required. This step will fail if there are existing NULL values in that column.
  - Made the column `tenant_id` on table `product_audit_trail` required. This step will fail if there are existing NULL values in that column.
  - Made the column `tenant_id` on table `product_categories` required. This step will fail if there are existing NULL values in that column.
  - Made the column `tenant_id` on table `products` required. This step will fail if there are existing NULL values in that column.
  - Made the column `tenant_id` on table `purchase_payments` required. This step will fail if there are existing NULL values in that column.
  - Made the column `tenant_id` on table `purchases` required. This step will fail if there are existing NULL values in that column.
  - Made the column `tenant_id` on table `refresh_tokens` required. This step will fail if there are existing NULL values in that column.
  - Made the column `tenant_id` on table `role_permissions` required. This step will fail if there are existing NULL values in that column.
  - Made the column `tenant_id` on table `roles` required. This step will fail if there are existing NULL values in that column.
  - Made the column `tenant_id` on table `sale_records` required. This step will fail if there are existing NULL values in that column.
  - Made the column `tenant_id` on table `sale_records_sanitized` required. This step will fail if there are existing NULL values in that column.
  - Made the column `tenant_id` on table `shops` required. This step will fail if there are existing NULL values in that column.
  - Made the column `tenant_id` on table `user_permissions` required. This step will fail if there are existing NULL values in that column.
  - Made the column `tenant_id` on table `user_shops` required. This step will fail if there are existing NULL values in that column.
  - Made the column `tenant_id` on table `users` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "app_settings" DROP CONSTRAINT "app_settings_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "bank_accounts" DROP CONSTRAINT "bank_accounts_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "bank_transactions" DROP CONSTRAINT "bank_transactions_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "category_attributes" DROP CONSTRAINT "category_attributes_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "customers" DROP CONSTRAINT "customers_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "distributor_categories" DROP CONSTRAINT "distributor_categories_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "distributors" DROP CONSTRAINT "distributors_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "employee_collection_assignments" DROP CONSTRAINT "employee_collection_assignments_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "employees" DROP CONSTRAINT "employees_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "expenses" DROP CONSTRAINT "expenses_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "form_definitions" DROP CONSTRAINT "form_definitions_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "form_fields" DROP CONSTRAINT "form_fields_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "installment_interest_applications" DROP CONSTRAINT "installment_interest_applications_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "installment_payments" DROP CONSTRAINT "installment_payments_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "installment_roll_log" DROP CONSTRAINT "installment_roll_log_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "installment_schedules" DROP CONSTRAINT "installment_schedules_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "installments" DROP CONSTRAINT "installments_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "inter_shop_transfers" DROP CONSTRAINT "inter_shop_transfers_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "notification_tokens" DROP CONSTRAINT "notification_tokens_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "product_audit_trail" DROP CONSTRAINT "product_audit_trail_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "product_categories" DROP CONSTRAINT "product_categories_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "products" DROP CONSTRAINT "products_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "purchase_payments" DROP CONSTRAINT "purchase_payments_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "purchases" DROP CONSTRAINT "purchases_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "refresh_tokens" DROP CONSTRAINT "refresh_tokens_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "role_permissions" DROP CONSTRAINT "role_permissions_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "roles" DROP CONSTRAINT "roles_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "sale_records" DROP CONSTRAINT "sale_records_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "sale_records_sanitized" DROP CONSTRAINT "sale_records_sanitized_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "shops" DROP CONSTRAINT "shops_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "user_permissions" DROP CONSTRAINT "user_permissions_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "user_shops" DROP CONSTRAINT "user_shops_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_tenant_id_fkey";

-- AlterTable
ALTER TABLE "app_settings" ALTER COLUMN "tenant_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "bank_accounts" ALTER COLUMN "tenant_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "bank_transactions" ALTER COLUMN "tenant_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "category_attributes" ALTER COLUMN "tenant_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "customers" ALTER COLUMN "tenant_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "distributor_categories" ALTER COLUMN "tenant_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "distributors" ALTER COLUMN "tenant_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "employee_collection_assignments" ALTER COLUMN "tenant_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "employees" ALTER COLUMN "tenant_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "expenses" ALTER COLUMN "tenant_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "form_definitions" ALTER COLUMN "tenant_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "form_fields" ALTER COLUMN "tenant_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "installment_interest_applications" ALTER COLUMN "tenant_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "installment_payments" ALTER COLUMN "tenant_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "installment_roll_log" ALTER COLUMN "tenant_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "installment_schedules" ALTER COLUMN "tenant_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "installments" ALTER COLUMN "tenant_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "inter_shop_transfers" ALTER COLUMN "tenant_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "notification_tokens" ALTER COLUMN "tenant_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "notifications" ALTER COLUMN "tenant_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "product_audit_trail" ALTER COLUMN "tenant_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "product_categories" ALTER COLUMN "tenant_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "products" ALTER COLUMN "tenant_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "purchase_payments" ALTER COLUMN "tenant_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "purchases" ALTER COLUMN "tenant_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "refresh_tokens" ALTER COLUMN "tenant_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "role_permissions" ALTER COLUMN "tenant_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "roles" ALTER COLUMN "tenant_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "sale_records" ALTER COLUMN "tenant_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "sale_records_sanitized" ALTER COLUMN "tenant_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "shops" ALTER COLUMN "tenant_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "user_permissions" ALTER COLUMN "tenant_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "user_shops" ALTER COLUMN "tenant_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "tenant_id" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "shops" ADD CONSTRAINT "shops_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_shops" ADD CONSTRAINT "user_shops_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_attributes" ADD CONSTRAINT "category_attributes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_audit_trail" ADD CONSTRAINT "product_audit_trail_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distributors" ADD CONSTRAINT "distributors_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distributor_categories" ADD CONSTRAINT "distributor_categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_payments" ADD CONSTRAINT "purchase_payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_records" ADD CONSTRAINT "sale_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_records_sanitized" ADD CONSTRAINT "sale_records_sanitized_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_schedules" ADD CONSTRAINT "installment_schedules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installments" ADD CONSTRAINT "installments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_payments" ADD CONSTRAINT "installment_payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_interest_applications" ADD CONSTRAINT "installment_interest_applications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_roll_log" ADD CONSTRAINT "installment_roll_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_collection_assignments" ADD CONSTRAINT "employee_collection_assignments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inter_shop_transfers" ADD CONSTRAINT "inter_shop_transfers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_definitions" ADD CONSTRAINT "form_definitions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_fields" ADD CONSTRAINT "form_fields_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_tokens" ADD CONSTRAINT "notification_tokens_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
