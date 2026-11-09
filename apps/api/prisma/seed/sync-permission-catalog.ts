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
 * `distributors.delete` and `distributors.merge` (2026-10-23) go to admin
 * and accountant, as the owner asked: clearing duplicate suppliers out is
 * bookkeeping, and the accountant is who does it. Owner holds every
 * permission regardless. `distributors.clear_payments` (2026-11) is owner-only.
 *
 * Customer Searching (2026-11): everyone but the field employee can search and
 * add entries; accountant also edits and exports; import and delete are owner/admin.
 */
const CUSTOMER_SEARCH_BASE = ['nav.customer_search', 'customer_search.list', 'customer_search.detail', 'customer_search.create'];
const CUSTOMER_SEARCH_ALL = [...CUSTOMER_SEARCH_BASE, 'customer_search.edit', 'customer_search.delete', 'customer_search.import', 'customer_search.export'];

const NEW_DEFAULTS: Record<string, string[]> = {
  owner: ['installments.revert_payment', 'purchases.create_unbilled', 'distributors.delete', 'distributors.merge', 'distributors.clear_payments', ...CUSTOMER_SEARCH_ALL],
  admin: [
    'roles.list',
    'installments.revert_payment',
    'purchases.create_unbilled',
    'distributors.delete',
    'distributors.merge',
    ...CUSTOMER_SEARCH_ALL,
  ],
  accountant: [
    'settings.view',
    'installments.revert_payment',
    'purchases.create_unbilled',
    'purchases.delete',
    'distributors.delete',
    'distributors.merge',
    ...CUSTOMER_SEARCH_BASE,
    'customer_search.edit',
    'customer_search.export',
  ],
  others: [...CUSTOMER_SEARCH_BASE],
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
