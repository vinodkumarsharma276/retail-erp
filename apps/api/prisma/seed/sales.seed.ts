import type { PrismaClient, SaleRecord, Shop, Product, Customer, User, FinanceCompany } from '@prisma/client';

export async function seedSales(
  prisma: PrismaClient,
  shops: Shop[],
  products: Product[],
  customers: Customer[],
  users: User[],
  financeCompanies: FinanceCompany[],
): Promise<SaleRecord[]> {
  // Stub — will be fully populated in Phase 4
  return [];
}
