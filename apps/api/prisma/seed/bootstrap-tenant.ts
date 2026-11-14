/**
 * Phase 1 multi-tenant bootstrap + backfill.
 *
 * Run ONCE after the `add_tenant_and_platform_models` migration. Creates:
 *   1. The default "enterprise" Plan with all FeatureKey defaults enabled.
 *   2. The bootstrap Tenant (slug `vn`, plan `enterprise`).
 *   3. Backfills `tenant_id` on every existing row across all 35 per-tenant
 *      tables so the follow-up migration can mark the columns NOT NULL.
 *
 * Idempotent — safe to re-run; uses `upsert` for tenant/plan and
 * `WHERE tenant_id IS NULL` updates so rows already backfilled are skipped.
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
  name: 'Vinod Electronics',
  contactEmail: null as string | null,
  contactPhone: null as string | null,
  gstNumber: null as string | null,
  settings: {
    installment: {
      defaultPenalRateMonthly: 1.0,
      defaultPaymentAllocation: 'oldest_first',
      defaultThresholdDays: 60,
      reliabilityWindowDays: 365,
    },
  },
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
      settings: BOOTSTRAP_TENANT.settings,
    },
    create: {
      slug: BOOTSTRAP_TENANT.slug,
      name: BOOTSTRAP_TENANT.name,
      contactEmail: BOOTSTRAP_TENANT.contactEmail,
      contactPhone: BOOTSTRAP_TENANT.contactPhone,
      gstNumber: BOOTSTRAP_TENANT.gstNumber,
      status: 'active',
      planId,
      settings: BOOTSTRAP_TENANT.settings,
    },
  });
}

/** Every per-tenant table (the `@@map` names), in backfill order. */
const TENANT_TABLES = [
  'shops', 'users', 'roles', 'role_permissions', 'user_permissions', 'user_shops',
  'refresh_tokens', 'product_categories', 'category_attributes', 'products',
  'product_audit_trail', 'distributors', 'distributor_categories', 'purchases',
  'purchase_payments', 'customers', 'sale_records', 'sale_records_sanitized',
  'installment_schedules', 'installments', 'installment_payments',
  'installment_interest_applications', 'installment_roll_log',
  'employee_collection_assignments', 'inter_shop_transfers', 'expenses',
  'bank_accounts', 'bank_transactions', 'form_definitions', 'form_fields',
  'notification_tokens', 'notifications', 'audit_logs', 'employees', 'app_settings',
] as const;

/**
 * Backfill every per-tenant table whose `tenant_id` is still NULL, so re-runs
 * are no-ops. Raw SQL because the columns have since become NOT NULL and the
 * generated client no longer accepts a `tenantId: null` filter. The table
 * names come from the constant list above, never from input.
 */
async function backfillAllTables(tenantId: string) {
  let totalUpdated = 0;
  console.log('\nBackfill summary:');
  for (const table of TENANT_TABLES) {
    const count = await prisma.$executeRawUnsafe(
      `UPDATE "${table}" SET tenant_id = $1 WHERE tenant_id IS NULL`,
      tenantId,
    );
    totalUpdated += count;
    console.log(`  ${table.padEnd(40)} +${count}`);
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
  let problems = 0;
  console.log('\nNULL tenant_id verification:');
  for (const table of TENANT_TABLES) {
    // audit_logs intentionally allows NULL tenantId — it's nullable in the
    // schema and stays nullable so legacy + system-wide entries survive.
    if (table === 'audit_logs') continue;
    const [{ n }] = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT COUNT(*)::int AS n FROM "${table}" WHERE tenant_id IS NULL`,
    );
    if (n > 0) {
      console.log(`  ✗ ${table}: ${n} rows still NULL`);
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
