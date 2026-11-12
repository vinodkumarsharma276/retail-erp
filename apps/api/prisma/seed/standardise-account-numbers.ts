/**
 * One-off (owner decision 2026-11-12): write every register account number
 * the standard way — two letters, a space, the number ("BD-12", "BD012",
 * "DB-513." → "BD 12", "BD 12", "DB 513"). Numbers of another shape
 * (BK-73A, DE-452,53) are kept as written, lose their series number and are
 * flagged "Account number in an unusual format"; they are listed for a person.
 * Safe to re-run. Every change reaches the phones through the sync log.
 *
 * Run via (in apps/api):
 *   npx tsx prisma/seed/standardise-account-numbers.ts          (dry run)
 *   npx tsx prisma/seed/standardise-account-numbers.ts --apply
 */
import type { Prisma } from '@prisma/client';
import { parseAccountNumber } from '@retailerp/shared-utils';
import { prisma, unscopedPrisma } from '../../src/config/database.js';
import { tenantContext } from '../../src/config/tenant-context.js';
import { refreshIssues } from '../../src/modules/customer-search/customer-search.issues.js';

const CHUNK = 2000;

async function main() {
  const apply = process.argv.includes('--apply');
  const tenants = await unscopedPrisma.tenant.findMany({ select: { id: true, slug: true } });
  for (const tenant of tenants) {
    await tenantContext.runAs(tenant.id, async () => {
      const entries = await prisma.customerSearchEntry.findMany({ select: { id: true, accountNumber: true, prefix: true, seriesNo: true } });
      if (!entries.length) return;
      const changes = entries
        .map((e) => ({ e, p: parseAccountNumber(e.accountNumber) }))
        .filter(({ e, p }) => p.accountNumber !== e.accountNumber || p.prefix !== e.prefix || p.seriesNo !== e.seriesNo);
      const odd = entries.filter((e) => e.accountNumber && parseAccountNumber(e.accountNumber).seriesNo == null);
      const renamed = changes.filter(({ e, p }) => p.accountNumber !== e.accountNumber).length;
      console.log(`${tenant.slug}: ${entries.length} entries; ${renamed} rewritten, ${changes.length - renamed} only re-read; ${odd.length} not in the standard shape`);
      for (const e of odd.sort((a, b) => a.accountNumber.localeCompare(b.accountNumber))) console.log(`  unusual: ${e.accountNumber}`);
      if (!apply || !changes.length) return;
      for (let i = 0; i < changes.length; i += CHUNK) {
        const part = changes.slice(i, i + CHUNK);
        await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`
            UPDATE customer_search_entries e
               SET account_number = v.account_number, prefix = v.prefix, series_no = v.series_no, updated_at = now()
              FROM unnest(${part.map((c) => c.e.id)}::text[], ${part.map((c) => c.p.accountNumber)}::text[],
                          ${part.map((c) => c.p.prefix)}::text[], ${part.map((c) => c.p.seriesNo)}::int[])
                   AS v(id, account_number, prefix, series_no)
             WHERE e.id = v.id AND e.tenant_id = ${tenant.id}`;
          await refreshIssues(tx as Prisma.TransactionClient, { ids: part.map((c) => c.e.id) });
        }, { timeout: 300_000 });
      }
      console.log(`${tenant.slug}: saved`);
    });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => unscopedPrisma.$disconnect());
