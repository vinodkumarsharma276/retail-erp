import { prisma } from '../../config/database.js';
import type { Prisma } from '@prisma/client';

export const distributorsService = {
  async list(filters: {
    skip: number;
    take: number;
    page: number;
    pageSize: number;
    search?: string;
  }) {
    const where: Prisma.DistributorWhereInput = {};

    if (filters.search) {
      where.OR = [
        { companyName: { contains: filters.search, mode: 'insensitive' } },
        { phone: { contains: filters.search, mode: 'insensitive' } },
        { gstNumber: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const [distributors, totalItems] = await Promise.all([
      prisma.distributor.findMany({
        where,
        include: {
          categories: {
            include: {
              category: {
                select: { id: true, name: true, slug: true, path: true },
              },
            },
          },
        },
        orderBy: { companyName: 'asc' },
        skip: filters.skip,
        take: filters.take,
      }),
      prisma.distributor.count({ where }),
    ]);

    // Compute aggregates for each distributor
    const distributorIds = distributors.map((d) => d.id);

    // Get total products purchased (products linked via purchases)
    const productCounts = await prisma.product.groupBy({
      by: ['distributorId'],
      where: { distributorId: { in: distributorIds } },
      _count: { id: true },
    });

    // Get total payment paid (sum of purchase_payments)
    const paymentSums = await prisma.purchasePayment.groupBy({
      by: ['purchaseId'],
      where: {
        purchase: { distributorId: { in: distributorIds } },
      },
      _sum: { amount: true },
    });

    // Map purchaseId -> distributorId for aggregation
    const purchases = await prisma.purchase.findMany({
      where: { distributorId: { in: distributorIds } },
      select: { id: true, distributorId: true, netAmount: true, amountPaid: true },
    });

    const distributorPayments: Record<string, number> = {};
    const distributorPending: Record<string, number> = {};

    for (const purchase of purchases) {
      const distId = purchase.distributorId;
      distributorPayments[distId] = (distributorPayments[distId] || 0) + Number(purchase.amountPaid);
      distributorPending[distId] = (distributorPending[distId] || 0) + (Number(purchase.netAmount) - Number(purchase.amountPaid));
    }

    const productCountMap: Record<string, number> = {};
    for (const pc of productCounts) {
      if (pc.distributorId) {
        productCountMap[pc.distributorId] = pc._count.id;
      }
    }

    const enriched = distributors.map((d) => ({
      ...d,
      totalProductsPurchased: productCountMap[d.id] || 0,
      totalPaymentPaid: distributorPayments[d.id] || 0,
      pendingPayment: distributorPending[d.id] || 0,
    }));

    return { distributors: enriched, totalItems };
  },

  async getById(id: string) {
    const distributor = await prisma.distributor.findUnique({
      where: { id },
      include: {
        categories: {
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

    return distributor;
  },

  async create(data: {
    companyName: string;
    contactPerson: string;
    phone: string;
    altPhone?: string | null;
    email?: string | null;
    gstNumber?: string | null;
    panNumber?: string | null;
    addressLine1: string;
    addressLine2?: string | null;
    city: string;
    state: string;
    pincode: string;
    bankName?: string | null;
    bankAccountNumber?: string | null;
    bankIfsc?: string | null;
    bankBranch?: string | null;
    paymentTerms?: string | null;
    creditLimit?: number;
    categoryIds?: string[];
  }, userId: string) {
    const { categoryIds, ...distributorData } = data;

    // Check for duplicate GST number
    if (distributorData.gstNumber) {
      const existingGst = await prisma.distributor.findFirst({
        where: { gstNumber: distributorData.gstNumber },
      });
      if (existingGst) {
        throw new Error(`A distributor with GST number "${distributorData.gstNumber}" already exists (${existingGst.companyName})`);
      }
    }

    // Check for duplicate PAN number
    if (distributorData.panNumber) {
      const existingPan = await prisma.distributor.findFirst({
        where: { panNumber: distributorData.panNumber },
      });
      if (existingPan) {
        throw new Error(`A distributor with PAN number "${distributorData.panNumber}" already exists (${existingPan.companyName})`);
      }
    }

    // Check for duplicate bank account number
    if (distributorData.bankAccountNumber) {
      const existingBank = await prisma.distributor.findFirst({
        where: { bankAccountNumber: distributorData.bankAccountNumber },
      });
      if (existingBank) {
        throw new Error(`A distributor with bank account "${distributorData.bankAccountNumber}" already exists (${existingBank.companyName})`);
      }
    }

    // Validate categories exist if provided
    if (categoryIds && categoryIds.length > 0) {
      const categories = await prisma.productCategory.findMany({
        where: { id: { in: categoryIds } },
      });
      if (categories.length !== categoryIds.length) {
        throw new Error('One or more category IDs are invalid');
      }
    }

    const distributor = await prisma.distributor.create({
      data: {
        companyName: distributorData.companyName,
        contactPerson: distributorData.contactPerson,
        phone: distributorData.phone,
        altPhone: distributorData.altPhone ?? null,
        email: distributorData.email ?? null,
        gstNumber: distributorData.gstNumber ?? null,
        panNumber: distributorData.panNumber ?? null,
        addressLine1: distributorData.addressLine1,
        addressLine2: distributorData.addressLine2 ?? null,
        city: distributorData.city,
        state: distributorData.state,
        pincode: distributorData.pincode,
        bankName: distributorData.bankName ?? null,
        bankAccountNumber: distributorData.bankAccountNumber ?? null,
        bankIfsc: distributorData.bankIfsc ?? null,
        bankBranch: distributorData.bankBranch ?? null,
        paymentTerms: distributorData.paymentTerms ?? null,
        creditLimit: distributorData.creditLimit ?? 0,
        createdBy: userId,
        categories: categoryIds && categoryIds.length > 0
          ? {
              create: categoryIds.map((categoryId) => ({
                categoryId,
              })),
            }
          : undefined,
      },
      include: {
        categories: {
          include: {
            category: {
              select: { id: true, name: true, slug: true, path: true },
            },
          },
        },
      },
    });

    return distributor;
  },

  async update(id: string, data: {
    companyName?: string;
    contactPerson?: string;
    phone?: string;
    altPhone?: string | null;
    email?: string | null;
    gstNumber?: string | null;
    panNumber?: string | null;
    addressLine1?: string;
    addressLine2?: string | null;
    city?: string;
    state?: string;
    pincode?: string;
    bankName?: string | null;
    bankAccountNumber?: string | null;
    bankIfsc?: string | null;
    bankBranch?: string | null;
    paymentTerms?: string | null;
    creditLimit?: number;
    isActive?: boolean;
    categoryIds?: string[];
  }) {
    const existing = await prisma.distributor.findUnique({ where: { id } });
    if (!existing) {
      return null;
    }

    const { categoryIds, ...updateData } = data;

    // Check for duplicate GST number (exclude self)
    if (updateData.gstNumber) {
      const existingGst = await prisma.distributor.findFirst({
        where: { gstNumber: updateData.gstNumber, id: { not: id } },
      });
      if (existingGst) {
        throw new Error(`A distributor with GST number "${updateData.gstNumber}" already exists (${existingGst.companyName})`);
      }
    }

    // Check for duplicate PAN number (exclude self)
    if (updateData.panNumber) {
      const existingPan = await prisma.distributor.findFirst({
        where: { panNumber: updateData.panNumber, id: { not: id } },
      });
      if (existingPan) {
        throw new Error(`A distributor with PAN number "${updateData.panNumber}" already exists (${existingPan.companyName})`);
      }
    }

    // Check for duplicate bank account number (exclude self)
    if (updateData.bankAccountNumber) {
      const existingBank = await prisma.distributor.findFirst({
        where: { bankAccountNumber: updateData.bankAccountNumber, id: { not: id } },
      });
      if (existingBank) {
        throw new Error(`A distributor with bank account "${updateData.bankAccountNumber}" already exists (${existingBank.companyName})`);
      }
    }

    // Validate categories exist if provided
    if (categoryIds && categoryIds.length > 0) {
      const categories = await prisma.productCategory.findMany({
        where: { id: { in: categoryIds } },
      });
      if (categories.length !== categoryIds.length) {
        throw new Error('One or more category IDs are invalid');
      }
    }

    // Use transaction to update distributor and replace category associations
    const distributor = await prisma.$transaction(async (tx) => {
      // If categoryIds provided, replace all associations
      if (categoryIds !== undefined) {
        await tx.distributorCategory.deleteMany({
          where: { distributorId: id },
        });

        if (categoryIds.length > 0) {
          await tx.distributorCategory.createMany({
            data: categoryIds.map((categoryId) => ({
              distributorId: id,
              categoryId,
            })),
          });
        }
      }

      const updated = await tx.distributor.update({
        where: { id },
        data: updateData,
        include: {
          categories: {
            include: {
              category: {
                select: { id: true, name: true, slug: true, path: true },
              },
            },
          },
        },
      });

      return updated;
    });

    return distributor;
  },

  async getProducts(distributorId: string, filters: {
    skip: number;
    take: number;
    page: number;
    pageSize: number;
    dateFrom?: string;
    dateTo?: string;
  }) {
    // Verify distributor exists
    const distributor = await prisma.distributor.findUnique({
      where: { id: distributorId },
    });
    if (!distributor) {
      return null;
    }

    const where: Prisma.ProductWhereInput = {
      distributorId,
    };

    // Filter by date range via purchase.invoiceDate
    if (filters.dateFrom || filters.dateTo) {
      const purchaseFilter: Prisma.PurchaseWhereInput = {};
      if (filters.dateFrom) {
        purchaseFilter.invoiceDate = {
          ...(purchaseFilter.invoiceDate as object),
          gte: new Date(filters.dateFrom),
        };
      }
      if (filters.dateTo) {
        purchaseFilter.invoiceDate = {
          ...(purchaseFilter.invoiceDate as object),
          lte: new Date(filters.dateTo),
        };
      }
      where.purchase = purchaseFilter;
    }

    const [products, totalItems] = await Promise.all([
      prisma.product.findMany({
        where,
        include: {
          category: {
            select: { id: true, name: true, slug: true, path: true },
          },
          purchase: {
            select: { id: true, invoiceNumber: true, invoiceDate: true },
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

  async recordLumpsumPayment(
    distributorId: string,
    data: {
      amount: number;
      paymentMode: string;
      paymentDate: string;
      referenceNumber?: string;
      notes?: string;
    },
    userId: string,
  ) {
    // Verify distributor exists
    const distributor = await prisma.distributor.findUnique({
      where: { id: distributorId },
    });
    if (!distributor) {
      throw new Error('Distributor not found');
    }

    // Find all unpaid/partial purchases, oldest first (FIFO)
    const pendingPurchases = await prisma.purchase.findMany({
      where: {
        distributorId,
        paymentStatus: { not: 'paid' },
      },
      orderBy: { invoiceDate: 'asc' },
    });

    if (pendingPurchases.length === 0) {
      throw new Error('No pending invoices found for this distributor');
    }

    let remaining = data.amount;
    let invoicesPaidFull = 0;
    let invoicesPaidPartial = 0;
    let totalDistributed = 0;

    const result = await prisma.$transaction(async (tx) => {
      for (const purchase of pendingPurchases) {
        if (remaining <= 0) break;

        const pending = Number(purchase.netAmount) - Number(purchase.amountPaid);
        if (pending <= 0) continue;

        const payAmount = Math.min(remaining, pending);

        // Create PurchasePayment record
        await tx.purchasePayment.create({
          data: {
            purchaseId: purchase.id,
            amount: payAmount,
            paymentMode: data.paymentMode as any,
            paymentDate: new Date(data.paymentDate),
            referenceNumber: data.referenceNumber ?? null,
            notes: data.notes ?? null,
            createdBy: userId,
          },
        });

        const newAmountPaid = Number(purchase.amountPaid) + payAmount;
        const netAmount = Number(purchase.netAmount);

        // Determine new payment status
        let paymentStatus: string;
        if (newAmountPaid >= netAmount) {
          paymentStatus = 'paid';
          invoicesPaidFull++;
        } else {
          paymentStatus = 'partial';
          invoicesPaidPartial++;
        }

        // Update purchase
        await tx.purchase.update({
          where: { id: purchase.id },
          data: {
            amountPaid: newAmountPaid,
            paymentStatus,
          },
        });

        totalDistributed += payAmount;
        remaining -= payAmount;
      }

      return {
        totalDistributed,
        invoicesPaidFull,
        invoicesPaidPartial,
        remainingAmount: remaining,
      };
    });

    return result;
  },

  async getPayments(distributorId: string) {
    // Verify distributor exists
    const distributor = await prisma.distributor.findUnique({
      where: { id: distributorId },
    });
    if (!distributor) {
      return null;
    }

    // Get all purchases for this distributor, then their payments
    const purchases = await prisma.purchase.findMany({
      where: { distributorId },
      include: {
        payments: {
          include: {
            creator: {
              select: { id: true, username: true, fullName: true },
            },
          },
          orderBy: { paymentDate: 'desc' },
        },
        shop: {
          select: { id: true, name: true, code: true },
        },
      },
      orderBy: { invoiceDate: 'desc' },
    });

    // Flatten payments with purchase context
    const payments = purchases.flatMap((purchase) =>
      purchase.payments.map((payment) => ({
        ...payment,
        purchase: {
          id: purchase.id,
          invoiceNumber: purchase.invoiceNumber,
          invoiceDate: purchase.invoiceDate,
          netAmount: purchase.netAmount,
          shop: purchase.shop,
        },
      })),
    );

    // Sort by payment date descending
    payments.sort((a, b) => new Date(b.paymentDate).getTime() - new Date(a.paymentDate).getTime());

    return payments;
  },
};
