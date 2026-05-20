/**
 * Phase 1 multi-tenant bootstrap + backfill.
 *
 * Run ONCE after the `add_tenant_and_platform_models` migration. Creates:
 *   1. The default "enterprise" Plan with all FeatureKey defaults enabled.
 *   2. The bootstrap Tenant (slug `vn`, plan `enterprise`).
 *   3. Backfills `tenant_id` on every existing row across all 35 per-tenant
 *      tables so the follow-up migration can mark the columns NOT NULL.
 *
 * Idempotent — safe to re-run; uses `upsert` for tenant/plan and `updateMany`
 * with `tenantId: null` filters so rows already backfilled are skipped.
 *
 * Usage:
 *   cd apps/api
 *   npx tsx prisma/seed/bootstrap-tenant.ts
 */
import { PrismaClient } from '@prisma/client';
import {
  FeatureKey,
  ALL_FEATURE_KEYS,
} from '@retailerp/shared-types';

const prisma = new PrismaClient();

const BOOTSTRAP_TENANT = {
  slug: 'vn',
  name: 'Vinod & Nishant',
  contactEmail: null as string | null,
  contactPhone: null as string | null,
  gstNumber: null as string | null,
};

const ENTERPRISE_PLAN = {
  code: 'enterprise',
  name: 'Enterprise',
  description:
    'Default plan for the bootstrap tenant — every module enabled, no caps.',
  priceMonthly: 0,
  priceYearly: 0,
  isPublic: false,
  isActive: true,
};

/** Limit-style features and their unbounded (null) values for enterprise plan. */
const ENTERPRISE_LIMIT_VALUES: Record<string, unknown> = {
  [FeatureKey.MAX_SHOPS]: { max: null },
  [FeatureKey.MAX_USERS]: { max: null },
  [FeatureKey.MAX_PRODUCTS]: { max: null },
};

async function ensurePlanWithDefaults() {
  const plan = await prisma.plan.upsert({
    where: { code: ENTERPRISE_PLAN.code },
    update: { ...ENTERPRISE_PLAN },
    create: { ...ENTERPRISE_PLAN },
  });

  // Seed every feature key as `enabled` on the enterprise plan. Limit
  // features also carry `valueJson` describing the (unbounded) cap.
  for (const key of ALL_FEATURE_KEYS) {
    const valueJson = ENTERPRISE_LIMIT_VALUES[key] ?? null;
    await prisma.planFeature.upsert({
      where: { planId_featureKey: { planId: plan.id, featureKey: key } },
      update: { enabled: true, valueJson: valueJson as any },
      create: {
        planId: plan.id,
        featureKey: key,
        enabled: true,
        valueJson: valueJson as any,
      },
    });
  }
  return plan;
}

async function ensureBootstrapTenant(planId: string) {
  return prisma.tenant.upsert({
    where: { slug: BOOTSTRAP_TENANT.slug },
    update: {
      name: BOOTSTRAP_TENANT.name,
      planId,
      status: 'active',
    },
    create: {
      slug: BOOTSTRAP_TENANT.slug,
      name: BOOTSTRAP_TENANT.name,
      contactEmail: BOOTSTRAP_TENANT.contactEmail,
      contactPhone: BOOTSTRAP_TENANT.contactPhone,
      gstNumber: BOOTSTRAP_TENANT.gstNumber,
      status: 'active',
      planId,
    },
  });
}

/**
 * Backfill every per-tenant table whose `tenantId` is still NULL. We do this
 * with `updateMany` against `{ tenantId: null }` so re-runs are no-ops.
 *
 * Order matters where downstream tables reference upstream IDs (e.g. customers
 * before sales) only for clarity — the actual updates use the tenantId
 * constant, not lookups, so any order works.
 */
async function backfillAllTables(tenantId: string) {
  const tables: Array<{
    label: string;
    run: () => Promise<{ count: number }>;
  }> = [
    { label: 'shops',                            run: () => prisma.shop.updateMany({ where: { tenantId: null }, data: { tenantId } }) },
    { label: 'users',                            run: () => prisma.user.updateMany({ where: { tenantId: null }, data: { tenantId } }) },
    { label: 'roles',                            run: () => prisma.role.updateMany({ where: { tenantId: null }, data: { tenantId } }) },
    { label: 'role_permissions',                 run: () => prisma.rolePermission.updateMany({ where: { tenantId: null }, data: { tenantId } }) },
    { label: 'user_permissions',                 run: () => prisma.userPermission.updateMany({ where: { tenantId: null }, data: { tenantId } }) },
    { label: 'user_shops',                       run: () => prisma.userShop.updateMany({ where: { tenantId: null }, data: { tenantId } }) },
    { label: 'refresh_tokens',                   run: () => prisma.refreshToken.updateMany({ where: { tenantId: null }, data: { tenantId } }) },
    { label: 'product_categories',               run: () => prisma.productCategory.updateMany({ where: { tenantId: null }, data: { tenantId } }) },
    { label: 'category_attributes',              run: () => prisma.categoryAttribute.updateMany({ where: { tenantId: null }, data: { tenantId } }) },
    { label: 'products',                         run: () => prisma.product.updateMany({ where: { tenantId: null }, data: { tenantId } }) },
    { label: 'product_audit_trail',              run: () => prisma.productAuditTrail.updateMany({ where: { tenantId: null }, data: { tenantId } }) },
    { label: 'distributors',                     run: () => prisma.distributor.updateMany({ where: { tenantId: null }, data: { tenantId } }) },
    { label: 'distributor_categories',           run: () => prisma.distributorCategory.updateMany({ where: { tenantId: null }, data: { tenantId } }) },
    { label: 'purchases',                        run: () => prisma.purchase.updateMany({ where: { tenantId: null }, data: { tenantId } }) },
    { label: 'purchase_payments',                run: () => prisma.purchasePayment.updateMany({ where: { tenantId: null }, data: { tenantId } }) },
    { label: 'customers',                        run: () => prisma.customer.updateMany({ where: { tenantId: null }, data: { tenantId } }) },
    { label: 'sale_records',                     run: () => prisma.saleRecord.updateMany({ where: { tenantId: null }, data: { tenantId } }) },
    { label: 'sale_records_sanitized',           run: () => prisma.saleRecordSanitized.updateMany({ where: { tenantId: null }, data: { tenantId } }) },
    { label: 'installment_schedules',            run: () => prisma.installmentSchedule.updateMany({ where: { tenantId: null }, data: { tenantId } }) },
    { label: 'installments',                     run: () => prisma.installment.updateMany({ where: { tenantId: null }, data: { tenantId } }) },
    { label: 'installment_payments',             run: () => prisma.installmentPayment.updateMany({ where: { tenantId: null }, data: { tenantId } }) },
    { label: 'installment_interest_applications',run: () => prisma.installmentInterestApplication.updateMany({ where: { tenantId: null }, data: { tenantId } }) },
    { label: 'installment_roll_log',             run: () => prisma.installmentRollLog.updateMany({ where: { tenantId: null }, data: { tenantId } }) },
    { label: 'employee_collection_assignments',  run: () => prisma.employeeCollectionAssignment.updateMany({ where: { tenantId: null }, data: { tenantId } }) },
    { label: 'inter_shop_transfers',             run: () => prisma.interShopTransfer.updateMany({ where: { tenantId: null }, data: { tenantId } }) },
    { label: 'expenses',                         run: () => prisma.expense.updateMany({ where: { tenantId: null }, data: { tenantId } }) },
    { label: 'bank_accounts',                    run: () => prisma.bankAccount.updateMany({ where: { tenantId: null }, data: { tenantId } }) },
    { label: 'bank_transactions',                run: () => prisma.bankTransaction.updateMany({ where: { tenantId: null }, data: { tenantId } }) },
    { label: 'form_definitions',                 run: () => prisma.formDefinition.updateMany({ where: { tenantId: null }, data: { tenantId } }) },
    { label: 'form_fields',                      run: () => prisma.formField.updateMany({ where: { tenantId: null }, data: { tenantId } }) },
    { label: 'notification_tokens',              run: () => prisma.notificationToken.updateMany({ where: { tenantId: null }, data: { tenantId } }) },
    { label: 'notifications',                    run: () => prisma.notification.updateMany({ where: { tenantId: null }, data: { tenantId } }) },
    { label: 'audit_logs',                       run: () => prisma.auditLog.updateMany({ where: { tenantId: null }, data: { tenantId } }) },
    { label: 'employees',                        run: () => prisma.employee.updateMany({ where: { tenantId: null }, data: { tenantId } }) },
    { label: 'app_settings',                     run: () => prisma.appSetting.updateMany({ where: { tenantId: null }, data: { tenantId } }) },
  ];

  let totalUpdated = 0;
  console.log('\nBackfill summary:');
  for (const t of tables) {
    const res = await t.run();
    totalUpdated += res.count;
    console.log(`  ${t.label.padEnd(40)} +${res.count}`);
  }
  console.log(`\n  TOTAL rows updated: ${totalUpdated}`);
}

/**
 * Verification — make sure no table still has rows with tenantId NULL.
 * If any do, the follow-up NOT NULL migration will fail with a clear
 * "column violates NOT NULL constraint" error; this check surfaces the
 * problem early.
 */
async function verifyNoNulls() {
  const checks: Array<[string, () => Promise<number>]> = [
    ['shops',                            () => prisma.shop.count({ where: { tenantId: null } })],
    ['users',                            () => prisma.user.count({ where: { tenantId: null } })],
    ['roles',                            () => prisma.role.count({ where: { tenantId: null } })],
    ['role_permissions',                 () => prisma.rolePermission.count({ where: { tenantId: null } })],
    ['user_permissions',                 () => prisma.userPermission.count({ where: { tenantId: null } })],
    ['user_shops',                       () => prisma.userShop.count({ where: { tenantId: null } })],
    ['refresh_tokens',                   () => prisma.refreshToken.count({ where: { tenantId: null } })],
    ['product_categories',               () => prisma.productCategory.count({ where: { tenantId: null } })],
    ['category_attributes',              () => prisma.categoryAttribute.count({ where: { tenantId: null } })],
    ['products',                         () => prisma.product.count({ where: { tenantId: null } })],
    ['product_audit_trail',              () => prisma.productAuditTrail.count({ where: { tenantId: null } })],
    ['distributors',                     () => prisma.distributor.count({ where: { tenantId: null } })],
    ['distributor_categories',           () => prisma.distributorCategory.count({ where: { tenantId: null } })],
    ['purchases',                        () => prisma.purchase.count({ where: { tenantId: null } })],
    ['purchase_payments',                () => prisma.purchasePayment.count({ where: { tenantId: null } })],
    ['customers',                        () => prisma.customer.count({ where: { tenantId: null } })],
    ['sale_records',                     () => prisma.saleRecord.count({ where: { tenantId: null } })],
    ['sale_records_sanitized',           () => prisma.saleRecordSanitized.count({ where: { tenantId: null } })],
    ['installment_schedules',            () => prisma.installmentSchedule.count({ where: { tenantId: null } })],
    ['installments',                     () => prisma.installment.count({ where: { tenantId: null } })],
    ['installment_payments',             () => prisma.installmentPayment.count({ where: { tenantId: null } })],
    ['installment_interest_applications',() => prisma.installmentInterestApplication.count({ where: { tenantId: null } })],
    ['installment_roll_log',             () => prisma.installmentRollLog.count({ where: { tenantId: null } })],
    ['employee_collection_assignments',  () => prisma.employeeCollectionAssignment.count({ where: { tenantId: null } })],
    ['inter_shop_transfers',             () => prisma.interShopTransfer.count({ where: { tenantId: null } })],
    ['expenses',                         () => prisma.expense.count({ where: { tenantId: null } })],
    ['bank_accounts',                    () => prisma.bankAccount.count({ where: { tenantId: null } })],
    ['bank_transactions',                () => prisma.bankTransaction.count({ where: { tenantId: null } })],
    ['form_definitions',                 () => prisma.formDefinition.count({ where: { tenantId: null } })],
    ['form_fields',                      () => prisma.formField.count({ where: { tenantId: null } })],
    ['notification_tokens',              () => prisma.notificationToken.count({ where: { tenantId: null } })],
    ['notifications',                    () => prisma.notification.count({ where: { tenantId: null } })],
    // audit_logs intentionally allows NULL tenantId — it's nullable in the
    // schema and stays nullable so legacy + system-wide entries survive.
    ['employees',                        () => prisma.employee.count({ where: { tenantId: null } })],
    ['app_settings',                     () => prisma.appSetting.count({ where: { tenantId: null } })],
  ];

  let problems = 0;
  console.log('\nNULL tenant_id verification:');
  for (const [label, run] of checks) {
    const n = await run();
    if (n > 0) {
      console.log(`  ✗ ${label}: ${n} rows still NULL`);
      problems++;
    }
  }
  if (problems === 0) {
    console.log('  ✓ all tables clear (no NULL tenant_id rows)');
  } else {
    console.log(
      `\n  ${problems} table(s) still contain NULL tenant_id rows. ` +
        `The follow-up NOT NULL migration will fail until these are resolved.`,
    );
  }
}

async function main() {
  console.log('Phase 1 multi-tenant bootstrap');
  console.log('  Plan:    ', ENTERPRISE_PLAN.code, `(${ENTERPRISE_PLAN.name})`);
  console.log('  Tenant:  ', BOOTSTRAP_TENANT.slug, `(${BOOTSTRAP_TENANT.name})`);

  const plan = await ensurePlanWithDefaults();
  console.log(`  Plan id:   ${plan.id}`);

  const tenant = await ensureBootstrapTenant(plan.id);
  console.log(`  Tenant id: ${tenant.id}`);

  await backfillAllTables(tenant.id);
  await verifyNoNulls();

  console.log('\nDone.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
