/**
 * One-off: remove sanitized sale copies that should no longer exist.
 *
 * Rule (owner, 2026-10-05): only self-finance sales have a second,
 * sanitized copy. Cash, part-payment, NBFC and transfer sales are shown as
 * they are and have one record. Copies for those sales are derived data —
 * the real record holds everything — so removing them loses nothing.
 *
 * Also creates a missing copy for any self-finance sale that lacks one.
 *
 * Dry run by default; pass --apply to change data.
 *   cd apps/api
 *   npx tsx prisma/seed/prune-sanitized-copies.ts          # report
 *   npx tsx prisma/seed/prune-sanitized-copies.ts --apply  # do it
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');

async function main() {
  const copies = await prisma.saleRecordSanitized.findMany({ select: { id: true } });
  const real = await prisma.saleRecord.findMany({
    where: { id: { in: copies.map((c) => c.id) } },
    select: { id: true, saleType: true },
  });
  const typeById = new Map(real.map((r) => [r.id, r.saleType]));
  const extra = copies.filter((c) => typeById.get(c.id) !== 'self_finance').map((c) => c.id);

  const selfFinance = await prisma.saleRecord.findMany({
    where: { saleType: 'self_finance' },
    select: {
      id: true, tenantId: true, saleNumber: true, ledgerNumber: true, shopId: true, productId: true,
      customerId: true, saleDate: true, sellingPrice: true, totalAmount: true, createdBy: true,
    },
  });
  const haveCopy = new Set(copies.map((c) => c.id));
  const missing = selfFinance.filter((s) => !haveCopy.has(s.id));

  const byType: Record<string, number> = {};
  for (const id of extra) byType[typeById.get(id) ?? 'sale deleted'] = (byType[typeById.get(id) ?? 'sale deleted'] ?? 0) + 1;
  console.log(`Copies: ${copies.length}. Not self-finance (to remove): ${extra.length}`, byType);
  console.log(`Self-finance sales: ${selfFinance.length}. Missing a copy (to create): ${missing.length}`);

  if (!apply) {
    console.log('Dry run — nothing changed. Re-run with --apply.');
    return;
  }
  await prisma.$transaction([
    prisma.saleRecordSanitized.deleteMany({ where: { id: { in: extra } } }),
    prisma.saleRecordSanitized.createMany({
      data: missing.map((s) => ({
        ...s, saleType: 'full_payment', paymentMode: 'cash',
      })),
    }),
  ]);
  console.log(`Removed ${extra.length}, created ${missing.length}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
