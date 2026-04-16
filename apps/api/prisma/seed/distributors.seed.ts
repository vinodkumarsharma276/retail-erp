import type { PrismaClient, Distributor, ProductCategory } from '@prisma/client';

export async function seedDistributors(
  prisma: PrismaClient,
  categories: ProductCategory[],
): Promise<Distributor[]> {
  // Stub — will be fully populated in Phase 3
  return [];
}
