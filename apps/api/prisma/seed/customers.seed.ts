import type { PrismaClient, Customer, Shop, User } from '@prisma/client';

export async function seedCustomers(
  prisma: PrismaClient,
  shops: Shop[],
  users: User[],
): Promise<Customer[]> {
  // Stub — will be fully populated in Phase 4
  return [];
}
