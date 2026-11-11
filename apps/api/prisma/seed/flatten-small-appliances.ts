/**
 * One-off (owner decision 2026-11-11): small appliances are top-level product
 * types. Moves the children of "Small Appliances" (Iron, Mixer Grinder, Water
 * Purifier) to the top level, then switches "Small Appliances" off when
 * nothing is left in it — no active sub-types, products, register entries or
 * saved import decisions. Products keep their type; only its place changes.
 * Safe to re-run.
 *
 * Run via (in apps/api), for one tenant:
 *   npx tsx prisma/seed/flatten-small-appliances.ts vn
 */
import { prisma, unscopedPrisma } from '../../src/config/database.js';
import { tenantContext } from '../../src/config/tenant-context.js';
import { siblingClash } from '../../src/modules/categories/categories.service.js';

async function main() {
  const slug = process.argv[2];
  if (!slug) throw new Error('Give the tenant slug, e.g. vn');
  const tenant = await unscopedPrisma.tenant.findFirst({ where: { slug }, select: { id: true } });
  if (!tenant) throw new Error(`No tenant "${slug}"`);

  await tenantContext.runAs(tenant.id, async () => {
    const group = await prisma.productCategory.findFirst({ where: { parentId: null, name: { equals: 'Small Appliances', mode: 'insensitive' } } });
    if (!group) {
      console.log(`${slug}: no "Small Appliances" type; nothing to do`);
      return;
    }
    await prisma.$transaction(async (tx) => {
      const topLevel = await tx.productCategory.findMany({ where: { parentId: null }, select: { id: true, name: true, slug: true } });
      const children = await tx.productCategory.findMany({ where: { parentId: group.id } });
      for (const child of children) {
        const clash = siblingClash(topLevel, { name: child.name, slug: child.slug });
        if (clash) {
          console.log(`${slug}: left ${child.name} under Small Appliances — a top-level ${clash.name} already exists`);
          continue;
        }
        await tx.productCategory.update({ where: { id: child.id }, data: { parentId: null, level: 0, path: child.slug } });
        // Its own sub-types (if any) follow it.
        const below = await tx.productCategory.findMany({ where: { path: { startsWith: `${child.path}.` } } });
        for (const b of below) {
          await tx.productCategory.update({
            where: { id: b.id },
            data: { path: `${child.slug}${b.path.slice(child.path.length)}`, level: b.level - child.level },
          });
        }
        topLevel.push({ id: child.id, name: child.name, slug: child.slug });
        console.log(`${slug}: moved ${child.name} to the top level`);
      }
      const [activeChildren, products, entries, mappings] = await Promise.all([
        tx.productCategory.count({ where: { parentId: group.id, isActive: true } }),
        tx.product.count({ where: { categoryId: group.id } }),
        tx.customerSearchEntry.count({ where: { categoryId: group.id } }),
        tx.customerSearchProductMapping.count({ where: { categoryId: group.id } }),
      ]);
      if (activeChildren + products + entries + mappings === 0) {
        await tx.productCategory.update({ where: { id: group.id }, data: { isActive: false } });
        console.log(`${slug}: switched "Small Appliances" off (nothing left in it)`);
      } else {
        console.log(`${slug}: kept "Small Appliances" — ${activeChildren} sub-types, ${products} products, ${entries} entries, ${mappings} import decisions still use it`);
      }
    });
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => unscopedPrisma.$disconnect());
