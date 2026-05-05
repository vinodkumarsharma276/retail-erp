/**
 * One-shot backfill: assign 1–2 deterministic 15-digit IMEI numbers to
 * every existing Mobile (Smartphone / Feature Phone) product that doesn't
 * already have `dynamicAttributes.imeiNumbers`. Idempotent — skips rows
 * that already carry the field.
 *
 * Also strips the legacy `imei` / `imei2` keys from `dynamicAttributes`
 * so the Product Detail view doesn't show them as orphan fields.
 *
 * Run via:
 *   npx tsx prisma/seed/backfill-mobile-imei-data.ts
 */
import { PrismaClient } from '@prisma/client';

const TARGET_SLUGS = ['smartphone', 'feature-phone'] as const;

function makeImei(seed: number, index: number): string {
  // Seeded pseudo-random 13-digit tail; "35" prefix mimics IMEI's TAC range.
  const tail = `${(seed * 9301 + index * 49297) >>> 0}`.padStart(13, '0').slice(-13);
  return `35${tail}`;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const cats = await prisma.productCategory.findMany({
      where: { slug: { in: [...TARGET_SLUGS] } },
      select: { id: true, slug: true },
    });
    if (cats.length === 0) {
      console.log('No mobile categories found — nothing to do.');
      return;
    }
    const catById = new Map(cats.map((c) => [c.id, c.slug] as const));

    const products = await prisma.product.findMany({
      where: { categoryId: { in: cats.map((c) => c.id) } },
      select: { id: true, categoryId: true, dynamicAttributes: true, serialNumber: true },
    });

    let added = 0;
    let skipped = 0;
    let cleaned = 0;
    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      const da = (p.dynamicAttributes ?? {}) as Record<string, unknown>;
      const hasMulti = Array.isArray(da.imeiNumbers) && (da.imeiNumbers as unknown[]).length > 0;

      // Promote legacy single-text values into the new array if present.
      const legacy: string[] = [];
      if (typeof da.imei === 'string' && da.imei.trim()) legacy.push(da.imei.trim());
      if (typeof da.imei2 === 'string' && da.imei2.trim()) legacy.push(da.imei2.trim());

      const next: Record<string, unknown> = { ...da };
      let changed = false;

      if (!hasMulti) {
        if (legacy.length > 0) {
          next.imeiNumbers = legacy;
        } else {
          // Brand-new IMEIs: smartphones get 2, feature phones randomly 1 or 2
          const slug = catById.get(p.categoryId);
          const numImeis = slug === 'feature-phone' && (i % 3 === 0) ? 1 : 2;
          const seed = (i + 1) * 1000 + (p.serialNumber?.charCodeAt(0) ?? 0);
          next.imeiNumbers = Array.from({ length: numImeis }, (_, k) => makeImei(seed, k));
        }
        added++;
        changed = true;
      } else {
        skipped++;
      }

      if ('imei' in next || 'imei2' in next) {
        delete next.imei;
        delete next.imei2;
        cleaned++;
        changed = true;
      }

      if (changed) {
        await prisma.product.update({
          where: { id: p.id },
          data: { dynamicAttributes: next as any },
        });
      }
    }

    console.log(
      `Done. Mobile products processed: ${products.length}. ` +
      `IMEIs added/promoted: ${added}, already-present: ${skipped}, legacy keys cleaned: ${cleaned}.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
