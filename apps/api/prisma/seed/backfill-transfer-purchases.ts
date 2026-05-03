/**
 * Backfill: create a Purchase record on the destination shop's books for
 * every received inter-shop transfer whose cloned destination product has
 * `purchaseId = null`. Without this, the destination shop's Products list
 * shows a blank "Date of Purchase" for items that arrived via transfer.
 *
 * Idempotent: skips transfers whose destination product already has a
 * purchase linked.
 *
 * Run:
 *   cd apps/api ; npx tsx prisma/seed/backfill-transfer-purchases.ts
 */
import { PrismaClient } from '@prisma/client';
import './_guard';

const prisma = new PrismaClient();

async function getOrCreateShopDistributor(fromShop: {
  id: string;
  code: string;
  name: string;
  gstNumber?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
}) {
  // Match the heuristic in transfers.service.ts: identify by gstNumber
  // when available, otherwise by code-based unique companyName.
  const companyName = `${fromShop.name} (Inter-shop ${fromShop.code})`;
  if (fromShop.gstNumber) {
    const existing = await prisma.distributor.findFirst({
      where: { gstNumber: fromShop.gstNumber },
    });
    if (existing) return existing;
  }
  const byName = await prisma.distributor.findFirst({
    where: { companyName },
  });
  if (byName) return byName;

  return prisma.distributor.create({
    data: {
      companyName,
      contactPerson: fromShop.name,
      phone: fromShop.phone ?? '0000000000',
      email: fromShop.email ?? null,
      gstNumber: fromShop.gstNumber ?? null,
      address: fromShop.address ?? null,
      city: fromShop.city ?? null,
      state: fromShop.state ?? null,
      pincode: fromShop.pincode ?? null,
      paymentTerms: 'net_30',
      isActive: true,
    },
  });
}

async function main() {
  console.log('Backfilling Purchase records for received inter-shop transfers…\n');

  // Find all received transfers
  const transfers = await prisma.interShopTransfer.findMany({
    where: { status: 'received' },
    include: {
      fromShop: true,
      toShop: true,
      product: true,
    },
    orderBy: { receivedAt: 'asc' },
  });

  console.log(`Found ${transfers.length} received transfers to inspect.\n`);

  let created = 0;
  let skipped = 0;

  for (const t of transfers) {
    // The destination product is a clone of the source product — same serial
    // number, but in the destination shop and currently in_stock (or sold,
    // if it's been on-sold since). Find it.
    if (!t.product) {
      console.log(`  ⚠️  Transfer ${t.id}: source product missing, skipping.`);
      continue;
    }

    const destProduct = await prisma.product.findFirst({
      where: {
        shopId: t.toShopId,
        serialNumber: t.product.serialNumber,
        // Same brand/model just to be safe in the rare case of duplicate
        // serial numbers across categories.
        brand: t.product.brand,
        modelNumber: t.product.modelNumber,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!destProduct) {
      console.log(
        `  ⚠️  Transfer ${t.id} (${t.product.brand} ${t.product.modelNumber} / ` +
          `SN: ${t.product.serialNumber ?? '—'}): no destination product found, skipping.`,
      );
      continue;
    }

    if (destProduct.purchaseId) {
      skipped += 1;
      continue;
    }

    const transferPrice =
      t.transferPrice != null ? Number(t.transferPrice) : Number(t.product.purchasePrice);
    const transferGstAmount = t.gstAmount != null ? Number(t.gstAmount) : 0;
    const netAmount = Math.max(0, transferPrice - transferGstAmount);
    const invoiceNumber = t.invoiceNumber ?? `TRF-${t.id.slice(0, 8)}`;
    const invoiceDate = t.receivedAt ?? t.transferDate ?? t.createdAt;

    const distributor = await getOrCreateShopDistributor({
      id: t.fromShop.id,
      code: t.fromShop.code,
      name: t.fromShop.name,
      gstNumber: (t.fromShop as any).gstNumber ?? null,
      phone: (t.fromShop as any).phone ?? null,
      email: (t.fromShop as any).email ?? null,
      address: (t.fromShop as any).address ?? null,
      city: (t.fromShop as any).city ?? null,
      state: (t.fromShop as any).state ?? null,
      pincode: (t.fromShop as any).pincode ?? null,
    });

    const purchase = await prisma.purchase.create({
      data: {
        shopId: t.toShopId,
        distributorId: distributor.id,
        invoiceNumber,
        invoiceDate,
        totalAmount: transferPrice,
        gstAmount: transferGstAmount,
        discountAmount: 0,
        netAmount,
        amountPaid: 0,
        paymentStatus: 'pending',
        notes:
          `Backfilled from inter-shop transfer received from ${t.fromShop.name} ` +
          `(${t.fromShop.code}). Transfer ID: ${t.id}.`,
        createdBy: t.receivedBy ?? null,
      },
    });

    await prisma.product.update({
      where: { id: destProduct.id },
      data: { purchaseId: purchase.id, distributorId: distributor.id },
    });

    created += 1;
    console.log(
      `  ✓  ${t.product.brand} ${t.product.modelNumber} (SN: ${t.product.serialNumber ?? '—'}): ` +
        `created Purchase ${purchase.id} on ${invoiceDate.toISOString().split('T')[0]}`,
    );
  }

  console.log(`\nDone. Created: ${created}, already linked: ${skipped}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
