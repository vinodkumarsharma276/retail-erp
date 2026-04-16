import type { PrismaClient, Shop, User } from '@prisma/client';
import bcrypt from 'bcryptjs';

const DEFAULT_PASSWORD = 'RetailERP@2026';

export async function seedUsers(prisma: PrismaClient, shops: Shop[]): Promise<User[]> {
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
  const users: User[] = [];

  for (const shop of shops) {
    const prefix = shop.code.toLowerCase();

    // 2 Admins per shop
    for (let i = 1; i <= 2; i++) {
      const user = await prisma.user.upsert({
        where: { username: `${prefix}_admin${i}` },
        update: {},
        create: {
          username: `${prefix}_admin${i}`,
          passwordHash,
          fullName: `${shop.name} Admin ${i}`,
          phone: `98765${String(shops.indexOf(shop)).padStart(2, '0')}${String(i).padStart(3, '0')}`,
          role: 'admin',
          isMobileOnly: false,
        },
      });
      await prisma.userShop.upsert({
        where: { userId_shopId: { userId: user.id, shopId: shop.id } },
        update: {},
        create: { userId: user.id, shopId: shop.id, isPrimary: true },
      });
      // Admins get access to all shops
      for (const otherShop of shops) {
        if (otherShop.id !== shop.id) {
          await prisma.userShop.upsert({
            where: { userId_shopId: { userId: user.id, shopId: otherShop.id } },
            update: {},
            create: { userId: user.id, shopId: otherShop.id, isPrimary: false },
          });
        }
      }
      users.push(user);
    }

    // 3 Accountants per shop
    for (let i = 1; i <= 3; i++) {
      const user = await prisma.user.upsert({
        where: { username: `${prefix}_acc${i}` },
        update: {},
        create: {
          username: `${prefix}_acc${i}`,
          passwordHash,
          fullName: `${shop.name} Accountant ${i}`,
          phone: `98766${String(shops.indexOf(shop)).padStart(2, '0')}${String(i).padStart(3, '0')}`,
          role: 'accountant',
          isMobileOnly: false,
        },
      });
      await prisma.userShop.upsert({
        where: { userId_shopId: { userId: user.id, shopId: shop.id } },
        update: {},
        create: { userId: user.id, shopId: shop.id, isPrimary: true },
      });
      // Accountants also get access to all shops
      for (const otherShop of shops) {
        if (otherShop.id !== shop.id) {
          await prisma.userShop.upsert({
            where: { userId_shopId: { userId: user.id, shopId: otherShop.id } },
            update: {},
            create: { userId: user.id, shopId: otherShop.id, isPrimary: false },
          });
        }
      }
      users.push(user);
    }

    // 2 Others per shop
    for (let i = 1; i <= 2; i++) {
      const user = await prisma.user.upsert({
        where: { username: `${prefix}_staff${i}` },
        update: {},
        create: {
          username: `${prefix}_staff${i}`,
          passwordHash,
          fullName: `${shop.name} Staff ${i}`,
          phone: `98767${String(shops.indexOf(shop)).padStart(2, '0')}${String(i).padStart(3, '0')}`,
          role: 'others',
          isMobileOnly: false,
        },
      });
      await prisma.userShop.upsert({
        where: { userId_shopId: { userId: user.id, shopId: shop.id } },
        update: {},
        create: { userId: user.id, shopId: shop.id, isPrimary: true },
      });
      users.push(user);
    }

    // 3 Employees per shop (mobile-only)
    for (let i = 1; i <= 3; i++) {
      const user = await prisma.user.upsert({
        where: { username: `${prefix}_emp${i}` },
        update: {},
        create: {
          username: `${prefix}_emp${i}`,
          passwordHash,
          fullName: `${shop.name} Employee ${i}`,
          phone: `98768${String(shops.indexOf(shop)).padStart(2, '0')}${String(i).padStart(3, '0')}`,
          role: 'employee',
          isMobileOnly: true,
        },
      });
      await prisma.userShop.upsert({
        where: { userId_shopId: { userId: user.id, shopId: shop.id } },
        update: {},
        create: { userId: user.id, shopId: shop.id, isPrimary: true },
      });
      users.push(user);
    }
  }

  return users;
}
