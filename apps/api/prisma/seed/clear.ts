/**
 * Clears all business data from the database while keeping:
 *   - Shops
 *   - Users / UserShops
 *   - Categories + CategoryAttributes
 *   - FinanceCompanies
 *   - FormDefinitions + FormFields
 *   - AppSettings
 *
 * Use `clear-all.ts` to nuke EVERYTHING (including shops/users).
 *
 * Deletion order respects FK dependencies (children first).
 */
import { PrismaClient } from '@prisma/client';
import { assertSafeToDestroy } from './_guard';

assertSafeToDestroy('db:clear');

const prisma = new PrismaClient();

async function main() {
  console.log('Clearing business data...\n');

  // Most dependent first
  await prisma.installmentPayment.deleteMany();
  await prisma.installment.deleteMany();
  await prisma.employeeCollectionAssignment.deleteMany();
  await prisma.installmentSchedule.deleteMany();

  await prisma.saleRecordSanitized.deleteMany();
  await prisma.saleRecord.deleteMany();

  await prisma.interShopTransfer.deleteMany();
  await prisma.productAuditTrail.deleteMany();

  await prisma.purchasePayment.deleteMany();

  // Products reference purchases; null the FK first is not needed since we delete products too
  await prisma.product.deleteMany();
  await prisma.purchase.deleteMany();

  await prisma.customer.updateMany({ data: { guarantorId: null } });
  await prisma.customer.deleteMany();

  await prisma.bankTransaction.deleteMany();
  await prisma.bankAccount.deleteMany();

  await prisma.expense.deleteMany();

  await prisma.notification.deleteMany();
  await prisma.notificationToken.deleteMany();

  await prisma.auditLog.deleteMany();

  await prisma.employee.deleteMany();

  await prisma.refreshToken.deleteMany();

  // Distributor mapping
  await prisma.distributorCategory.deleteMany();
  await prisma.distributor.deleteMany();

  console.log('Business data cleared.');
  console.log('Preserved: shops, users, categories, finance companies, form definitions.');
}

main()
  .catch((e) => {
    console.error('Clear failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
