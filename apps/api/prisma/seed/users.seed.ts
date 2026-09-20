import type { PrismaClient, Shop, User } from '@prisma/client';
import bcrypt from 'bcryptjs';

const DEFAULT_PASSWORD = 'RetailERP@2026';

interface SystemRoleMap {
  owner?: string;
  admin?: string;
  accountant?: string;
  others?: string;
  employee?: string;
}

async function loadRoleIds(prisma: PrismaClient, tenantId: string): Promise<SystemRoleMap> {
  const rows = await prisma.role.findMany({
    where: { tenantId, code: { in: ['owner', 'admin', 'accountant', 'others', 'employee'] } },
    select: { id: true, code: true },
  });
  const map: SystemRoleMap = {};
  for (const r of rows) (map as Record<string, string>)[r.code] = r.id;
  return map;
}

export async function seedUsers(prisma: PrismaClient, shops: Shop[]): Promise<User[]> {
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
  const users: User[] = [];
  const tenantId = shops[0]?.tenantId;
  if (!tenantId) return users;

  const roleIds = await loadRoleIds(prisma, tenantId);

  // ------------------------------------------------------------------------
  // 2 OWNERS â€” full access across every shop. Their roleId points to the
  // Owner system role which holds every permission. Credentials printed at
  // the end of the seed run.
  // ------------------------------------------------------------------------
  const owners = [
    { username: 'vinod_owner', fullName: 'Vinod Sharma (Owner)', phone: '9876500001' },
    { username: 'nishant_owner', fullName: 'Nishant Sharma (Owner)', phone: '9876500002' },
  ];
  for (const o of owners) {
    const user = await prisma.user.upsert({
      where: { tenantId_username: { tenantId, username: o.username } },
      update: { roleId: roleIds.owner ?? null, role: 'owner' },
      create: {
        tenantId,
        username: o.username,
        passwordHash,
        fullName: o.fullName,
        phone: o.phone,
        role: 'owner',
        roleId: roleIds.owner ?? null,
        isMobileOnly: false,
      },
    });
    for (const shop of shops) {
      await prisma.userShop.upsert({
        where: { userId_shopId: { userId: user.id, shopId: shop.id } },
        update: {},
        create: { tenantId, userId: user.id, shopId: shop.id, isPrimary: shop.id === shops[0]?.id },
      });
    }
    users.push(user);
  }

  for (const shop of shops) {
    const prefix = shop.code.toLowerCase();

    // 2 Admins per shop
    for (let i = 1; i <= 2; i++) {
      const user = await prisma.user.upsert({
        where: { tenantId_username: { tenantId, username: `${prefix}_admin${i}` } },
        update: { roleId: roleIds.admin ?? null },
        create: {
          tenantId,
          username: `${prefix}_admin${i}`,
          passwordHash,
          fullName: `${shop.name} Admin ${i}`,
          phone: `98765${String(shops.indexOf(shop)).padStart(2, '0')}${String(i).padStart(3, '0')}`,
          role: 'admin',
          roleId: roleIds.admin ?? null,
          isMobileOnly: false,
        },
      });
      await prisma.userShop.upsert({
        where: { userId_shopId: { userId: user.id, shopId: shop.id } },
        update: {},
        create: { tenantId, userId: user.id, shopId: shop.id, isPrimary: true },
      });
      // Admins get access to all shops
      for (const otherShop of shops) {
        if (otherShop.id !== shop.id) {
          await prisma.userShop.upsert({
            where: { userId_shopId: { userId: user.id, shopId: otherShop.id } },
            update: {},
            create: { tenantId, userId: user.id, shopId: otherShop.id, isPrimary: false },
          });
        }
      }
      users.push(user);
    }

    // 3 Accountants per shop
    for (let i = 1; i <= 3; i++) {
      const user = await prisma.user.upsert({
        where: { tenantId_username: { tenantId, username: `${prefix}_acc${i}` } },
        update: { roleId: roleIds.accountant ?? null },
        create: {
          tenantId,
          username: `${prefix}_acc${i}`,
          passwordHash,
          fullName: `${shop.name} Accountant ${i}`,
          phone: `98766${String(shops.indexOf(shop)).padStart(2, '0')}${String(i).padStart(3, '0')}`,
          role: 'accountant',
          roleId: roleIds.accountant ?? null,
          isMobileOnly: false,
        },
      });
      await prisma.userShop.upsert({
        where: { userId_shopId: { userId: user.id, shopId: shop.id } },
        update: {},
        create: { tenantId, userId: user.id, shopId: shop.id, isPrimary: true },
      });
      // Accountants also get access to all shops
      for (const otherShop of shops) {
        if (otherShop.id !== shop.id) {
          await prisma.userShop.upsert({
            where: { userId_shopId: { userId: user.id, shopId: otherShop.id } },
            update: {},
            create: { tenantId, userId: user.id, shopId: otherShop.id, isPrimary: false },
          });
        }
      }
      users.push(user);
    }

    // 2 Others per shop
    for (let i = 1; i <= 2; i++) {
      const user = await prisma.user.upsert({
        where: { tenantId_username: { tenantId, username: `${prefix}_staff${i}` } },
        update: { roleId: roleIds.others ?? null },
        create: {
          tenantId,
          username: `${prefix}_staff${i}`,
          passwordHash,
          fullName: `${shop.name} Staff ${i}`,
          phone: `98767${String(shops.indexOf(shop)).padStart(2, '0')}${String(i).padStart(3, '0')}`,
          role: 'others',
          roleId: roleIds.others ?? null,
          isMobileOnly: false,
        },
      });
      await prisma.userShop.upsert({
        where: { userId_shopId: { userId: user.id, shopId: shop.id } },
        update: {},
        create: { tenantId, userId: user.id, shopId: shop.id, isPrimary: true },
      });
      users.push(user);
    }

    // 3 Employees per shop (mobile-only)
    for (let i = 1; i <= 3; i++) {
      const user = await prisma.user.upsert({
        where: { tenantId_username: { tenantId, username: `${prefix}_emp${i}` } },
        update: { roleId: roleIds.employee ?? null },
        create: {
          tenantId,
          username: `${prefix}_emp${i}`,
          passwordHash,
          fullName: `${shop.name} Employee ${i}`,
          phone: `98768${String(shops.indexOf(shop)).padStart(2, '0')}${String(i).padStart(3, '0')}`,
          role: 'employee',
          roleId: roleIds.employee ?? null,
          isMobileOnly: true,
        },
      });
      await prisma.userShop.upsert({
        where: { userId_shopId: { userId: user.id, shopId: shop.id } },
        update: {},
        create: { tenantId, userId: user.id, shopId: shop.id, isPrimary: true },
      });
      users.push(user);
    }
  }

  return users;
}

export const SEED_DEFAULT_PASSWORD = DEFAULT_PASSWORD;
export const SEED_OWNER_USERNAMES = ['vinod_owner', 'nishant_owner'];

