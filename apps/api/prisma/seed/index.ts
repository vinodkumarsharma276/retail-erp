import { PrismaClient } from '@prisma/client';
import { seedShops } from './shops.seed';
import { seedRolesAndPermissions } from './roles-permissions.seed';
import { seedUsers, SEED_DEFAULT_PASSWORD, SEED_OWNER_USERNAMES } from './users.seed';
import { seedCategories } from './categories.seed';
import { seedFinanceCompanies } from './finance-companies.seed';
import { seedDistributors } from './distributors.seed';
import { seedPurchases } from './purchases.seed';
import { seedCustomers } from './customers.seed';
import { seedSales } from './sales.seed';
import { seedInstallments } from './installments.seed';
import { seedPromises } from './promises.seed';
import { seedInterestApplications } from './interest-applications.seed';
import { seedRollingOverdueScenarios } from './rolling-overdue-scenarios.seed';
import { seedFormDefinitions } from './form-definitions.seed';
import { ALL_FEATURE_KEYS, FeatureKey } from '@retailerp/shared-types';

const prisma = new PrismaClient();

async function ensureBootstrapTenant() {
  const plan = await prisma.plan.upsert({
    where: { code: 'enterprise' },
    update: { name: 'Enterprise', isActive: true },
    create: {
      code: 'enterprise',
      name: 'Enterprise',
      description: 'Default plan for seed data',
      priceMonthly: 0,
      priceYearly: 0,
      isPublic: false,
      isActive: true,
    },
  });

  for (const featureKey of ALL_FEATURE_KEYS) {
    const valueJson =
      featureKey === FeatureKey.MAX_SHOPS ||
      featureKey === FeatureKey.MAX_USERS ||
      featureKey === FeatureKey.MAX_PRODUCTS
        ? { max: null }
        : null;
    await prisma.planFeature.upsert({
      where: { planId_featureKey: { planId: plan.id, featureKey } },
      update: { enabled: true, valueJson: valueJson as any },
      create: { planId: plan.id, featureKey, enabled: true, valueJson: valueJson as any },
    });
  }

  return prisma.tenant.upsert({
    where: { slug: 'vn' },
    update: {
      name: 'Vinod Electronics',
      planId: plan.id,
      status: 'active',
      settings: {
        installment: {
          defaultPenalRateMonthly: 1.0,
          defaultPaymentAllocation: 'oldest_first',
          defaultThresholdDays: 60,
          reliabilityWindowDays: 365,
        },
      },
    },
    create: {
      slug: 'vn',
      name: 'Vinod Electronics',
      status: 'active',
      planId: plan.id,
      settings: {
        installment: {
          defaultPenalRateMonthly: 1.0,
          defaultPaymentAllocation: 'oldest_first',
          defaultThresholdDays: 60,
          reliabilityWindowDays: 365,
        },
      },
    },
  });
}

async function main() {
  console.log('Seeding database...\n');

  const tenant = await ensureBootstrapTenant();
  console.log(`  Tenant: ${tenant.slug}`);

  const shops = await seedShops(prisma, tenant.id);
  console.log(`  Shops: ${shops.length}`);

  const rbac = await seedRolesAndPermissions(prisma, tenant.id);
  console.log(`  Permissions: ${rbac.permissions}, Roles: ${rbac.roles}`);

  const users = await seedUsers(prisma, shops);
  console.log(`  Users: ${users.length}`);

  const categories = await seedCategories(prisma, tenant.id);
  console.log(`  Categories: ${categories.length}`);

  const financeCompanies = await seedFinanceCompanies(prisma);
  console.log(`  Finance companies: ${financeCompanies.length}`);

  const distributors = await seedDistributors(prisma, categories);
  console.log(`  Distributors: ${distributors.length}`);

  const customers = await seedCustomers(prisma, shops, users);
  console.log(`  Customers: ${customers.length}`);

  const { purchases, products } = await seedPurchases(prisma, shops, categories, distributors);
  console.log(`  Purchases: ${purchases.length}`);
  console.log(`  Products: ${products.length}`);

  const sales = await seedSales(prisma, shops, products, customers, users, financeCompanies);
  console.log(`  Sales: ${sales.length}`);

  const installmentSchedules = await seedInstallments(prisma, sales);
  console.log(`  Installment schedules processed: ${installmentSchedules.length}`);

  const promises = await seedPromises(prisma);
  console.log(`  Promises: ${promises.length}`);

  const interestApplications = await seedInterestApplications(prisma);
  console.log(`  Interest applications: ${interestApplications.length}`);

  const scenarios = await seedRollingOverdueScenarios(prisma);
  console.log(`  Rolling-overdue scenario schedules: ${scenarios.scheduleIds.length}`);

  const forms = await seedFormDefinitions(prisma, tenant.id);
  console.log(`  Form definitions: ${forms.length}`);

  console.log('\nSeeding complete!');
  console.log('\nOWNER CREDENTIALS (full access):');
  for (const username of SEED_OWNER_USERNAMES) {
    console.log(`  ${username}  /  ${SEED_DEFAULT_PASSWORD}`);
  }
}

main()
  .catch((e) => {
    console.error('Seeding failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
