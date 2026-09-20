/**
 * One-shot backfill: add the `imeiNumbers` (multi_text) category attribute
 * to the Smartphone and Feature Phone leaf categories so the Purchase form
 * shows IMEI input(s) when adding mobile inventory.
 *
 * Idempotent — checks for an existing attribute with the same name first.
 *
 * Run via:
 *   npx tsx prisma/seed/backfill-mobile-imei.ts
 */
import { PrismaClient } from '@prisma/client';

const TARGET_SLUGS = ['smartphone', 'feature-phone'] as const;

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log('Adding IMEI attribute to mobile categories...');
    let added = 0;
    let skipped = 0;
    for (const slug of TARGET_SLUGS) {
      const category = await prisma.productCategory.findFirst({
        where: { slug },
      });
      if (!category) {
        console.warn(`  [skip] No category with slug '${slug}'`);
        continue;
      }

      const existing = await prisma.categoryAttribute.findFirst({
        where: { categoryId: category.id, attributeName: 'imeiNumbers' },
      });
      if (existing) {
        console.log(`  [ok] ${category.name} already has imeiNumbers`);
        skipped++;
        continue;
      }

      await prisma.categoryAttribute.create({
        data: {
          categoryId: category.id,
          attributeName: 'imeiNumbers',
          attributeLabel: 'IMEI Number',
          attributeType: 'multi_text' as any,
          isRequired: true,
          // 15-digit IMEI per row, 1–3 rows (single SIM, dual SIM, eSIM hybrid)
          validationRules: {
            pattern: '^\\d{15}$',
            patternMessage: 'IMEI must be 15 digits',
            minItems: 1,
            maxItems: 3,
          } as any,
          options: undefined,
          displayOrder: 0,
          isActive: true,
        },
      });
      console.log(`  [add] ${category.name}: imeiNumbers (multi_text, 1–3 entries)`);
      added++;
    }
    console.log(`Done. Added: ${added}, already-present: ${skipped}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
