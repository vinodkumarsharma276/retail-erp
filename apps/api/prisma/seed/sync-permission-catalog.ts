/**
 * Bring every tenant's permission data up to the current catalog without
 * undoing anyone's customisation:
 *   1. Upsert every permission key in packages/shared-types/src/permissions.ts.
 *   2. Add ONLY the newly introduced defaults below to each tenant's system
 *      roles. Permissions an owner removed from a role on purpose stay removed.
 *
 * Idempotent. Usage:
 *   cd apps/api
 *   npx tsx prisma/seed/sync-permission-catalog.ts
 */
import { PrismaClient } from '@prisma/client';
import { PERMISSION_GROUPS } from '@retailerp/shared-types';

/**
 * Defaults added after roles were first seeded (2026-10-05).
 *
 * `distributors.delete` (2026-10-23) goes to admin and accountant, as the
 * owner asked: clearing duplicate suppliers out is bookkeeping, and the
 * accountant is who does it. Owner holds every permission regardless.
 */
const NEW_DEFAULTS: Record<string, string[]> = {
  owner: ['installments.revert_payment', 'purchases.create_unbilled', 'distributors.delete'],
  admin: [
    'roles.list',
    'installments.revert_payment',
    'purchases.create_unbilled',
    'distributors.delete',
  ],
  accountant: [
    'settings.view',
    'installments.revert_payment',
    'purchases.create_unbilled',
    'purchases.delete',
    'distributors.delete',
  ],
};

const prisma = new PrismaClient();

async function main() {
  for (const p of PERMISSION_GROUPS.flatMap((g) => g.permissions)) {
    await prisma.permission.upsert({
      where: { key: p.key },
      update: { module: p.module, description: p.description },
      create: { key: p.key, module: p.module, description: p.description },
    });
  }
  const permissionId = new Map((await prisma.permission.findMany({ select: { id: true, key: true } })).map((p) => [p.key, p.id]));

  let added = 0;
  for (const [code, keys] of Object.entries(NEW_DEFAULTS)) {
    const roles = await prisma.role.findMany({ where: { code }, select: { id: true, tenantId: true } });
    for (const role of roles) {
      for (const key of keys) {
        const id = permissionId.get(key);
        if (!id) throw new Error(`Unknown permission ${key}`);
        const res = await prisma.rolePermission.createMany({
          data: [{ tenantId: role.tenantId, roleId: role.id, permissionId: id }],
          skipDuplicates: true,
        });
        added += res.count;
      }
    }
  }
  console.log(`Permission catalog synced; ${added} role grants added.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
