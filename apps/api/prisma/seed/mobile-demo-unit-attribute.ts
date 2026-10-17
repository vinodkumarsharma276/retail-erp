/**
 * Adds a "Display / demo unit" attribute to the phone categories.
 *
 * Purchase registers contain shop display pieces alongside sellable stock —
 * "DUMMY - REDMI 17 5G - BLUE", "REDMI 17 5G (6+128) ORANGE - DEMO". They
 * were genuinely bought and belong on the invoice, but they cannot be sold as
 * new. Making it a category attribute puts it on the product form as a plain
 * tick box, so it is set deliberately rather than inferred later from a name.
 *
 * The sheet importer sets the same key on units it recognises as display
 * pieces, so an imported dummy and one entered by hand look identical.
 *
 * Idempotent. Run via:
 *   npx tsx prisma/seed/mobile-demo-unit-attribute.ts
 */
import { PrismaClient } from '@prisma/client';

const TARGET_SLUGS = ['mobile', 'smartphone', 'feature-phone'] as const;

const ATTRIBUTE = {
  attributeName: 'isDemoUnit',
  attributeLabel: 'Display / demo unit',
  attributeType: 'checkbox' as const,
  isRequired: false,
  displayOrder: 90,
};

async function main() {
  const prisma = new PrismaClient();
  try {
    const categories = await prisma.productCategory.findMany({
      where: { slug: { in: [...TARGET_SLUGS] } },
      select: { id: true, slug: true, name: true, tenantId: true },
    });
    if (categories.length === 0) {
      console.log('No phone categories found — nothing to do.');
      return;
    }

    let added = 0;
    let already = 0;
    for (const category of categories) {
      const existing = await prisma.categoryAttribute.findFirst({
        where: { categoryId: category.id, attributeName: ATTRIBUTE.attributeName },
        select: { id: true },
      });
      if (existing) {
        already += 1;
        continue;
      }
      await prisma.categoryAttribute.create({
        data: { ...ATTRIBUTE, categoryId: category.id, tenantId: category.tenantId, isActive: true },
      });
      added += 1;
      console.log(`  + ${category.name} (${category.slug})`);
    }

    console.log(`\nDisplay/demo attribute: ${added} added, ${already} already present.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
