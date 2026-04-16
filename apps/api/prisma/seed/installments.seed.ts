import type { PrismaClient, SaleRecord, InstallmentSchedule } from '@prisma/client';

export async function seedInstallments(
  prisma: PrismaClient,
  sales: SaleRecord[],
): Promise<InstallmentSchedule[]> {
  // Installment schedules are now created directly in seedSales() for self_finance sales.
  // This function returns the existing schedules for reporting purposes.

  if (sales.length === 0) {
    return [];
  }

  const selfFinanceSaleIds = sales
    .filter((s) => s.saleType === 'self_finance')
    .map((s) => s.id);

  if (selfFinanceSaleIds.length === 0) {
    return [];
  }

  const schedules = await prisma.installmentSchedule.findMany({
    where: { saleId: { in: selfFinanceSaleIds } },
  });

  return schedules;
}
