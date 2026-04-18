/**
 * One-off fix: link received-transfer destination products to their source-shop
 * distributor record. Finds products whose purchaseId is null and that have a
 * 'transferred_in' audit entry, and sets distributorId to the Distributor that
 * matches the source shop's GST number (creating it if missing).
 *
 * Safe to re-run; skips products that already have a distributor set.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function getOrCreateShopDistributor(tx: any, shop: any, createdBy?: string) {
  const existing = await tx.distributor.findFirst({
    where: { gstNumber: shop.gstNumber },
  });
  if (existing) return existing;
  return tx.distributor.create({
    data: {
      companyName: shop.name,
      contactPerson: shop.name,
      phone: shop.phone,
      email: shop.email ?? null,
      gstNumber: shop.gstNumber,
      panNumber: shop.panNumber,
      addressLine1: shop.addressLine1,
      addressLine2: shop.addressLine2 ?? null,
      city: shop.city,
      state: shop.state,
      pincode: shop.pincode,
      bankName: shop.bankName ?? null,
      bankAccountNumber: shop.bankAccountNumber ?? null,
      bankIfsc: shop.bankIfsc ?? null,
      bankBranch: shop.bankBranch ?? null,
      dynamicAttributes: { sourceType: 'shop', shopId: shop.id, shopCode: shop.code },
      isActive: true,
      createdBy: createdBy ?? null,
    },
  });
}

async function main() {
  console.log('Linking transferred-in products to source-shop distributors...\n');

  const candidates = await prisma.product.findMany({
    where: { distributorId: null, purchaseId: null },
    include: {
      auditTrail: {
        where: { eventType: 'transferred_in' },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });

  let fixed = 0;
  for (const p of candidates) {
    const audit = p.auditTrail[0];
    if (!audit?.fromShopId) continue;

    const fromShop = await prisma.shop.findUnique({ where: { id: audit.fromShopId } });
    if (!fromShop) continue;

    await prisma.$transaction(async (tx) => {
      const dist = await getOrCreateShopDistributor(tx, fromShop, audit.performedBy ?? undefined);
      await tx.product.update({
        where: { id: p.id },
        data: { distributorId: dist.id },
      });
    });

    console.log(`  Linked ${p.brand} ${p.modelNumber} -> ${fromShop.name} (${fromShop.code})`);
    fixed += 1;
  }

  console.log(`\nDone. Linked ${fixed} product${fixed === 1 ? '' : 's'}.`);
}

main()
  .catch((e) => {
    console.error('Link failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
