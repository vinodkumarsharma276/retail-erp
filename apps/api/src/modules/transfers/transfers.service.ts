import { prisma } from '../../config/database.js';
import type { Prisma } from '@prisma/client';

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
      // 4. Create InterShopTransfer record
      const newTransfer = await tx.interShopTransfer.create({
        data: {
          productId: data.productId,
          fromShopId: data.fromShopId,
          toShopId: data.toShopId,
          transferDate: new Date(),
          status: 'initiated',
          transferPrice: data.transferPrice ?? null,
          gstAmount: data.gstAmount ?? null,
          invoiceNumber: data.invoiceNumber ?? null,
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
   * Changes product ownership to the destination shop, marks it in_stock again.
   */
  async receive(transferId: string, userId: string) {
    // 1. Validate transfer exists and is in a receivable status
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
    if (transfer.status !== 'initiated' && transfer.status !== 'in_transit') {
      throw new Error('Transfer cannot be received in its current status');
    }

    // 2-4. Transaction: update transfer, update product, create audit trail
    await prisma.$transaction(async (tx) => {
      // 2. Update transfer status to 'received'
      await tx.interShopTransfer.update({
        where: { id: transferId },
        data: {
          status: 'received',
          receivedBy: userId,
          receivedAt: new Date(),
        },
      });

      // 3. Update product: change shopId to destination, status back to 'in_stock'
      await tx.product.update({
        where: { id: transfer.productId },
        data: {
          shopId: transfer.toShopId,
          status: 'in_stock',
        },
      });

      // 4. Create ProductAuditTrail entry for 'transferred_in'
      await tx.productAuditTrail.create({
        data: {
          productId: transfer.productId,
          eventType: 'transferred_in',
          fromShopId: transfer.fromShopId,
          toShopId: transfer.toShopId,
          referenceId: transferId,
          referenceType: 'transfer',
          performedBy: userId,
          notes: `Transfer received from ${transfer.fromShop.name} (${transfer.fromShop.code})`,
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
