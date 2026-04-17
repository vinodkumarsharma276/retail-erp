import { prisma } from '../../config/database.js';
import type { Prisma } from '@prisma/client';

export const productsService = {
  async list(shopId: string, filters: {
    skip: number;
    take: number;
    page: number;
    pageSize: number;
    categoryId?: string;
    status?: string;
    brand?: string;
    search?: string;
  }) {
    const where: Prisma.ProductWhereInput = {
      shopId,
    };

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
      where.OR = [
        { modelNumber: { contains: filters.search, mode: 'insensitive' } },
        { brand: { contains: filters.search, mode: 'insensitive' } },
        { serialNumber: { contains: filters.search, mode: 'insensitive' } },
      ];
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
        },
        orderBy: { createdAt: 'desc' },
        skip: filters.skip,
        take: filters.take,
      }),
      prisma.product.count({ where }),
    ]);

    return { products, totalItems };
  },

  async globalSearch(shopId: string, query: string) {
    const products = await prisma.product.findMany({
      where: {
        shopId,
        OR: [
          { modelNumber: { contains: query, mode: 'insensitive' } },
          { brand: { contains: query, mode: 'insensitive' } },
          { serialNumber: { contains: query, mode: 'insensitive' } },
        ],
      },
      include: {
        category: {
          select: { id: true, name: true, slug: true, path: true },
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
