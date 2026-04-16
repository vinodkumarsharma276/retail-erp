import type { PrismaClient, SaleRecord, InstallmentSchedule } from '@prisma/client';

export async function seedInstallments(
  prisma: PrismaClient,
  sales: SaleRecord[],
): Promise<InstallmentSchedule[]> {
  // Stub — will be fully populated in Phase 5
  return [];
}
