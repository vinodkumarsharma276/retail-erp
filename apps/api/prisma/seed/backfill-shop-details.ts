/**
 * One-shot backfill: refresh address / phone fields on the existing shop
 * rows with the real-world values supplied by the owner. Idempotent —
 * matches by `code` (the unique business identifier).
 *
 * Run via:
 *   npx tsx prisma/seed/backfill-shop-details.ts
 */
import { PrismaClient } from '@prisma/client';

const updates = [
  {
    code: 'VE',
    addressLine1: 'A-2, Himalaya Vihar, Main Road Mangal Bazar',
    addressLine2: 'Khoda Colony',
    city: 'Ghaziabad',
    state: 'Uttar Pradesh',
    pincode: '201030',
    phone: '01202491643, 9345768374',
  },
  {
    code: 'NE',
    addressLine1: 'B-95, Janta Flats, Abhay Khand 1',
    addressLine2: 'Indrapuram',
    city: 'Ghaziabad',
    state: 'Uttar Pradesh',
    pincode: '201040',
    phone: '98765432123',
  },
  {
    code: 'VHA',
    addressLine1: 'Vandana Enclave',
    addressLine2: 'Khoda Colony',
    city: 'Ghaziabad',
    state: 'Uttar Pradesh',
    pincode: '349857',
    phone: '345343443, 7989597700, 3454324567',
  },
  {
    code: 'NHE',
    addressLine1: 'G-98, Behrampur',
    addressLine2: null,
    city: 'Ghaziabad',
    state: 'Uttar Pradesh',
    pincode: '110098',
    phone: '7447364747, 5768473648',
  },
] as const;

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log('Backfilling shop address/phone...');
    let updated = 0;
    for (const u of updates) {
      const existing = await prisma.shop.findUnique({ where: { code: u.code } });
      if (!existing) {
        console.warn(`  [skip] No shop with code ${u.code}`);
        continue;
      }
      await prisma.shop.update({
        where: { code: u.code },
        data: {
          addressLine1: u.addressLine1,
          addressLine2: u.addressLine2 ?? null,
          city: u.city,
          state: u.state,
          pincode: u.pincode,
          phone: u.phone,
        },
      });
      console.log(`  [ok] ${existing.name} (${u.code})`);
      updated++;
    }
    console.log(`Done. ${updated} shop(s) updated.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
