/**
 * One-shot cleanup: remove the legacy single-text `imei` and `imei2`
 * category attributes that were superseded by the new `multi_text`
 * `imeiNumbers` attribute. Leaves any product `dynamicAttributes.imei` /
 * `imei2` JSON keys untouched (we'll migrate them in a follow-up backfill).
 *
 * Run via:
 *   npx tsx prisma/seed/cleanup-legacy-imei-attrs.ts
 */
import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const result = await prisma.categoryAttribute.deleteMany({
      where: { attributeName: { in: ['imei', 'imei2'] } },
    });
    console.log(`Removed ${result.count} legacy IMEI category attribute row(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
