/**
 * Nukes EVERYTHING from the database — shops, users, categories, forms, etc.
 * After this, running `npm run db:seed` will recreate all baseline records.
 */
import { PrismaClient } from '@prisma/client';
import { assertSafeToDestroy } from './_guard';

assertSafeToDestroy('db:clear:all');

const prisma = new PrismaClient();

async function main() {
  console.log('Clearing ALL data (full wipe)...\n');

  // Business data (see clear.ts)
  await prisma.installmentPayment.deleteMany();
  await prisma.installment.deleteMany();
  await prisma.employeeCollectionAssignment.deleteMany();
  await prisma.installmentSchedule.deleteMany();
  await prisma.saleRecordSanitized.deleteMany();
  await prisma.saleRecord.deleteMany();
  await prisma.interShopTransfer.deleteMany();
  await prisma.productAuditTrail.deleteMany();
  await prisma.purchasePayment.deleteMany();
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
  await prisma.distributorCategory.deleteMany();
  await prisma.distributor.deleteMany();

  // Baseline data
  await prisma.appSetting.deleteMany();
  await prisma.formField.deleteMany();
  await prisma.formDefinition.deleteMany();
  await prisma.financeCompany.deleteMany();
  await prisma.categoryAttribute.deleteMany();
  // Categories have self-FK; delete children before parents
  await prisma.productCategory.deleteMany({ where: { isLeaf: true } });
  await prisma.productCategory.deleteMany();
  await prisma.userShop.deleteMany();
  await prisma.user.deleteMany();
  await prisma.shop.deleteMany();

  console.log('All data cleared. Run `npm run db:seed` to reseed.');
}

main()
  .catch((e) => {
    console.error('Clear-all failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
