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
import { seedRollingOverdueScenarios } from './rolling-overdue-scenarios.seed';
import { seedFormDefinitions } from './form-definitions.seed';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...\n');

  const shops = await seedShops(prisma);
  console.log(`  Shops: ${shops.length}`);

  const rbac = await seedRolesAndPermissions(prisma);
  console.log(`  Permissions: ${rbac.permissions}, Roles: ${rbac.roles}`);

  const users = await seedUsers(prisma, shops);
  console.log(`  Users: ${users.length}`);

  const categories = await seedCategories(prisma);
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

  const scenarios = await seedRollingOverdueScenarios(prisma);
  console.log(`  Rolling-overdue scenario schedules: ${scenarios.scheduleIds.length}`);

  const forms = await seedFormDefinitions(prisma);
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
