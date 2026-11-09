/**
 * One-off: work out the "Needs review" problems for register entries saved
 * before entries carried them (Customer Searching, 2026-11). Safe to re-run:
 * only entries whose list changes are written.
 *
 * Run via (in apps/api):
 *   npx tsx prisma/seed/backfill-customer-search-issues.ts
 */
import type { Prisma } from '@prisma/client';
import { prisma, unscopedPrisma } from '../../src/config/database.js';
import { tenantContext } from '../../src/config/tenant-context.js';
import { refreshIssues } from '../../src/modules/customer-search/customer-search.issues.js';

const CHUNK = 500;

async function main() {
  const tenants = await unscopedPrisma.tenant.findMany({ select: { id: true, slug: true } });
  for (const tenant of tenants) {
    await tenantContext.runAs(tenant.id, async () => {
      const ids = (await prisma.customerSearchEntry.findMany({ select: { id: true } })).map((e) => e.id);
      for (let i = 0; i < ids.length; i += CHUNK) {
        await prisma.$transaction((tx) => refreshIssues(tx as Prisma.TransactionClient, { ids: ids.slice(i, i + CHUNK) }), { timeout: 120_000 });
      }
      const flagged = await prisma.customerSearchEntry.count({ where: { NOT: { issues: { isEmpty: true } } } });
      console.log(`${tenant.slug}: ${ids.length} entries checked, ${flagged} need review`);
    });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => unscopedPrisma.$disconnect());
