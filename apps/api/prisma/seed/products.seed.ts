import type { PrismaClient, Product, Shop, ProductCategory, Distributor } from '@prisma/client';

export async function seedProducts(
  prisma: PrismaClient,
  shops: Shop[],
  categories: ProductCategory[],
  distributors: Distributor[],
): Promise<Product[]> {
  // Stub — will be fully populated in Phase 2
  return [];
}
