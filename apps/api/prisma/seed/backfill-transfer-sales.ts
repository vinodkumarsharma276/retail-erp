/**
 * Backfill: for every received InterShopTransfer that does NOT yet have a
 * corresponding SaleRecord in the source shop, create the sale as
 * 'partial_with_promise' with full transfer price pending.
 *
 * Idempotent — skips transfers that already have a sale linked to the source
 * product after the received-at timestamp.
 */
import { PrismaClient } from '@prisma/client';
import { generateSaleNumber } from '../../src/utils/id-generator';

const prisma = new PrismaClient();

async function getOrCreateShopDistributor(tx: any, shop: any, createdBy?: string) {
  const existing = await tx.distributor.findFirst({ where: { gstNumber: shop.gstNumber } });
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

async function getOrCreateShopCustomer(
  tx: any,
  ownerShopId: string,
  ownerShopCode: string,
  otherShop: any,
  createdBy?: string,
) {
  const customerCode = `SHOP-${ownerShopCode}-${otherShop.code}`;
  const existing = await tx.customer.findUnique({ where: { customerCode } });
  if (existing) return existing;
  return tx.customer.create({
    data: {
      customerCode,
      name: otherShop.name,
      phone: otherShop.phone,
      addressLine1: otherShop.addressLine1,
      addressLine2: otherShop.addressLine2 ?? null,
      city: otherShop.city,
      state: otherShop.state,
      pincode: otherShop.pincode,
      shopId: ownerShopId,
      dynamicAttributes: { sourceType: 'shop', shopId: otherShop.id, shopCode: otherShop.code },
      createdBy: createdBy ?? null,
    },
  });
}

async function main() {
  console.log('Backfilling sales for received inter-shop transfers...\n');

  const received = await prisma.interShopTransfer.findMany({
    where: { status: 'received' },
    include: { fromShop: true, toShop: true, product: true },
    orderBy: { receivedAt: 'asc' },
  });

  let created = 0;
  for (const t of received) {
    if (!t.product) continue;

    // Skip if a sale already exists that references this source product.
    const existingSale = await prisma.saleRecord.findFirst({
      where: { productId: t.productId, shopId: t.fromShopId },
    });
    if (existingSale) continue;

    const transferPrice =
      t.transferPrice != null ? Number(t.transferPrice) : Number(t.product.purchasePrice);
    const transferGstAmount = t.gstAmount != null ? Number(t.gstAmount) : 0;
    const netAmount = Math.max(0, transferPrice - transferGstAmount);
    const rawGstRate = netAmount > 0 ? (transferGstAmount / netAmount) * 100 : 0;
    const gstRate = [0, 5, 12, 18, 28].reduce((prev, curr) =>
      Math.abs(curr - rawGstRate) < Math.abs(prev - rawGstRate) ? curr : prev,
    );
    const sourceDp = Number(t.product.purchasePrice);
    const purchaseGstAmount =
      gstRate > 0 ? Math.round((sourceDp * gstRate) / (100 + gstRate)) : 0;

    const userId = t.receivedBy ?? t.initiatedBy;

    await prisma.$transaction(async (tx) => {
      await getOrCreateShopDistributor(tx, t.fromShop, userId);
      const shopCustomer = await getOrCreateShopCustomer(
        tx,
        t.fromShopId,
        t.fromShop.code,
        t.toShop,
        userId,
      );

      const lastSale = await tx.saleRecord.findFirst({
        where: { saleNumber: { startsWith: `SALE-${t.fromShop.code.toUpperCase()}-` } },
        orderBy: { saleNumber: 'desc' },
        select: { saleNumber: true },
      });
      const saleDate = t.receivedAt ?? new Date();
      const saleNumber = generateSaleNumber(
        t.fromShop.code.toUpperCase(),
        saleDate,
        lastSale?.saleNumber ?? undefined,
      );
      const promiseDate = new Date(saleDate);
      promiseDate.setDate(promiseDate.getDate() + 30);
      const ledgerNumber = t.invoiceNumber ?? `TRF-${t.id.slice(0, 8)}`;

      const sale = await tx.saleRecord.create({
        data: {
          saleNumber,
          ledgerNumber,
          shopId: t.fromShopId,
          productId: t.productId,
          customerId: shopCustomer.id,
          saleDate,
          saleType: 'partial_with_promise',
          mrp: t.product!.mrp,
          sellingPrice: transferPrice,
          discountAmount: 0,
          netAmount,
          gstRate,
          gstAmount: transferGstAmount,
          purchasePrice: sourceDp,
          purchaseGstAmount,
          totalAmount: transferPrice,
          downPayment: 0,
          paymentMode: 'bank_transfer',
          paymentBreakdown: undefined as any,
          promiseDate,
          pendingAmount: transferPrice,
          fileCharge: 0,
          notes:
            `Inter-shop transfer to ${t.toShop.name} (${t.toShop.code}). ` +
            `Invoice: ${ledgerNumber}. Payment pending from destination shop. [Backfilled]`,
          createdBy: userId,
        },
      });

      await tx.saleRecordSanitized.create({
        data: {
          id: sale.id,
          saleNumber,
          ledgerNumber,
          shopId: t.fromShopId,
          productId: t.productId,
          customerId: shopCustomer.id,
          saleDate,
          saleType: 'full_payment',
          sellingPrice: transferPrice,
          totalAmount: transferPrice,
          paymentMode: 'cash',
          createdBy: userId,
        },
      });
    });

    console.log(
      `  Created sale for ${t.product.brand} ${t.product.modelNumber} ` +
        `(${t.fromShop.code} -> ${t.toShop.code}, ₹${transferPrice})`,
    );
    created += 1;
  }

  console.log(`\nDone. Created ${created} sale${created === 1 ? '' : 's'}.`);
}

main()
  .catch((e) => {
    console.error('Backfill failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
