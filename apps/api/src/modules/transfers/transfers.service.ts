import { prisma } from '../../config/database.js';
import type { Prisma, PrismaClient } from '@prisma/client';
import { generateSaleNumber } from '../../utils/id-generator.js';

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

/**
 * Find (or create) a Customer row in `ownerShopId` that represents the other
 * shop. Used so a transfer can be recorded as a sale in the source shop's
 * books, with the destination shop acting as the "customer".
 *
 * customerCode is unique globally, so we key it as SHOP-{owner}-{other}.
 */
async function getOrCreateShopCustomer(
  tx: Tx,
  ownerShopId: string,
  ownerShopCode: string,
  otherShop: {
    id: string;
    name: string;
    code: string;
    phone: string;
    addressLine1: string;
    addressLine2?: string | null;
    city: string;
    state: string;
    pincode: string;
  },
  createdBy?: string,
) {
  const customerCode = `SHOP-${ownerShopCode}-${otherShop.code}`;
  const existing = await tx.customer.findUnique({
    where: { customerCode },
  });
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
      dynamicAttributes: {
        sourceType: 'shop',
        shopId: otherShop.id,
        shopCode: otherShop.code,
      },
      createdBy: createdBy ?? null,
    },
  });
}

export const transfersService = {
  /**
   * List transfers with pagination and filters.
   *
   * Shop-scoped: when `shopId` is provided (always, in practice — injected
   * from `request.shopFilter`) only transfers where the active shop is
   * either the source OR the destination are returned. This matches the
   * mental model of viewing one shop at a time — you see what's leaving
   * the shop and what's coming into it. Owners/admins can switch shops
   * via the header dropdown to see another shop's transfer book.
   *
   * Explicit `fromShopId` / `toShopId` filters (from the query string) are
   * applied on top of the shop scope as additional narrowing, e.g. if the
   * UI ever wants to show only outgoing-from-this-shop transfers.
   */
  async list(filters: {
    skip: number;
    take: number;
    page: number;
    pageSize: number;
    shopId?: string;
    fromShopId?: string;
    toShopId?: string;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
  }) {
    const where: Prisma.InterShopTransferWhereInput = {};

    if (filters.shopId) {
      where.OR = [
        { fromShopId: filters.shopId },
        { toShopId: filters.shopId },
      ];
    }

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
        toShop: true,
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

    // Transfer price & GST snapshot used both for the source-shop sale and
    // as DP for the destination clone.
    const transferPrice =
      transfer.transferPrice != null
        ? Number(transfer.transferPrice)
        : Number(sourceProduct.purchasePrice);
    const transferGstAmount =
      transfer.gstAmount != null ? Number(transfer.gstAmount) : 0;
    const netAmount = Math.max(0, transferPrice - transferGstAmount);
    // Snap inferred GST rate to nearest slab for a clean value in the sale record.
    const rawGstRate = netAmount > 0 ? (transferGstAmount / netAmount) * 100 : 0;
    const gstRate = [0, 5, 12, 18, 28].reduce((prev, curr) =>
      Math.abs(curr - rawGstRate) < Math.abs(prev - rawGstRate) ? curr : prev,
    );
    const sourceDp = Number(sourceProduct.purchasePrice);
    const purchaseGstAmount =
      gstRate > 0 ? Math.round((sourceDp * gstRate) / (100 + gstRate)) : 0;

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
      const sourceShopDistributor = await getOrCreateShopDistributor(
        tx,
        transfer.fromShop,
        userId,
      );

      // 3c. Create a Purchase record on the destination shop's books that
      //     represents this transfer-as-purchase. Without this the new
      //     Product would have `purchaseId = null` and the destination
      //     shop's Products list would render a blank "Date of Purchase".
      //     The transfer itself is the supporting document, so we reuse
      //     the transfer invoice number.
      const receivedDate = new Date();
      const transferInvoiceNumber =
        transfer.invoiceNumber ?? `TRF-${transfer.id.slice(0, 8)}`;
      const destPurchase = await tx.purchase.create({
        data: {
          shopId: transfer.toShopId,
          distributorId: sourceShopDistributor.id,
          invoiceNumber: transferInvoiceNumber,
          invoiceDate: receivedDate,
          totalAmount: transferPrice,
          gstAmount: transferGstAmount,
          discountAmount: 0,
          netAmount,
          amountPaid: 0,
          paymentStatus: 'pending',
          notes:
            `Inter-shop transfer received from ${transfer.fromShop.name} ` +
            `(${transfer.fromShop.code}). Transfer ID: ${transfer.id}.`,
          createdBy: userId,
        },
      });

      // 4. Clone into destination shop as a fresh in-stock product.
      const destProduct = await tx.product.create({
        data: {
          shopId: transfer.toShopId,
          categoryId: sourceProduct.categoryId,
          brand: sourceProduct.brand,
          modelNumber: sourceProduct.modelNumber,
          serialNumber: sourceProduct.serialNumber,
          mrp: sourceProduct.mrp,
          sellingPrice: sourceProduct.sellingPrice,
          purchasePrice: transferPrice,
          color: sourceProduct.color,
          weightKg: sourceProduct.weightKg,
          distributorId: sourceShopDistributor.id,
          purchaseId: destPurchase.id,
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

      // 7. Record the transfer as a Sale in the SOURCE shop's books.
      //    Inter-shop transfers are cross-GST-entity sales — payment usually
      //    settles later, so the sale is booked as 'partial_with_promise' with
      //    the full transfer price pending.
      const shopCustomer = await getOrCreateShopCustomer(
        tx,
        transfer.fromShopId,
        transfer.fromShop.code,
        transfer.toShop,
        userId,
      );

      const lastSale = await tx.saleRecord.findFirst({
        where: {
          saleNumber: { startsWith: `SALE-${transfer.fromShop.code.toUpperCase()}-` },
        },
        orderBy: { saleNumber: 'desc' },
        select: { saleNumber: true },
      });
      const saleDate = transfer.receivedAt ?? new Date();
      const saleNumber = generateSaleNumber(
        transfer.fromShop.code.toUpperCase(),
        saleDate,
        lastSale?.saleNumber ?? undefined,
      );
      // 30-day promise by default — customisable later.
      const promiseDate = new Date(saleDate);
      promiseDate.setDate(promiseDate.getDate() + 30);

      const ledgerNumber =
        transfer.invoiceNumber ?? `TRF-${transfer.id.slice(0, 8)}`;

      const saleRecord = await tx.saleRecord.create({
        data: {
          saleNumber,
          ledgerNumber,
          shopId: transfer.fromShopId,
          productId: sourceProduct.id,
          customerId: shopCustomer.id,
          saleDate,
          saleType: 'partial_with_promise',
          mrp: sourceProduct.mrp,
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
          paymentBreakdown: null,
          promiseDate,
          pendingAmount: transferPrice,
          fileCharge: 0,
          notes:
            `Inter-shop transfer to ${transfer.toShop.name} ` +
            `(${transfer.toShop.code}). Invoice: ${ledgerNumber}. ` +
            `Payment pending from destination shop.`,
          createdBy: userId,
        },
      });

      // A transfer is a plain sale between shops: one record, no sanitized copy.
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
