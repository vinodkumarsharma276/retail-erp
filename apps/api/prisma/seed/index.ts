import { PrismaClient } from '@prisma/client';
import { seedShops } from './shops.seed';
import { seedUsers } from './users.seed';
import { seedCategories } from './categories.seed';
import { seedFinanceCompanies } from './finance-companies.seed';
import { seedDistributors } from './distributors.seed';
import { seedProducts } from './products.seed';
import { seedCustomers } from './customers.seed';
import { seedSales } from './sales.seed';
import { seedInstallments } from './installments.seed';
import { seedFormDefinitions } from './form-definitions.seed';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...\n');

  // Order matters — dependencies first
  const shops = await seedShops(prisma);
  console.log(`  Shops: ${shops.length} created`);

  const users = await seedUsers(prisma, shops);
  console.log(`  Users: ${users.length} created`);

  const categories = await seedCategories(prisma);
  console.log(`  Categories: ${categories.length} created`);

  const financeCompanies = await seedFinanceCompanies(prisma);
  console.log(`  Finance Companies: ${financeCompanies.length} created`);

  const distributors = await seedDistributors(prisma, categories);
  console.log(`  Distributors: ${distributors.length} created`);

  const products = await seedProducts(prisma, shops, categories, distributors);
  console.log(`  Products: ${products.length} created`);

  const customers = await seedCustomers(prisma, shops, users);
  console.log(`  Customers: ${customers.length} created`);

  const sales = await seedSales(prisma, shops, products, customers, users, financeCompanies);
  console.log(`  Sales: ${sales.length} created`);

  const installments = await seedInstallments(prisma, sales);
  console.log(`  Installment schedules: ${installments.length} created`);

  const forms = await seedFormDefinitions(prisma);
  console.log(`  Form definitions: ${forms.length} created`);

  console.log('\nSeeding complete!');
}

main()
  .catch((e) => {
    console.error('Seeding failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
