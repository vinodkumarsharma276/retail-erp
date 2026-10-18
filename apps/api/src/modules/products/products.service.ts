import { prisma } from '../../config/database.js';
import type { Prisma } from '@prisma/client';

export const productsService = {
  /**
   * List products with pagination/filters.
   *
   * `scope` supports two modes:
   *  - single shop: `{ shopId: string }` (default)
   *  - all shops the user has access to: `{ shopId, shopIds: string[] }`
   *    — used when the user picks "All Shops" in the header (gated by
   *    the `shops.view_all` permission in the middleware).
   */
  async list(
    scope: { shopId: string; shopIds?: string[] },
    filters: {
      skip: number;
      take: number;
      page: number;
      pageSize: number;
      categoryId?: string;
      status?: string;
      brand?: string;
      search?: string;
      dateFrom?: string;
      dateTo?: string;
    },
  ) {
    const where: Prisma.ProductWhereInput =
      scope.shopIds && scope.shopIds.length > 0
        ? { shopId: { in: scope.shopIds } }
        : { shopId: scope.shopId };

    if (filters.categoryId) {
      // Check if this is a root category (has children) — if so, filter by all child IDs
      const category = await prisma.productCategory.findUnique({
        where: { id: filters.categoryId },
        select: { isLeaf: true },
      });
      if (category && !category.isLeaf) {
        const children = await prisma.productCategory.findMany({
          where: { parentId: filters.categoryId },
          select: { id: true },
        });
        where.categoryId = { in: children.map((c) => c.id) };
      } else {
        where.categoryId = filters.categoryId;
      }
    }

    if (filters.status) {
      where.status = filters.status as any;
    }

    if (filters.brand) {
      where.brand = { contains: filters.brand, mode: 'insensitive' };
    }

    if (filters.search) {
      const orClauses: Prisma.ProductWhereInput[] = [
        { modelNumber: { contains: filters.search, mode: 'insensitive' } },
        { brand: { contains: filters.search, mode: 'insensitive' } },
        { serialNumber: { contains: filters.search, mode: 'insensitive' } },
      ];
      // IMEI search — when the query looks like a full IMEI (15 digits),
      // also match products whose `dynamicAttributes.imeiNumbers` array
      // contains that exact value. Used so staff can find a phone in
      // stock by typing/scanning the IMEI off the box.
      if (/^\d{15}$/.test(filters.search)) {
        orClauses.push({
          dynamicAttributes: {
            path: ['imeiNumbers'],
            array_contains: filters.search,
          } as any,
        });
      }
      where.OR = orClauses;
    }

    // Filter by purchase invoice date (date of purchase). Only matches
    // products that are linked to a Purchase with an invoiceDate in range.
    if (filters.dateFrom || filters.dateTo) {
      const invoiceDate: Prisma.DateTimeFilter = {};
      if (filters.dateFrom) invoiceDate.gte = new Date(filters.dateFrom);
      if (filters.dateTo) {
        const to = new Date(filters.dateTo);
        to.setHours(23, 59, 59, 999);
        invoiceDate.lte = to;
      }
      where.purchase = { is: { invoiceDate } };
    }

    const [products, totalItems] = await Promise.all([
      prisma.product.findMany({
        where,
        include: {
          category: {
            select: { id: true, name: true, slug: true, path: true },
          },
          distributor: {
            select: { id: true, companyName: true },
          },
          purchase: {
            select: { id: true, invoiceDate: true, invoiceNumber: true },
          },
          shop: {
            select: { id: true, name: true, code: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: filters.skip,
        take: filters.take,
      }),
      prisma.product.count({ where }),
    ]);

    return { products, totalItems };
  },

  /**
   * List products grouped by (shopId, categoryId, brand, modelNumber, status).
   * Same filters as `list`. Each group includes the unit count and price
   * range; the UI can lazy-fetch the individual units via `list` filtered
   * by brand+model+category when the row is expanded.
   */
  async listGrouped(
    scope: { shopId: string; shopIds?: string[] },
    filters: {
      skip: number;
      take: number;
      page: number;
      pageSize: number;
      categoryId?: string;
      status?: string;
      brand?: string;
      search?: string;
      dateFrom?: string;
      dateTo?: string;
    },
  ) {
    const where: Prisma.ProductWhereInput =
      scope.shopIds && scope.shopIds.length > 0
        ? { shopId: { in: scope.shopIds } }
        : { shopId: scope.shopId };

    if (filters.categoryId) {
      const category = await prisma.productCategory.findUnique({
        where: { id: filters.categoryId },
        select: { isLeaf: true },
      });
      if (category && !category.isLeaf) {
        const children = await prisma.productCategory.findMany({
          where: { parentId: filters.categoryId },
          select: { id: true },
        });
        where.categoryId = { in: children.map((c) => c.id) };
      } else {
        where.categoryId = filters.categoryId;
      }
    }
    if (filters.status) where.status = filters.status as any;
    if (filters.brand) where.brand = { contains: filters.brand, mode: 'insensitive' };
    if (filters.search) {
      const orClauses: Prisma.ProductWhereInput[] = [
        { modelNumber: { contains: filters.search, mode: 'insensitive' } },
        { brand: { contains: filters.search, mode: 'insensitive' } },
        { serialNumber: { contains: filters.search, mode: 'insensitive' } },
      ];
      if (/^\d{15}$/.test(filters.search)) {
        orClauses.push({
          dynamicAttributes: { path: ['imeiNumbers'], array_contains: filters.search } as any,
        });
      }
      where.OR = orClauses;
    }
    if (filters.dateFrom || filters.dateTo) {
      const invoiceDate: Prisma.DateTimeFilter = {};
      if (filters.dateFrom) invoiceDate.gte = new Date(filters.dateFrom);
      if (filters.dateTo) {
        const to = new Date(filters.dateTo);
        to.setHours(23, 59, 59, 999);
        invoiceDate.lte = to;
      }
      where.purchase = { is: { invoiceDate } };
    }

    // Aggregate in DB. Group by the natural key so each group is one
    // model line in a particular shop with a particular status.
    const groups = await prisma.product.groupBy({
      by: ['shopId', 'categoryId', 'brand', 'modelNumber', 'status'],
      where,
      _count: { _all: true },
      _min: { mrp: true, purchasePrice: true, createdAt: true },
      _max: { mrp: true, purchasePrice: true, createdAt: true },
      orderBy: [{ _max: { createdAt: 'desc' } }],
    });

    const totalItems = groups.length;
    const pageSlice = groups.slice(filters.skip, filters.skip + filters.take);

    // Hydrate referenced shop + category names in one shot.
    const shopIds = [...new Set(pageSlice.map((g) => g.shopId))];
    const categoryIds = [...new Set(pageSlice.map((g) => g.categoryId))];
    const [shops, categories] = await Promise.all([
      prisma.shop.findMany({
        where: { id: { in: shopIds } },
        select: { id: true, name: true, code: true },
      }),
      prisma.productCategory.findMany({
        where: { id: { in: categoryIds } },
        select: { id: true, name: true, slug: true, path: true },
      }),
    ]);
    const shopMap = new Map(shops.map((s) => [s.id, s]));
    const categoryMap = new Map(categories.map((c) => [c.id, c]));

    // How many units of each group are still missing something. A sheet says
    // what was bought and little else, so these gaps are normal and need to
    // be visible on the list rather than only inside each unit. Counted for
    // the page being shown, never the whole table.
    const groupKey = (g: { shopId: string; categoryId: string; brand: string; modelNumber: string; status: string }) =>
      [g.shopId, g.categoryId, g.brand, g.modelNumber, g.status].join("|");
    const incomplete = new Map<string, { model: number; price: number; specs: number }>();
    if (pageSlice.length > 0) {
      const units = await prisma.product.findMany({
        where: {
          AND: [
            where,
            {
              OR: pageSlice.map((g) => ({
                shopId: g.shopId,
                categoryId: g.categoryId,
                brand: g.brand,
                modelNumber: g.modelNumber,
                status: g.status,
              })),
            },
          ],
        },
        select: {
          shopId: true, categoryId: true, brand: true, modelNumber: true, status: true,
          dynamicAttributes: true,
        },
      });
      const BOOKKEEPING = new Set([
        'importedFrom', 'priceNotSet', 'modelNotSet', 'isDemoUnit',
        'mrpSuggestion', 'specsLookedUpAt', 'needsReview', 'imeiNumbers',
      ]);
      for (const unit of units) {
        const key = groupKey(unit);
        const entry = incomplete.get(key) ?? { model: 0, price: 0, specs: 0 };
        const attributes = (unit.dynamicAttributes ?? {}) as Record<string, unknown>;
        if (attributes.modelNotSet === true) entry.model += 1;
        if (attributes.priceNotSet === true) entry.price += 1;
        const hasSpecs = Object.entries(attributes).some(
          ([k, v]) => !BOOKKEEPING.has(k) && v !== null && v !== undefined && v !== '',
        );
        if (!hasSpecs) entry.specs += 1;
        incomplete.set(key, entry);
      }
    }

    const rows = pageSlice.map((g) => ({
      shopId: g.shopId,
      shop: shopMap.get(g.shopId) ?? null,
      categoryId: g.categoryId,
      category: categoryMap.get(g.categoryId) ?? null,
      brand: g.brand,
      modelNumber: g.modelNumber,
      status: g.status,
      quantity: g._count._all,
      needsAttention: incomplete.get(groupKey(g)) ?? { model: 0, price: 0, specs: 0 },
      mrpMin: g._min.mrp,
      mrpMax: g._max.mrp,
      purchasePriceMin: g._min.purchasePrice,
      purchasePriceMax: g._max.purchasePrice,
      oldestPurchase: g._min.createdAt,
      latestPurchase: g._max.createdAt,
    }));

    return { groups: rows, totalItems };
  },

  async globalSearch(
    scope: { shopId: string; shopIds?: string[] },
    query: string,
  ) {
    const orClauses: Prisma.ProductWhereInput[] = [
      { modelNumber: { contains: query, mode: 'insensitive' } },
      { brand: { contains: query, mode: 'insensitive' } },
      { serialNumber: { contains: query, mode: 'insensitive' } },
    ];
    // Match on a stored IMEI when the query is a full 15-digit value.
    if (/^\d{15}$/.test(query)) {
      orClauses.push({
        dynamicAttributes: {
          path: ['imeiNumbers'],
          array_contains: query,
        } as any,
      });
    }

    const products = await prisma.product.findMany({
      where: {
        ...(scope.shopIds && scope.shopIds.length > 0
          ? { shopId: { in: scope.shopIds } }
          : { shopId: scope.shopId }),
        OR: orClauses,
      },
      include: {
        category: {
          select: { id: true, name: true, slug: true, path: true },
        },
        purchase: {
          select: { id: true, invoiceDate: true, gstAmount: true, totalAmount: true, discountAmount: true },
        },
        shop: {
          select: { id: true, name: true, code: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50, // Limit search results
    });

    return products;
  },

  async getById(id: string) {
    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        category: {
          include: {
            attributes: {
              where: { isActive: true },
              orderBy: { displayOrder: 'asc' },
            },
          },
        },
        distributor: {
          select: { id: true, companyName: true, contactPerson: true },
        },
        purchase: {
          select: { id: true, invoiceDate: true, gstAmount: true, totalAmount: true, discountAmount: true },
        },
        creator: {
          select: { id: true, username: true, fullName: true },
        },
        auditTrail: {
          orderBy: { createdAt: 'desc' },
          include: {
            performer: {
              select: { id: true, username: true, fullName: true },
            },
          },
        },
      },
    });

    return product;
  },

  async create(shopId: string, data: {
    categoryId: string;
    brand: string;
    modelNumber: string;
    serialNumber?: string | null;
    mrp: number;
    sellingPrice: number;
    purchasePrice: number;
    color?: string | null;
    weightKg?: number | null;
    distributorId?: string | null;
    warrantyMonths?: number | null;
    barcode?: string | null;
    notes?: string | null;
    dynamicAttributes?: Record<string, unknown>;
  }, userId: string) {
    // Validate category exists
    const category = await prisma.productCategory.findUnique({
      where: { id: data.categoryId },
      include: {
        attributes: {
          where: { isActive: true },
        },
      },
    });
    if (!category) {
      throw new Error('Category not found');
    }

    // Validate dynamicAttributes against category attributes
    const dynamicAttributes = data.dynamicAttributes ?? {};
    const requiredAttrs = category.attributes.filter((a) => a.isRequired);
    for (const attr of requiredAttrs) {
      const value = dynamicAttributes[attr.attributeName];
      if (value === undefined || value === null || value === '') {
        throw new Error(`Required attribute "${attr.attributeLabel}" is missing`);
      }
    }

    // Validate distributor exists if provided
    if (data.distributorId) {
      const distributor = await prisma.distributor.findUnique({
        where: { id: data.distributorId },
      });
      if (!distributor) {
        throw new Error('Distributor not found');
      }
    }

    // Calculate warranty expiry if warrantyMonths provided
    let warrantyExpiry: Date | undefined;
    if (data.warrantyMonths && data.warrantyMonths > 0) {
      warrantyExpiry = new Date();
      warrantyExpiry.setMonth(warrantyExpiry.getMonth() + data.warrantyMonths);
    }

    const product = await prisma.product.create({
      data: {
        shopId,
        categoryId: data.categoryId,
        brand: data.brand,
        modelNumber: data.modelNumber,
        serialNumber: data.serialNumber ?? null,
        mrp: data.mrp,
        sellingPrice: data.sellingPrice,
        purchasePrice: data.purchasePrice,
        color: data.color ?? null,
        weightKg: data.weightKg ?? null,
        distributorId: data.distributorId ?? null,
        status: 'in_stock',
        dynamicAttributes: dynamicAttributes as any,
        warrantyMonths: data.warrantyMonths ?? null,
        warrantyExpiry: warrantyExpiry ?? null,
        barcode: data.barcode ?? null,
        notes: data.notes ?? null,
        createdBy: userId,
      },
      include: {
        category: {
          select: { id: true, name: true, slug: true, path: true },
        },
      },
    });

    // Create audit trail entry for purchase/creation
    await productsService.createAuditEntry(product.id, 'purchased', {
      toShopId: shopId,
      performedBy: userId,
      notes: 'Product added to inventory',
    });

    return product;
  },

  async update(id: string, data: {
    categoryId?: string;
    brand?: string;
    modelNumber?: string;
    serialNumber?: string | null;
    mrp?: number;
    sellingPrice?: number;
    purchasePrice?: number;
    color?: string | null;
    weightKg?: number | null;
    distributorId?: string | null;
    warrantyMonths?: number | null;
    barcode?: string | null;
    notes?: string | null;
    dynamicAttributes?: Record<string, unknown>;
    status?: string;
  }) {
    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) {
      return null;
    }

    // Validate category if changed
    if (data.categoryId) {
      const category = await prisma.productCategory.findUnique({
        where: { id: data.categoryId },
      });
      if (!category) {
        throw new Error('Category not found');
      }
    }

    // Validate distributor if changed
    if (data.distributorId) {
      const distributor = await prisma.distributor.findUnique({
        where: { id: data.distributorId },
      });
      if (!distributor) {
        throw new Error('Distributor not found');
      }
    }

    // Check for duplicate serial number within the same category
    if (data.serialNumber) {
      const categoryId = data.categoryId || existing.categoryId;
      const duplicate = await prisma.product.findFirst({
        where: {
          serialNumber: data.serialNumber,
          categoryId,
          id: { not: id },
        },
      });
      if (duplicate) {
        throw new Error(`Serial number "${data.serialNumber}" already exists for this product category`);
      }
    }

    // Recalculate warranty expiry if warrantyMonths changed
    const updateData: Record<string, unknown> = { ...data };
    if (data.warrantyMonths !== undefined) {
      if (data.warrantyMonths && data.warrantyMonths > 0) {
        const warrantyExpiry = new Date(existing.createdAt);
        warrantyExpiry.setMonth(warrantyExpiry.getMonth() + data.warrantyMonths);
        updateData.warrantyExpiry = warrantyExpiry;
      } else {
        updateData.warrantyExpiry = null;
      }
    }

    if (data.dynamicAttributes !== undefined) {
      updateData.dynamicAttributes = data.dynamicAttributes as any;
    }

    const updated = await prisma.product.update({
      where: { id },
      data: updateData as any,
      include: {
        category: {
          select: { id: true, name: true, slug: true, path: true },
        },
      },
    });

    return updated;
  },

  async getHistory(productId: string) {
    const product = await prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product) {
      return null;
    }

    const history = await prisma.productAuditTrail.findMany({
      where: { productId },
      orderBy: { createdAt: 'desc' },
      include: {
        performer: {
          select: { id: true, username: true, fullName: true },
        },
      },
    });

    return history;
  },

  async canSell(productId: string) {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, status: true, shopId: true },
    });

    if (!product) {
      return null;
    }

    return {
      productId: product.id,
      canSell: product.status === 'in_stock',
      status: product.status,
      shopId: product.shopId,
    };
  },

  async createAuditEntry(productId: string, eventType: string, data: {
    fromShopId?: string | null;
    toShopId?: string | null;
    referenceId?: string | null;
    referenceType?: string | null;
    notes?: string | null;
    performedBy?: string | null;
  }) {
    const entry = await prisma.productAuditTrail.create({
      data: {
        productId,
        eventType,
        fromShopId: data.fromShopId ?? null,
        toShopId: data.toShopId ?? null,
        referenceId: data.referenceId ?? null,
        referenceType: data.referenceType ?? null,
        notes: data.notes ?? null,
        performedBy: data.performedBy ?? null,
      },
    });

    return entry;
  },
};
