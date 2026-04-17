import { prisma } from '../../config/database.js';
import type { Prisma } from '@prisma/client';

export const purchasesService = {
  async list(shopId: string | null, filters: {
    skip: number;
    take: number;
    page: number;
    pageSize: number;
    distributorId?: string;
    dateFrom?: string;
    dateTo?: string;
    paymentStatus?: string;
  }) {
    const where: Prisma.PurchaseWhereInput = {};

    // Only apply shop scoping when shopId is provided
    if (shopId) {
      where.shopId = shopId;
    }

    if (filters.distributorId) {
      where.distributorId = filters.distributorId;
    }

    if (filters.paymentStatus) {
      where.paymentStatus = filters.paymentStatus;
    }

    if (filters.dateFrom || filters.dateTo) {
      where.invoiceDate = {};
      if (filters.dateFrom) {
        (where.invoiceDate as Prisma.DateTimeFilter).gte = new Date(filters.dateFrom);
      }
      if (filters.dateTo) {
        (where.invoiceDate as Prisma.DateTimeFilter).lte = new Date(filters.dateTo);
      }
    }

    const [purchases, totalItems] = await Promise.all([
      prisma.purchase.findMany({
        where,
        include: {
          distributor: {
            select: { id: true, companyName: true, contactPerson: true, phone: true },
          },
          creator: {
            select: { id: true, username: true, fullName: true },
          },
          shop: {
            select: { id: true, name: true, code: true },
          },
          _count: {
            select: { products: true, payments: true },
          },
        },
        orderBy: { invoiceDate: 'desc' },
        skip: filters.skip,
        take: filters.take,
      }),
      prisma.purchase.count({ where }),
    ]);

    return { purchases, totalItems };
  },

  async getById(id: string) {
    const purchase = await prisma.purchase.findUnique({
      where: { id },
      include: {
        distributor: {
          select: {
            id: true,
            companyName: true,
            contactPerson: true,
            phone: true,
            email: true,
            gstNumber: true,
          },
        },
        products: {
          include: {
            category: {
              select: { id: true, name: true, slug: true, path: true },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        payments: {
          include: {
            creator: {
              select: { id: true, username: true, fullName: true },
            },
          },
          orderBy: { paymentDate: 'desc' },
        },
        creator: {
          select: { id: true, username: true, fullName: true },
        },
        shop: {
          select: { id: true, name: true, code: true },
        },
      },
    });

    return purchase;
  },

  async create(shopId: string, data: {
    distributorId: string;
    invoiceNumber: string;
    invoiceDate: string;
    totalAmount: number;
    gstAmount?: number;
    discountAmount?: number;
    notes?: string | null;
    items: Array<{
      categoryId: string;
      brand: string;
      modelNumber: string;
      serialNumber?: string | null;
      mrp: number;
      sellingPrice?: number;
      purchasePrice: number;
      color?: string | null;
      weightKg?: number | null;
      warrantyMonths?: number | null;
      barcode?: string | null;
      dynamicAttributes?: Record<string, unknown>;
    }>;
  }, userId: string) {
    // Validate distributor exists
    const distributor = await prisma.distributor.findUnique({
      where: { id: data.distributorId },
    });
    if (!distributor) {
      throw new Error('Distributor not found');
    }

    // Validate all categories exist and get their attributes
    const categoryIds = [...new Set(data.items.map((item) => item.categoryId))];
    const categories = await prisma.productCategory.findMany({
      where: { id: { in: categoryIds } },
      include: {
        attributes: {
          where: { isActive: true },
        },
      },
    });
    if (categories.length !== categoryIds.length) {
      throw new Error('One or more category IDs are invalid');
    }

    const categoryMap = new Map(categories.map((c) => [c.id, c]));

    // Validate dynamic attributes for each item
    for (const item of data.items) {
      const category = categoryMap.get(item.categoryId)!;
      const dynamicAttributes = item.dynamicAttributes ?? {};
      const requiredAttrs = category.attributes.filter((a) => a.isRequired);
      for (const attr of requiredAttrs) {
        const value = dynamicAttributes[attr.attributeName];
        if (value === undefined || value === null || value === '') {
          throw new Error(`Required attribute "${attr.attributeLabel}" is missing for item "${item.brand} ${item.modelNumber}"`);
        }
      }
    }

    // Calculate net amount
    const gstAmount = data.gstAmount ?? 0;
    const discountAmount = data.discountAmount ?? 0;
    const netAmount = data.totalAmount - discountAmount + gstAmount;

    // Determine initial payment status
    const paymentStatus = 'pending';

    // Create everything in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create purchase record
      const purchase = await tx.purchase.create({
        data: {
          shopId,
          distributorId: data.distributorId,
          invoiceNumber: data.invoiceNumber,
          invoiceDate: new Date(data.invoiceDate),
          totalAmount: data.totalAmount,
          gstAmount,
          discountAmount,
          netAmount,
          amountPaid: 0,
          paymentStatus,
          notes: data.notes ?? null,
          createdBy: userId,
        },
      });

      // Create product records for each item
      const products = [];
      for (const item of data.items) {
        // Calculate warranty expiry
        let warrantyExpiry: Date | undefined;
        if (item.warrantyMonths && item.warrantyMonths > 0) {
          warrantyExpiry = new Date();
          warrantyExpiry.setMonth(warrantyExpiry.getMonth() + item.warrantyMonths);
        }

        // Use brand from dynamic attributes (DB-driven dropdown) if available, fallback to explicit field
        const brand = (item.dynamicAttributes?.brand as string) || item.brand;

        const product = await tx.product.create({
          data: {
            shopId,
            categoryId: item.categoryId,
            brand,
            modelNumber: item.modelNumber,
            serialNumber: item.serialNumber ?? null,
            mrp: item.mrp,
            sellingPrice: item.sellingPrice ?? item.mrp,
            purchasePrice: item.purchasePrice,
            color: item.color ?? null,
            weightKg: item.weightKg ?? null,
            distributorId: data.distributorId,
            purchaseId: purchase.id,
            status: 'in_stock',
            dynamicAttributes: (item.dynamicAttributes ?? {}) as any,
            warrantyMonths: item.warrantyMonths ?? null,
            warrantyExpiry: warrantyExpiry ?? null,
            barcode: item.barcode ?? null,
            createdBy: userId,
          },
        });

        // Create audit trail entry
        await tx.productAuditTrail.create({
          data: {
            productId: product.id,
            eventType: 'purchased',
            toShopId: shopId,
            referenceId: purchase.id,
            referenceType: 'purchase',
            performedBy: userId,
            notes: `Purchased from ${distributor.companyName}, Invoice: ${data.invoiceNumber}`,
          },
        });

        products.push(product);
      }

      return { purchase, products };
    });

    // Fetch the full purchase with relations
    const fullPurchase = await prisma.purchase.findUnique({
      where: { id: result.purchase.id },
      include: {
        distributor: {
          select: { id: true, companyName: true, contactPerson: true },
        },
        products: {
          include: {
            category: {
              select: { id: true, name: true, slug: true, path: true },
            },
          },
        },
        creator: {
          select: { id: true, username: true, fullName: true },
        },
      },
    });

    return fullPurchase;
  },

  async update(id: string, data: {
    invoiceNumber?: string;
    invoiceDate?: string;
    totalAmount?: number;
    gstAmount?: number;
    discountAmount?: number;
    notes?: string | null;
  }) {
    const existing = await prisma.purchase.findUnique({ where: { id } });
    if (!existing) {
      return null;
    }

    const updateData: Record<string, unknown> = {};

    if (data.invoiceNumber !== undefined) updateData.invoiceNumber = data.invoiceNumber;
    if (data.invoiceDate !== undefined) updateData.invoiceDate = new Date(data.invoiceDate);
    if (data.notes !== undefined) updateData.notes = data.notes;

    // Recalculate netAmount if financial fields change
    const totalAmount = data.totalAmount ?? Number(existing.totalAmount);
    const gstAmount = data.gstAmount ?? Number(existing.gstAmount);
    const discountAmount = data.discountAmount ?? Number(existing.discountAmount);

    if (data.totalAmount !== undefined) updateData.totalAmount = data.totalAmount;
    if (data.gstAmount !== undefined) updateData.gstAmount = data.gstAmount;
    if (data.discountAmount !== undefined) updateData.discountAmount = data.discountAmount;

    // Recalculate netAmount if any financial field changed
    if (data.totalAmount !== undefined || data.gstAmount !== undefined || data.discountAmount !== undefined) {
      const newNetAmount = totalAmount - discountAmount + gstAmount;
      updateData.netAmount = newNetAmount;

      // Recalculate payment status based on new netAmount
      const amountPaid = Number(existing.amountPaid);
      if (amountPaid >= newNetAmount) {
        updateData.paymentStatus = 'paid';
      } else if (amountPaid > 0) {
        updateData.paymentStatus = 'partial';
      } else {
        updateData.paymentStatus = 'pending';
      }
    }

    const updated = await prisma.purchase.update({
      where: { id },
      data: updateData as any,
      include: {
        distributor: {
          select: { id: true, companyName: true, contactPerson: true },
        },
        creator: {
          select: { id: true, username: true, fullName: true },
        },
      },
    });

    return updated;
  },

  async recordPayment(purchaseId: string, data: {
    amount: number;
    paymentMode: string;
    paymentDate: string;
    referenceNumber?: string | null;
    notes?: string | null;
  }, userId: string) {
    const purchase = await prisma.purchase.findUnique({ where: { id: purchaseId } });
    if (!purchase) {
      throw new Error('Purchase not found');
    }

    const result = await prisma.$transaction(async (tx) => {
      // Create the payment record
      const payment = await tx.purchasePayment.create({
        data: {
          purchaseId,
          amount: data.amount,
          paymentMode: data.paymentMode as any,
          paymentDate: new Date(data.paymentDate),
          referenceNumber: data.referenceNumber ?? null,
          notes: data.notes ?? null,
          createdBy: userId,
        },
      });

      // Sum all payments for this purchase
      const paymentAgg = await tx.purchasePayment.aggregate({
        where: { purchaseId },
        _sum: { amount: true },
      });

      const totalPaid = Number(paymentAgg._sum.amount ?? 0);
      const netAmount = Number(purchase.netAmount);

      // Determine payment status
      let paymentStatus: string;
      if (totalPaid >= netAmount) {
        paymentStatus = 'paid';
      } else if (totalPaid > 0) {
        paymentStatus = 'partial';
      } else {
        paymentStatus = 'pending';
      }

      // Update purchase with new totals
      await tx.purchase.update({
        where: { id: purchaseId },
        data: {
          amountPaid: totalPaid,
          paymentStatus,
        },
      });

      return payment;
    });

    // Return updated purchase with payment
    const updatedPurchase = await prisma.purchase.findUnique({
      where: { id: purchaseId },
      include: {
        payments: {
          include: {
            creator: {
              select: { id: true, username: true, fullName: true },
            },
          },
          orderBy: { paymentDate: 'desc' },
        },
        distributor: {
          select: { id: true, companyName: true },
        },
      },
    });

    return { payment: result, purchase: updatedPurchase };
  },
};
