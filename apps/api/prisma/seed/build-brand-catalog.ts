/**
 * One-off (owner decision 2026-11-13): build the Product type → Brand → Model
 * catalog that feeds the Brand and Model dropdowns, and write the register's
 * misspelt makes one way (WHIRLPHOOL, WHIR → WHIRLPOOL; SAM → SAMSUNG; cells
 * naming several makes get each one corrected: "TRU/LUM" → "TRUFAST, LUMINOUS").
 * The spellings come from BRAND_ALIASES in packages/shared-utils/src/brand-names.ts.
 *
 * The catalog is filled from each type's brand list, stock products and the
 * register. Safe to re-run (after adding aliases, for example). Corrected
 * entries reach the phones through the sync log.
 *
 * Run via (in apps/api):
 *   npx tsx prisma/seed/build-brand-catalog.ts [report.txt]           (dry run)
 *   npx tsx prisma/seed/build-brand-catalog.ts [report.txt] --apply
 */
import { writeFileSync } from 'node:fs';
import { brandKey, canonicalBrand, isCatalogBrand, modelKey, NOT_BRANDS } from '@retailerp/shared-utils';
import { prisma, unscopedPrisma } from '../../src/config/database.js';
import { tenantContext } from '../../src/config/tenant-context.js';
import { catalogService, type CatalogItem } from '../../src/modules/catalog/catalog.service.js';

function optionText(o: unknown): string {
  return String(o !== null && typeof o === 'object' ? ((o as Record<string, unknown>).value ?? (o as Record<string, unknown>).label ?? '') : (o ?? ''));
}

async function main() {
  const apply = process.argv.includes('--apply');
  const reportPath = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const report: string[] = [];
  const say = (line: string) => {
    console.log(line);
    report.push(line);
  };
  const tenants = await unscopedPrisma.tenant.findMany({ select: { id: true, slug: true } });
  for (const tenant of tenants) {
    await tenantContext.runAs(tenant.id, async () => {
      // 1. One spelling per make on the register.
      const stored = await prisma.customerSearchEntry.groupBy({ by: ['brand'], _count: { _all: true }, where: { brand: { not: null } } });
      const fixes = stored
        .map((g) => ({ from: g.brand!, to: canonicalBrand(g.brand) || null, count: g._count._all }))
        .filter((f) => f.to !== f.from);
      const merged = new Map<string, { from: string; count: number }[]>();
      const combos: typeof fixes = [];
      const other: typeof fixes = [];
      for (const f of fixes) {
        if (f.to && isCatalogBrand(f.to)) merged.set(f.to, [...(merged.get(f.to) ?? []), f]);
        else if (f.to?.includes(', ')) combos.push(f);
        else other.push(f);
      }
      const notMakes = stored.filter((g) => NOT_BRANDS.has(brandKey(g.brand)));
      const entriesFixed = fixes.reduce((n, f) => n + f.count, 0);
      say(`${tenant.slug}: ${stored.length} brand spellings on the register; ${fixes.length} rewritten (${entriesFixed} entries)`);
      if (fixes.length) {
        say('  Merged into one make:');
        for (const [to, list] of [...merged].sort(([a], [b]) => a.localeCompare(b))) {
          say(`    ${to}  ←  ${list.sort((a, b) => b.count - a.count).map((f) => `${f.from} (${f.count})`).join(', ')}`);
        }
        say('  Several makes in one cell, each corrected:');
        for (const f of combos.sort((a, b) => a.from.localeCompare(b.from))) say(`    ${f.from} (${f.count})  →  ${f.to}`);
        if (other.length) {
          say('  Tidied (stray marks removed or cleared):');
          for (const f of other.sort((a, b) => a.from.localeCompare(b.from))) say(`    ${f.from} (${f.count})  →  ${f.to ?? '(blank)'}`);
        }
      }
      if (notMakes.length) {
        say(`  Not makes, left on the entry but not offered as a brand: ${notMakes.map((g) => `${g.brand} (${g._count._all})`).join(', ')}`);
      }

      // 2. The catalog.
      const [attributes, products, entries] = await Promise.all([
        prisma.categoryAttribute.findMany({ where: { attributeName: 'brand' }, select: { categoryId: true, options: true } }),
        prisma.product.findMany({ select: { categoryId: true, brand: true, modelNumber: true } }),
        prisma.customerSearchEntry.findMany({ where: { categoryId: { not: null }, brand: { not: null } }, select: { categoryId: true, brand: true, model: true } }),
      ]);
      const items: CatalogItem[] = [
        ...attributes.flatMap((a) => (Array.isArray(a.options) ? a.options.map((o) => ({ categoryId: a.categoryId, brand: optionText(o) })) : [])),
        ...products.map((p) => ({ categoryId: p.categoryId, brand: p.brand, model: p.modelNumber })),
        ...entries.map((e) => ({ categoryId: e.categoryId, brand: canonicalBrand(e.brand), model: e.model })),
      ];
      const brandPairs = new Set<string>();
      const modelTriples = new Set<string>();
      for (const i of items) {
        if (!i.categoryId || !isCatalogBrand(i.brand)) continue;
        const b = `${i.categoryId}|${brandKey(canonicalBrand(i.brand))}`;
        brandPairs.add(b);
        if (modelKey(i.model)) modelTriples.add(`${b}|${modelKey(i.model)}`);
      }
      say(`  Catalog: ${brandPairs.size} type → brand pairs, ${modelTriples.size} models (from ${attributes.length} brand lists, ${products.length} products, ${entries.length} register entries)`);

      if (!apply) return;
      if (fixes.length) {
        await prisma.$transaction(async (tx) => {
          for (const f of fixes) await tx.customerSearchEntry.updateMany({ where: { brand: f.from }, data: { brand: f.to } });
        }, { timeout: 300_000 });
      }
      await prisma.$transaction((tx) => catalogService.learn(items, tx), { timeout: 300_000 });
      const [brands, models] = await Promise.all([prisma.catalogBrand.count(), prisma.catalogModel.count()]);
      say(`  Saved: ${fixes.length} spellings rewritten; catalog now ${brands} brands, ${models} models`);
    });
  }
  if (reportPath) writeFileSync(reportPath, `${report.join('\n')}\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => unscopedPrisma.$disconnect());
