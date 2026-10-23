import { prisma } from '../../config/database.js';
import type { Prisma } from '@prisma/client';
import { unbilledSeriesService } from './unbilled-series.js';

/** A purchase that cannot go, because something of it has already moved on. */
export class PurchaseInUseError extends Error {}

/** The shape the deletion guard needs; both callers select exactly this. */
export interface PurchaseDeletionCandidate {
  invoiceNumber: string;
  amountPaid: Prisma.Decimal;
  products: Array<{ id: string; status: string }>;
}

/**
 * Why this set of purchases cannot be deleted, or null when it can.
 *
 * Deleting a purchase takes its units with it, so a unit that has already
 * moved on stops it. Shared with the distributor cascade delete, which takes
 * a supplier's purchases down the same way: a sold unit must not become
 * erasable just because someone came at it from the supplier instead.
 */
export async function reasonPurchasesCannotBeDeleted(
  purchases: PurchaseDeletionCandidate[],
): Promise<string | null> {
  const productIds = purchases.flatMap((p) => p.products.map((u) => u.id));
  const [sales, sanitized, transfers] = await Promise.all([
    productIds.length
      ? prisma.saleRecord.findMany({ where: { productId: { in: productIds } }, select: { productId: true } })
      : [],
    productIds.length
      ? prisma.saleRecordSanitized.findMany({ where: { productId: { in: productIds } }, select: { productId: true } })
      : [],
    productIds.length
      ? prisma.interShopTransfer.findMany({ where: { productId: { in: productIds } }, select: { productId: true } })
      : [],
  ]);
  const spokenFor = new Set([
    ...sales.map((r) => r.productId),
    ...sanitized.map((r) => r.productId),
    ...transfers.map((r) => r.productId),
  ]);

  for (const purchase of purchases) {
    const sold = purchase.products.filter((u) => spokenFor.has(u.id));
    if (sold.length > 0) {
      return `${purchase.invoiceNumber} cannot be deleted: ${sold.length} of its ${purchase.products.length} units have been sold or transferred.`;
    }
    const gone = purchase.products.filter((u) => u.status !== 'in_stock');
    if (gone.length > 0) {
      return `${purchase.invoiceNumber} cannot be deleted: ${gone.length} of its units are no longer in stock.`;
    }
    if (Number(purchase.amountPaid) > 0) {
      return `${purchase.invoiceNumber} cannot be deleted: it has payments recorded against it. Reverse those first.`;
    }
  }
  return null;
}

export const purchasesService = {
  /**
   * List purchases.
   *
   * `scope` supports three modes:
   *  - single shop: `{ shopId: 'x' }` (default)
   *  - all user-accessible shops: `{ shopId, shopIds: [...] }` — set when
   *    the user picks "All Shops" in the header dropdown (gated by
   *    `shops.view_all` in the middleware).
   *  - completely unscoped: `{ shopId: null }` — legacy escape hatch used
   *    by the Distributor Detail page when an admin opens a distributor's
   *    full purchase history across every shop.
   */
  async list(
    scope: { shopId: string | null; shopIds?: string[] },
    filters: {
      skip: number;
      take: number;
      page: number;
      pageSize: number;
      distributorId?: string;
      dateFrom?: string;
      dateTo?: string;
      paymentStatus?: string;
      search?: string;
      /** 'manual' for ones keyed in, 'excel_import' for ones read off a sheet. */
      source?: string;
    },
  ) {
    const where: Prisma.PurchaseWhereInput = {};

    if (scope.shopIds && scope.shopIds.length > 0) {
      where.shopId = { in: scope.shopIds };
    } else if (scope.shopId) {
      where.shopId = scope.shopId;
    }

    if (filters.distributorId) {
      where.distributorId = filters.distributorId;
    }

    if (filters.source) {
      where.source = filters.source;
    }

    if (filters.paymentStatus) {
      where.paymentStatus = filters.paymentStatus;
    }

    if (filters.search?.trim()) {
      where.invoiceNumber = { contains: filters.search.trim(), mode: 'insensitive' };
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

  /**
   * Lightweight existence check used by the New Purchase wizard to block
   * the user from advancing (and from submitting) when the invoice number
   * has already been recorded for that distributor.
   *
   * The check is intentionally global: the same invoice number recorded under
   * a *different* distributor (e.g. a duplicate distributor record created by
   * OCR) is still a strong duplicate signal, so we surface it too. The caller
   * can compare `matchedDistributorId` against the distributor it expects to
   * decide whether to block or merely warn.
   */
  async checkInvoiceExists(invoiceNumber: string, distributorId?: string) {
    const trimmed = invoiceNumber.trim();
    if (!trimmed) return { exists: false as const };

    // 1. Exact match for the supplied distributor (the blocking case).
    if (distributorId) {
      const sameDistributor = await prisma.purchase.findFirst({
        where: {
          distributorId,
          invoiceNumber: { equals: trimmed, mode: 'insensitive' },
        },
        select: { id: true, invoiceDate: true, totalAmount: true },
      });
      if (sameDistributor) {
        return {
          exists: true as const,
          sameDistributor: true as const,
          purchase: sameDistributor,
        };
      }
    }

    // 2. Same invoice number under any other distributor (the warning case).
    const anyMatch = await prisma.purchase.findFirst({
      where: { invoiceNumber: { equals: trimmed, mode: 'insensitive' } },
      select: {
        id: true,
        invoiceDate: true,
        totalAmount: true,
        distributorId: true,
        distributor: { select: { companyName: true } },
      },
    });
    if (anyMatch) {
      return {
        exists: true as const,
        sameDistributor: false as const,
        purchase: { id: anyMatch.id, invoiceDate: anyMatch.invoiceDate, totalAmount: anyMatch.totalAmount },
        matchedDistributorId: anyMatch.distributorId,
        matchedDistributorName: anyMatch.distributor?.companyName ?? null,
      };
    }

    return { exists: false as const };
  },

  async create(shopId: string, tenantId: string, data: {
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

    // Check for duplicate invoice number for the same distributor
    const existingInvoice = await prisma.purchase.findFirst({
      where: { invoiceNumber: data.invoiceNumber, distributorId: data.distributorId },
    });
    if (existingInvoice) {
      throw new Error(`Invoice number "${data.invoiceNumber}" already exists for this distributor`);
    }
    // Check for duplicate serial numbers within the items array itself
    const serialNumbers = data.items.filter(i => i.serialNumber).map(i => i.serialNumber!);
    const duplicateSerials = serialNumbers.filter((sn, i) => serialNumbers.indexOf(sn) !== i);
    if (duplicateSerials.length > 0) {
      throw new Error(`Duplicate serial numbers in items: ${[...new Set(duplicateSerials)].join(', ')}`);
    }

    // Check serial numbers against existing products in DB (scoped to same category)
    for (const item of data.items) {
      if (item.serialNumber) {
        const existingProduct = await prisma.product.findFirst({
          where: { serialNumber: item.serialNumber, categoryId: item.categoryId },
        });
        if (existingProduct) {
          throw new Error(`Serial number "${item.serialNumber}" already exists for this product category`);
        }
      }
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
          tenantId,
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
            tenantId,
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
            tenantId,
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

      /*
       * Keep the distributor's "categories supplied" list in step with what
       * they actually invoice us for. The list is otherwise only editable by
       * hand on the distributor form, so it drifts the moment a supplier
       * starts shipping a new kind of product.
       *
       * `skipDuplicates` leans on the @@unique([distributorId, categoryId])
       * constraint, so this is a no-op for categories already linked and we
       * avoid a read-then-write race between concurrent purchases.
       */
      const purchasedCategoryIds = [...new Set(data.items.map((i) => i.categoryId))];
      if (purchasedCategoryIds.length > 0) {
        await tx.distributorCategory.createMany({
          data: purchasedCategoryIds.map((categoryId) => ({
            tenantId,
            distributorId: data.distributorId,
            categoryId,
          })),
          skipDuplicates: true,
        });
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

  /**
   * Record a purchase made without a bill.
   *
   * Furniture and almirahs are often bought with no supplier invoice at all.
   * The goods are real stock from a real supplier, so they are recorded like
   * any other purchase; what differs is that there is no tax to account for
   * and the invoice number is one the shop issues itself, the next in that
   * product type's own series.
   *
   * The number is taken inside the same transaction that writes the purchase,
   * so a failure here never burns a number and two people saving at once
   * cannot be handed the same one. That also means the caller cannot know the
   * number in advance — the saved purchase is what says what it became.
   */
  async createUnbilled(shopId: string, tenantId: string, data: {
    distributorId: string;
    /** The non-billed type whose numbering this purchase takes, e.g. Furniture. */
    seriesCategoryId: string;
    invoiceDate: string;
    notes?: string | null;
    items: Array<{
      categoryId: string;
      brand: string;
      modelNumber: string;
      serialNumber?: string | null;
      mrp?: number;
      sellingPrice?: number;
      purchasePrice: number;
      color?: string | null;
      warrantyMonths?: number | null;
      barcode?: string | null;
      dynamicAttributes?: Record<string, unknown>;
    }>;
  }, userId: string) {
    const distributor = await prisma.distributor.findFirst({
      where: { id: data.distributorId, tenantId },
      select: { id: true, companyName: true },
    });
    if (!distributor) {
      throw new Error('Distributor not found');
    }

    const seriesCategory = await prisma.productCategory.findFirst({
      where: { id: data.seriesCategoryId, tenantId },
      select: { id: true, name: true },
    });
    if (!seriesCategory) {
      throw new Error('Product type not found');
    }

    // Serial numbers are optional here — a wardrobe has none — but one that
    // is given still has to be unique, the same as on a billed purchase.
    const serialNumbers = data.items.map((i) => i.serialNumber).filter((sn): sn is string => Boolean(sn));
    const duplicateSerials = serialNumbers.filter((sn, i) => serialNumbers.indexOf(sn) !== i);
    if (duplicateSerials.length > 0) {
      throw new Error(`Duplicate serial numbers in items: ${[...new Set(duplicateSerials)].join(', ')}`);
    }
    for (const item of data.items) {
      if (!item.serialNumber) continue;
      const clash = await prisma.product.findFirst({
        where: { serialNumber: item.serialNumber, categoryId: item.categoryId },
        select: { id: true },
      });
      if (clash) {
        throw new Error(`Serial number "${item.serialNumber}" already exists for this product category`);
      }
    }

    const categoryIds = [...new Set(data.items.map((item) => item.categoryId))];
    const categories = await prisma.productCategory.findMany({
      where: { id: { in: categoryIds }, tenantId },
      include: { attributes: { where: { isActive: true } } },
    });
    if (categories.length !== categoryIds.length) {
      throw new Error('One or more category IDs are invalid');
    }
    const categoryMap = new Map(categories.map((c) => [c.id, c]));

    for (const item of data.items) {
      const category = categoryMap.get(item.categoryId)!;
      const dynamicAttributes = item.dynamicAttributes ?? {};
      for (const attr of category.attributes.filter((a) => a.isRequired)) {
        const value = dynamicAttributes[attr.attributeName];
        if (value === undefined || value === null || value === '') {
          throw new Error(`Required attribute "${attr.attributeLabel}" is missing for item "${item.brand} ${item.modelNumber}"`);
        }
      }
    }

    const totalAmount = data.items.reduce((sum, item) => sum + (Number(item.purchasePrice) || 0), 0);
    const invoiceDate = new Date(data.invoiceDate);

    const result = await prisma.$transaction(async (tx) => {
      const invoiceNumber = await unbilledSeriesService.take(tx, tenantId, data.seriesCategoryId);

      const purchase = await tx.purchase.create({
        data: {
          tenantId,
          shopId,
          distributorId: data.distributorId,
          invoiceNumber,
          invoiceDate,
          // No bill means no tax, and nothing is being discounted off a price
          // nobody wrote down: what was paid for the goods is the whole of it.
          totalAmount,
          gstAmount: 0,
          discountAmount: 0,
          netAmount: totalAmount,
          amountPaid: 0,
          paymentStatus: 'pending',
          notes: data.notes ?? null,
          billed: false,
          source: 'manual',
          createdBy: userId,
        },
      });

      // One product row per unit, written the way the sheet import writes
      // them so stock looks the same however the purchase was entered.
      const units: Prisma.ProductCreateManyInput[] = [];
      for (const item of data.items) {
        const attributes: Record<string, unknown> = { ...(item.dynamicAttributes ?? {}) };
        const mrp = Number(item.mrp) > 0 ? Number(item.mrp) : null;
        const sellingPrice = Number(item.sellingPrice) > 0 ? Number(item.sellingPrice) : null;
        // Nobody has priced it for the shop floor yet. Rather than invent a
        // retail price, the unit is held at cost and marked, so it can be
        // found and priced before it is sold.
        if (!mrp && !sellingPrice) attributes.priceNotSet = true;

        let warrantyExpiry: Date | null = null;
        if (item.warrantyMonths && item.warrantyMonths > 0) {
          warrantyExpiry = new Date(invoiceDate);
          warrantyExpiry.setMonth(warrantyExpiry.getMonth() + item.warrantyMonths);
        }

        units.push({
          tenantId,
          shopId,
          categoryId: item.categoryId,
          brand: ((item.dynamicAttributes?.brand as string) || item.brand).slice(0, 200),
          modelNumber: item.modelNumber.slice(0, 200),
          serialNumber: item.serialNumber ?? null,
          mrp: mrp ?? sellingPrice ?? item.purchasePrice,
          sellingPrice: sellingPrice ?? mrp ?? item.purchasePrice,
          purchasePrice: item.purchasePrice,
          color: item.color ?? null,
          distributorId: data.distributorId,
          purchaseId: purchase.id,
          status: 'in_stock',
          dynamicAttributes: attributes as Prisma.InputJsonValue,
          warrantyMonths: item.warrantyMonths ?? null,
          warrantyExpiry,
          barcode: item.barcode ?? null,
          createdBy: userId,
        });
      }

      const products = await tx.product.createManyAndReturn({ data: units, select: { id: true } });
      await tx.productAuditTrail.createMany({
        data: products.map((product) => ({
          tenantId,
          productId: product.id,
          eventType: 'purchased',
          toShopId: shopId,
          referenceId: purchase.id,
          referenceType: 'purchase',
          performedBy: userId,
          notes: `Purchased without a bill from ${distributor.companyName}, Invoice: ${invoiceNumber}`,
        })),
      });

      // Keep the supplier's "categories supplied" list in step, the same as
      // a billed purchase does.
      await tx.distributorCategory.createMany({
        data: categoryIds.map((categoryId) => ({ tenantId, distributorId: data.distributorId, categoryId })),
        skipDuplicates: true,
      });

      return purchase;
    });

    return prisma.purchase.findUnique({
      where: { id: result.id },
      include: {
        distributor: { select: { id: true, companyName: true, contactPerson: true } },
        products: {
          include: { category: { select: { id: true, name: true, slug: true, path: true } } },
        },
        creator: { select: { id: true, username: true, fullName: true } },
      },
    });
  },

  /**
   * Delete purchases, and the units they brought in.
   *
   * A purchase is not a record of itself: it is where stock came from. Taking
   * it away has to take its units with it, or the shop is left holding goods
   * that arrived from nowhere. So anything that has already moved on — sold,
   * transferred, or simply no longer in stock — stops the whole thing, and
   * the caller is told which purchase and why rather than being left with
   * half of one deleted.
   *
   * All or nothing: either every purchase named goes, or none does.
   */
  async remove(ids: string[], scope: { shopId?: string; shopIds?: string[] }) {
    const where: Prisma.PurchaseWhereInput = { id: { in: ids } };
    if (scope.shopIds && scope.shopIds.length > 0) {
      where.shopId = { in: scope.shopIds };
    } else if (scope.shopId) {
      where.shopId = scope.shopId;
    }

    const purchases = await prisma.purchase.findMany({
      where,
      select: {
        id: true,
        invoiceNumber: true,
        amountPaid: true,
        products: { select: { id: true, status: true, modelNumber: true } },
      },
    });

    const missing = ids.filter((id) => !purchases.some((p) => p.id === id));
    if (missing.length > 0) {
      throw new PurchaseInUseError(
        missing.length === ids.length
          ? 'That purchase is not here to delete.'
          : `${missing.length} of those purchases are not here to delete.`,
      );
    }

    const blocked = await reasonPurchasesCannotBeDeleted(purchases);
    if (blocked) throw new PurchaseInUseError(blocked);

    const productIds = purchases.flatMap((p) => p.products.map((u) => u.id));
    const purchaseIds = purchases.map((p) => p.id);
    return prisma.$transaction(async (tx) => {
      await tx.productAuditTrail.deleteMany({ where: { productId: { in: productIds } } });
      await tx.purchasePayment.deleteMany({ where: { purchaseId: { in: purchaseIds } } });
      const units = await tx.product.deleteMany({ where: { id: { in: productIds } } });
      const removed = await tx.purchase.deleteMany({ where: { id: { in: purchaseIds } } });
      return { purchases: removed.count, units: units.count };
    });
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

    // Check for duplicate invoice number if it's being changed
    if (data.invoiceNumber && data.invoiceNumber !== existing.invoiceNumber) {
      const duplicateInvoice = await prisma.purchase.findFirst({
        where: {
          invoiceNumber: data.invoiceNumber,
          distributorId: existing.distributorId,
          id: { not: id },
        },
      });
      if (duplicateInvoice) {
        throw new Error(`Invoice number "${data.invoiceNumber}" already exists for this distributor`);
      }
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
      // Create the payment record. Tenant comes from the parent purchase so
      // the payment always belongs to the same tenant as its invoice.
      const payment = await tx.purchasePayment.create({
        data: {
          tenantId: purchase.tenantId,
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
