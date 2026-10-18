/**
 * Sets up the product types that can be bought without a bill.
 *
 * The shops buy some goods off the books of the supplier who sold them —
 * furniture and almirahs to begin with. Those are real stock from a real
 * supplier, so they are recorded like any other purchase; what differs is
 * that there is no bill, so no tax, and the shop numbers the invoice itself.
 *
 * A type can be bought both ways. "Furniture" is marked `both` so it appears
 * in either workflow, and only types marked `unbilled` or `both` are offered
 * when adding a purchase without a bill.
 *
 * Idempotent. Run via:
 *   npx tsx prisma/seed/unbilled-purchase-types.ts
 */
import { PrismaClient } from '@prisma/client';

/** Types bought without a bill, with the letters their invoices carry. */
const UNBILLED_TYPES = [
  { name: 'Furniture', prefix: 'FURN', createIfMissing: false },
  { name: 'Almirah', prefix: 'ALMR', createIfMissing: true },
] as const;

const slugify = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

async function main() {
  const prisma = new PrismaClient();
  try {
    const tenants = await prisma.tenant.findMany({ select: { id: true, name: true } });
    if (tenants.length === 0) {
      console.log('No tenants — nothing to do.');
      return;
    }

    for (const tenant of tenants) {
      console.log(`\n${tenant.name}`);
      for (const type of UNBILLED_TYPES) {
        let category = await prisma.productCategory.findFirst({
          where: { tenantId: tenant.id, name: type.name },
          select: { id: true, name: true, purchaseModes: true },
        });

        if (!category && type.createIfMissing) {
          // Top level, beside Furniture rather than beneath it: the shop asks
          // for an almirah by name, not as a kind of furniture.
          const last = await prisma.productCategory.findFirst({
            where: { tenantId: tenant.id, parentId: null },
            orderBy: { displayOrder: 'desc' },
            select: { displayOrder: true },
          });
          const created = await prisma.productCategory.create({
            data: {
              tenantId: tenant.id,
              name: type.name,
              slug: slugify(type.name),
              parentId: null,
              level: 0,
              path: slugify(type.name),
              displayOrder: (last?.displayOrder ?? 0) + 1,
              isLeaf: true,
              isActive: true,
              purchaseModes: 'unbilled',
            },
            select: { id: true, name: true, purchaseModes: true },
          });
          console.log(`  + created ${created.name} (${created.purchaseModes})`);
          category = created;
        }

        if (!category) {
          console.log(`  ? ${type.name} not found and not created`);
          continue;
        }

        // A type already used for billed purchases becomes available in both
        // workflows rather than being moved out of the one it is in.
        const wanted = category.purchaseModes === 'unbilled' ? 'unbilled' : 'both';
        if (category.purchaseModes !== wanted) {
          await prisma.productCategory.update({
            where: { id: category.id },
            data: { purchaseModes: wanted },
          });
          console.log(`  ~ ${category.name}: ${category.purchaseModes} -> ${wanted}`);
        } else {
          console.log(`  = ${category.name}: ${wanted}`);
        }

        const series = await prisma.purchaseInvoiceSeries.findFirst({
          where: { tenantId: tenant.id, categoryId: category.id },
          select: { prefix: true, nextNumber: true },
        });
        if (series) {
          console.log(`    numbering ${series.prefix}, next ${series.nextNumber}`);
        } else {
          // Left for somebody to start: the first number is entered by hand so
          // it can carry on from whatever the written books already use.
          console.log(`    numbering not started yet (will use ${type.prefix})`);
        }
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
