/**
 * Standalone idempotent script: ensures RBAC tables (permissions + system
 * roles) and the 2 Owner users exist, without touching any other data.
 *
 * Run:  npm run db:seed:rbac --workspace=apps/api
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { seedRolesAndPermissions } from './roles-permissions.seed';

const prisma = new PrismaClient();
const DEFAULT_PASSWORD = 'RetailERP@2026';

const OWNERS = [
  { username: 'vinod_owner', fullName: 'Vinod Sharma (Owner)', phone: '9876500001' },
  { username: 'nishant_owner', fullName: 'Nishant Sharma (Owner)', phone: '9876500002' },
];

async function main() {
  console.log('Seeding RBAC catalog + system roles...');
  const summary = await seedRolesAndPermissions(prisma);
  console.log(`  Permissions: ${summary.permissions}, Roles: ${summary.roles}`);

  const ownerRole = await prisma.role.findUnique({ where: { code: 'owner' } });
  if (!ownerRole) throw new Error('Owner role missing after seed');

  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
  const shops = await prisma.shop.findMany({ select: { id: true } });

  for (const o of OWNERS) {
    const user = await prisma.user.upsert({
      where: { username: o.username },
      update: { roleId: ownerRole.id, role: 'owner', isActive: true },
      create: {
        username: o.username,
        passwordHash,
        fullName: o.fullName,
        phone: o.phone,
        role: 'owner',
        roleId: ownerRole.id,
        isMobileOnly: false,
      },
    });
    for (const s of shops) {
      await prisma.userShop.upsert({
        where: { userId_shopId: { userId: user.id, shopId: s.id } },
        update: {},
        create: { userId: user.id, shopId: s.id, isPrimary: s.id === shops[0]?.id },
      });
    }
  }

  console.log('\nOWNER CREDENTIALS (full access, all shops):');
  for (const o of OWNERS) {
    console.log(`  ${o.username.padEnd(16)}  /  ${DEFAULT_PASSWORD}`);
  }

  // Backfill roleId for every user that still has only the legacy enum.
  // Each user gets the system role whose `code` matches their `role` enum.
  console.log('\nBackfilling roleId for legacy users...');
  const systemRoles = await prisma.role.findMany({
    where: { code: { in: ['owner', 'admin', 'accountant', 'others', 'employee'] } },
    select: { id: true, code: true },
  });
  const codeToId = new Map(systemRoles.map((r) => [r.code, r.id]));
  let backfilled = 0;
  for (const [code, roleId] of codeToId) {
    const result = await prisma.user.updateMany({
      where: { role: code as any, roleId: null },
      data: { roleId },
    });
    if (result.count > 0) {
      console.log(`  ${code.padEnd(12)} → ${result.count} user(s) linked`);
      backfilled += result.count;
    }
  }
  console.log(`Backfill complete: ${backfilled} user(s) updated.`);
}

main()
  .catch((e) => {
    console.error('Failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
