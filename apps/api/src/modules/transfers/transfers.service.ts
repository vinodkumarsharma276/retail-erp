import { prisma } from '../../config/database.js';
import type { Prisma, PrismaClient } from '@prisma/client';

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/**
 * Find (or create) the Distributor record that represents a shop. Inter-shop
 * transfers are sales between GST entities, so the source shop acts as the
 * "distributor" of record for the destination shop's cloned inventory.
 *
 * Matched by GST number (unique per shop). Safe to call inside a transaction.
 */
async function getOrCreateShopDistributor(
  tx: Tx,
  shop: {
    id: string;
    name: string;
    code: string;
    gstNumber: string;
    panNumber: string;
    phone: string;
    email?: string | null;
    addressLine1: string;
    addressLine2?: string | null;
    city: string;
    state: string;
    pincode: string;
    bankName?: string | null;
    bankAccountNumber?: string | null;
    bankIfsc?: string | null;
    bankBranch?: string | null;
  },
  createdBy?: string,
) {
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

export const transfersService = {
  /**
   * List transfers with pagination and filters.
   * NOT shop-scoped — admins/accountants see all transfers across shops.
   */
  async list(filters: {
    skip: number;
    take: number;
    page: number;
    pageSize: number;
    fromShopId?: string;
    toShopId?: string;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
  }) {
    const where: Prisma.InterShopTransferWhereInput = {};

    if (filters.fromShopId) {
      where.fromShopId = filters.fromShopId;
    }

    if (filters.toShopId) {
      where.toShopId = filters.toShopId;
    }

    if (filters.status) {
      where.status = filters.status as any;
    }

    if (filters.dateFrom || filters.dateTo) {
      where.transferDate = {};
      if (filters.dateFrom) {
        (where.transferDate as Prisma.DateTimeFilter).gte = new Date(filters.dateFrom);
      }
      if (filters.dateTo) {
        (where.transferDate as Prisma.DateTimeFilter).lte = new Date(filters.dateTo);
      }
    }

    const [transfers, totalItems] = await Promise.all([
      prisma.interShopTransfer.findMany({
        where,
        include: {
          product: {
            select: {
              id: true,
              brand: true,
              modelNumber: true,
              serialNumber: true,
              category: { select: { id: true, name: true, slug: true } },
            },
          },
          fromShop: {
            select: { id: true, name: true, code: true },
          },
          toShop: {
            select: { id: true, name: true, code: true },
          },
          initiator: {
            select: { id: true, username: true, fullName: true },
          },
          receiver: {
            select: { id: true, username: true, fullName: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: filters.skip,
        take: filters.take,
      }),
      prisma.interShopTransfer.count({ where }),
    ]);

    return { transfers, totalItems };
  },

  /**
   * Get a single transfer by ID with full details.
   */
  async getById(id: string) {
    const transfer = await prisma.interShopTransfer.findUnique({
      where: { id },
      include: {
        product: {
          select: {
            id: true,
            brand: true,
            modelNumber: true,
            serialNumber: true,
            mrp: true,
            sellingPrice: true,
            purchasePrice: true,
            status: true,
            category: { select: { id: true, name: true, slug: true } },
          },
        },
        fromShop: {
          select: { id: true, name: true, code: true },
        },
        toShop: {
          select: { id: true, name: true, code: true },
        },
        initiator: {
          select: { id: true, username: true, fullName: true },
        },
        receiver: {
          select: { id: true, username: true, fullName: true },
        },
      },
    });

    return transfer;
  },

  /**
   * Initiate a transfer — move a product from the current shop to another shop.
   * Creates the transfer record, marks the product as 'transferred', and logs audit trail.
   */
  async initiate(data: {
    productId: string;
    fromShopId: string;
    toShopId: string;
    transferPrice?: number;
    gstAmount?: number;
    invoiceNumber?: string;
    notes?: string;
  }, userId: string) {
    // 1. Validate product exists and is in_stock
    const product = await prisma.product.findUnique({
      where: { id: data.productId },
    });
    if (!product) {
      throw new Error('Product not found');
    }
    if (product.status !== 'in_stock') {
      throw new Error('Only in-stock products can be transferred');
    }

    // 2. Validate fromShopId matches product's current shop
    if (product.shopId !== data.fromShopId) {
      throw new Error('Product does not belong to the source shop');
    }

    // 3. Validate toShopId is different and exists
    if (data.fromShopId === data.toShopId) {
      throw new Error('Source and destination shops must be different');
    }

    const toShop = await prisma.shop.findUnique({
      where: { id: data.toShopId },
    });
    if (!toShop) {
      throw new Error('Destination shop not found');
    }

    // 4-6. Transaction: create transfer, update product, create audit trail
    const transfer = await prisma.$transaction(async (tx) => {
      // 4a. Auto-generate invoice number if not supplied: TRF-{FROM}-{TO}-YYYYMMDD-NNNN
      let invoiceNumber = data.invoiceNumber?.trim() || null;
      if (!invoiceNumber) {
        const fromShop = await tx.shop.findUnique({
          where: { id: data.fromShopId },
          select: { code: true },
        });
        const now = new Date();
        const ymd =
          now.getFullYear().toString() +
          String(now.getMonth() + 1).padStart(2, '0') +
          String(now.getDate()).padStart(2, '0');
        const prefix = `TRF-${fromShop?.code ?? 'XX'}-${toShop.code}-${ymd}-`;
        const existingCount = await tx.interShopTransfer.count({
          where: { invoiceNumber: { startsWith: prefix } },
        });
        invoiceNumber = `${prefix}${String(existingCount + 1).padStart(4, '0')}`;
      }

      // 4b. Create InterShopTransfer record
      const newTransfer = await tx.interShopTransfer.create({
        data: {
          productId: data.productId,
          fromShopId: data.fromShopId,
          toShopId: data.toShopId,
          transferDate: new Date(),
          status: 'initiated',
          transferPrice: data.transferPrice ?? null,
          gstAmount: data.gstAmount ?? null,
          invoiceNumber,
          notes: data.notes ?? null,
          initiatedBy: userId,
        },
      });

      // 5. Update product status to 'transferred'
      await tx.product.update({
        where: { id: data.productId },
        data: { status: 'transferred' },
      });

      // 6. Create ProductAuditTrail entry for 'transferred_out'
      await tx.productAuditTrail.create({
        data: {
          productId: data.productId,
          eventType: 'transferred_out',
          fromShopId: data.fromShopId,
          toShopId: data.toShopId,
          referenceId: newTransfer.id,
          referenceType: 'transfer',
          performedBy: userId,
          notes: `Transfer initiated to ${toShop.name} (${toShop.code})`,
        },
      });

      return newTransfer;
    });

    // Return the transfer with full relations
    return transfersService.getById(transfer.id);
  },

  /**
   * Receive a transfer — accept the product at the destination shop.
   *
   * An inter-shop transfer is modelled as a sale from one GST entity (source
   * shop) to another (destination shop). On receive:
   *   - The ORIGINAL product stays with the source shop and is marked 'sold'
   *     (preserves full history and keeps it visible in the source inventory).
   *   - A NEW product record is created in the destination shop with status
   *     'in_stock' and purchasePrice = transferPrice (this becomes the DP for
   *     that shop going forward).
   *   - Audit trail entries are written for both the source and destination
   *     products so the full movement history is traceable.
   */
  async receive(transferId: string, userId: string) {
    // 1. Validate transfer exists and is in a receivable status
    const transfer = await prisma.interShopTransfer.findUnique({
      where: { id: transferId },
      include: {
        fromShop: true,
        toShop: { select: { id: true, name: true, code: true } },
        product: true,
      },
    });
    if (!transfer) {
      throw new Error('Transfer not found');
    }
    if (transfer.status !== 'initiated' && transfer.status !== 'in_transit') {
      throw new Error('Transfer cannot be received in its current status');
    }

    const sourceProduct = transfer.product;
    if (!sourceProduct) {
      throw new Error('Source product not found for this transfer');
    }

    // The DP at the destination shop is the transfer price (falls back to the
    // source purchase price if no transfer price was recorded).
    const destinationDp =
      transfer.transferPrice != null
        ? Number(transfer.transferPrice)
        : Number(sourceProduct.purchasePrice);

    await prisma.$transaction(async (tx) => {
      // 2. Mark transfer as received
      await tx.interShopTransfer.update({
        where: { id: transferId },
        data: {
          status: 'received',
          receivedBy: userId,
          receivedAt: new Date(),
        },
      });

      // 3. Source product: stays at source shop, status becomes 'sold'
      //    (it was effectively sold to the destination GST entity).
      await tx.product.update({
        where: { id: sourceProduct.id },
        data: { status: 'sold' },
      });

      // 3b. Ensure a Distributor record exists that represents the source shop.
      //     This is what the destination shop will see as the "distributor" of
      //     the cloned item (since it came from another GST entity, not a
      //     third-party supplier).
      const sourceShopDistributor = await getOrCreateShopDistributor(
        tx,
        transfer.fromShop,
        userId,
      );

      // 4. Clone into destination shop as a fresh in-stock product.
      //    purchaseId is cleared — the item's origin for the destination shop
      //    is this transfer, not a distributor purchase invoice. distributorId
      //    points at the source shop's distributor representation.
      const destProduct = await tx.product.create({
        data: {
          shopId: transfer.toShopId,
          categoryId: sourceProduct.categoryId,
          brand: sourceProduct.brand,
          modelNumber: sourceProduct.modelNumber,
          serialNumber: sourceProduct.serialNumber,
          mrp: sourceProduct.mrp,
          sellingPrice: sourceProduct.sellingPrice,
          purchasePrice: destinationDp,
          color: sourceProduct.color,
          weightKg: sourceProduct.weightKg,
          distributorId: sourceShopDistributor.id,
          purchaseId: null,
          status: 'in_stock',
          dynamicAttributes: sourceProduct.dynamicAttributes as any,
          warrantyMonths: sourceProduct.warrantyMonths,
          warrantyExpiry: sourceProduct.warrantyExpiry,
          barcode: sourceProduct.barcode,
          notes: sourceProduct.notes,
          createdBy: userId,
        },
      });

      // 5. Audit trail: 'transferred_in' on the new destination product
      await tx.productAuditTrail.create({
        data: {
          productId: destProduct.id,
          eventType: 'transferred_in',
          fromShopId: transfer.fromShopId,
          toShopId: transfer.toShopId,
          referenceId: transferId,
          referenceType: 'transfer',
          performedBy: userId,
          notes:
            `Transfer received from ${transfer.fromShop.name} ` +
            `(${transfer.fromShop.code}). Cloned from source product ${sourceProduct.id}.`,
        },
      });

      // 6. Audit trail: mark source product as sold-to-GST-entity
      await tx.productAuditTrail.create({
        data: {
          productId: sourceProduct.id,
          eventType: 'sold',
          fromShopId: transfer.fromShopId,
          toShopId: transfer.toShopId,
          referenceId: transferId,
          referenceType: 'transfer',
          performedBy: userId,
          notes:
            `Sold via inter-shop transfer to ${transfer.toShop.name} ` +
            `(${transfer.toShop.code}). New product: ${destProduct.id}.`,
        },
      });
    });

    // Return updated transfer with full relations
    return transfersService.getById(transferId);
  },

  /**
   * Cancel a transfer — revert the product back to in_stock at the source shop.
   * Only initiated transfers can be cancelled (not received ones).
   */
  async cancel(transferId: string, userId: string) {
    // 1. Validate transfer exists and is in a cancellable status
    const transfer = await prisma.interShopTransfer.findUnique({
      where: { id: transferId },
      include: {
        fromShop: { select: { id: true, name: true, code: true } },
        toShop: { select: { id: true, name: true, code: true } },
      },
    });
    if (!transfer) {
      throw new Error('Transfer not found');
    }
    if (transfer.status !== 'initiated') {
      throw new Error('Only initiated transfers can be cancelled');
    }

    // 2-4. Transaction: update transfer, revert product, create audit trail
    await prisma.$transaction(async (tx) => {
      // 2. Update transfer status to 'cancelled'
      await tx.interShopTransfer.update({
        where: { id: transferId },
        data: { status: 'cancelled' },
      });

      // 3. Revert product status to 'in_stock' (stays at source shop)
      await tx.product.update({
        where: { id: transfer.productId },
        data: { status: 'in_stock' },
      });

      // 4. Create ProductAuditTrail entry for 'transfer_cancelled'
      await tx.productAuditTrail.create({
        data: {
          productId: transfer.productId,
          eventType: 'transfer_cancelled',
          fromShopId: transfer.fromShopId,
          toShopId: transfer.toShopId,
          referenceId: transferId,
          referenceType: 'transfer',
          performedBy: userId,
          notes: `Transfer cancelled (was going to ${transfer.toShop.name})`,
        },
      });
    });

    // Return updated transfer with full relations
    return transfersService.getById(transferId);
  },

  /**
   * Get incoming transfers for a specific shop — pending receipts.
   * Returns transfers where toShopId matches and status is 'initiated' or 'in_transit'.
   */
  async getIncoming(shopId: string) {
    const transfers = await prisma.interShopTransfer.findMany({
      where: {
        toShopId: shopId,
        status: { in: ['initiated', 'in_transit'] },
      },
      include: {
        product: {
          select: {
            id: true,
            brand: true,
            modelNumber: true,
            serialNumber: true,
            mrp: true,
            sellingPrice: true,
            category: { select: { id: true, name: true, slug: true } },
          },
        },
        fromShop: {
          select: { id: true, name: true, code: true },
        },
        toShop: {
          select: { id: true, name: true, code: true },
        },
        initiator: {
          select: { id: true, username: true, fullName: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return transfers;
  },
};
