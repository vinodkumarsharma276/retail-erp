/**
 * Repair legacy transfers that were received BEFORE the clone-on-receive fix.
 *
 * Old behaviour:  product.shopId was moved to the destination shop and status set to
 *                 in_stock. The source shop lost all trace of the item.
 *
 * New behaviour:  the source product stays at the source shop (status=sold) and a
 *                 fresh clone is created at the destination shop (status=in_stock,
 *                 purchasePrice=transferPrice).
 *
 * This script detects received transfers where the referenced product is currently
 * sitting at the destination shop and repairs them: the existing product record is
 * restored to the source shop (status=sold), and a new clone is created at the
 * destination shop. Idempotent — already-repaired transfers are skipped.
 *
 * Usage:   npm run db:repair:transfers --workspace=apps/api
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Scanning received transfers for legacy shopId moves...\n');

  const received = await prisma.interShopTransfer.findMany({
    where: { status: 'received' },
    include: { product: true, fromShop: true, toShop: true },
    orderBy: { receivedAt: 'asc' },
  });

  let repaired = 0;
  for (const t of received) {
    if (!t.product) continue;

    // Legacy marker: the product referenced by the transfer is at the destination
    // shop. In the new model, transfer.productId always points at the SOURCE
    // product (status=sold, shopId=fromShopId), so anything else is legacy data.
    const isLegacy = t.product.shopId === t.toShopId;
    if (!isLegacy) continue;

    const transferPrice =
      t.transferPrice != null ? Number(t.transferPrice) : Number(t.product.purchasePrice);

    await prisma.$transaction(async (tx) => {
      // 1. Create a fresh clone at the destination shop — this becomes the
      //    in-stock item in the destination inventory going forward.
      const clone = await tx.product.create({
        data: {
          shopId: t.toShopId,
          categoryId: t.product!.categoryId,
          brand: t.product!.brand,
          modelNumber: t.product!.modelNumber,
          serialNumber: t.product!.serialNumber,
          mrp: t.product!.mrp,
          sellingPrice: t.product!.sellingPrice,
          purchasePrice: transferPrice,
          color: t.product!.color,
          weightKg: t.product!.weightKg,
          distributorId: null,
          purchaseId: null,
          status: 'in_stock',
          dynamicAttributes: t.product!.dynamicAttributes as any,
          warrantyMonths: t.product!.warrantyMonths,
          warrantyExpiry: t.product!.warrantyExpiry,
          barcode: t.product!.barcode,
          notes: t.product!.notes,
          createdBy: t.receivedBy ?? t.initiatedBy,
        },
      });

      // 2. Restore the original product record to the source shop, marked sold.
      await tx.product.update({
        where: { id: t.product!.id },
        data: {
          shopId: t.fromShopId,
          status: 'sold',
        },
      });

      // 3. Retarget the existing 'transferred_in' audit entry to the new clone
      //    so the destination product carries its own audit history.
      await tx.productAuditTrail.updateMany({
        where: {
          productId: t.product!.id,
          eventType: 'transferred_in',
          referenceId: t.id,
        },
        data: { productId: clone.id },
      });

      // 4. Record the sale-to-GST-entity on the source product.
      await tx.productAuditTrail.create({
        data: {
          productId: t.product!.id,
          eventType: 'sold',
          fromShopId: t.fromShopId,
          toShopId: t.toShopId,
          referenceId: t.id,
          referenceType: 'transfer',
          performedBy: t.receivedBy ?? t.initiatedBy,
          notes:
            `Sold via inter-shop transfer to ${t.toShop.name} ` +
            `(${t.toShop.code}). New product: ${clone.id}. [Repaired]`,
        },
      });
    });

    console.log(
      `  Repaired transfer ${t.id}: ${t.product.brand} ${t.product.modelNumber} ` +
        `(${t.fromShop.code} -> ${t.toShop.code})`,
    );
    repaired += 1;
  }

  console.log(`\nDone. Repaired ${repaired} legacy transfer${repaired === 1 ? '' : 's'}.`);
}

main()
  .catch((e) => {
    console.error('Repair failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
