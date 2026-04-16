import { prisma } from '../../config/database.js';
import type { Prisma, ExpenseCategory } from '@prisma/client';

export const expensesService = {
  async list(shopId: string, filters: {
    skip: number;
    take: number;
    page: number;
    pageSize: number;
    category?: string;
    dateFrom?: string;
    dateTo?: string;
    search?: string;
  }) {
    const where: Prisma.ExpenseWhereInput = {
      shopId,
    };

    if (filters.category) {
      where.category = filters.category as ExpenseCategory;
    }

    if (filters.dateFrom || filters.dateTo) {
      where.expenseDate = {};
      if (filters.dateFrom) {
        where.expenseDate.gte = new Date(filters.dateFrom);
      }
      if (filters.dateTo) {
        where.expenseDate.lte = new Date(filters.dateTo);
      }
    }

    if (filters.search) {
      where.OR = [
        { vendorName: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const [expenses, totalItems] = await Promise.all([
      prisma.expense.findMany({
        where,
        include: {
          creator: {
            select: { id: true, username: true, fullName: true },
          },
        },
        orderBy: { expenseDate: 'desc' },
        skip: filters.skip,
        take: filters.take,
      }),
      prisma.expense.count({ where }),
    ]);

    return { expenses, totalItems };
  },

  async getById(id: string) {
    const expense = await prisma.expense.findUnique({
      where: { id },
      include: {
        creator: {
          select: { id: true, username: true, fullName: true },
        },
        shop: {
          select: { id: true, name: true, code: true },
        },
      },
    });

    return expense;
  },

  async create(shopId: string, data: {
    expenseDate: string;
    category: string;
    vendorName?: string | null;
    description?: string | null;
    amount: number;
    gstAmount?: number | null;
    invoiceNumber?: string | null;
    invoiceUrl?: string | null;
    isGstClaimable?: boolean;
  }, userId: string) {
    const expense = await prisma.expense.create({
      data: {
        shopId,
        expenseDate: new Date(data.expenseDate),
        category: data.category as ExpenseCategory,
        vendorName: data.vendorName ?? null,
        description: data.description ?? null,
        amount: data.amount,
        gstAmount: data.gstAmount ?? 0,
        invoiceNumber: data.invoiceNumber ?? null,
        invoiceUrl: data.invoiceUrl ?? null,
        isGstClaimable: data.isGstClaimable ?? false,
        createdBy: userId,
      },
      include: {
        creator: {
          select: { id: true, username: true, fullName: true },
        },
      },
    });

    return expense;
  },

  async update(id: string, data: {
    expenseDate?: string;
    category?: string;
    vendorName?: string | null;
    description?: string | null;
    amount?: number;
    gstAmount?: number | null;
    invoiceNumber?: string | null;
    invoiceUrl?: string | null;
    isGstClaimable?: boolean;
  }) {
    const existing = await prisma.expense.findUnique({ where: { id } });
    if (!existing) {
      return null;
    }

    const updateData: Record<string, unknown> = {};

    if (data.expenseDate !== undefined) {
      updateData.expenseDate = new Date(data.expenseDate);
    }
    if (data.category !== undefined) {
      updateData.category = data.category as ExpenseCategory;
    }
    if (data.vendorName !== undefined) {
      updateData.vendorName = data.vendorName;
    }
    if (data.description !== undefined) {
      updateData.description = data.description;
    }
    if (data.amount !== undefined) {
      updateData.amount = data.amount;
    }
    if (data.gstAmount !== undefined) {
      updateData.gstAmount = data.gstAmount ?? 0;
    }
    if (data.invoiceNumber !== undefined) {
      updateData.invoiceNumber = data.invoiceNumber;
    }
    if (data.invoiceUrl !== undefined) {
      updateData.invoiceUrl = data.invoiceUrl;
    }
    if (data.isGstClaimable !== undefined) {
      updateData.isGstClaimable = data.isGstClaimable;
    }

    const updated = await prisma.expense.update({
      where: { id },
      data: updateData as any,
      include: {
        creator: {
          select: { id: true, username: true, fullName: true },
        },
      },
    });

    return updated;
  },

  async delete(id: string) {
    const existing = await prisma.expense.findUnique({ where: { id } });
    if (!existing) {
      return null;
    }

    await prisma.expense.delete({ where: { id } });
    return true;
  },

  async getSummary(shopId: string, dateFrom?: string, dateTo?: string) {
    const where: Prisma.ExpenseWhereInput = { shopId };

    if (dateFrom || dateTo) {
      where.expenseDate = {};
      if (dateFrom) {
        where.expenseDate.gte = new Date(dateFrom);
      }
      if (dateTo) {
        where.expenseDate.lte = new Date(dateTo);
      }
    }

    // Aggregate total by category
    const byCategory = await prisma.expense.groupBy({
      by: ['category'],
      where,
      _sum: {
        amount: true,
        gstAmount: true,
      },
      _count: {
        id: true,
      },
    });

    // Aggregate GST claimable total
    const gstClaimable = await prisma.expense.aggregate({
      where: {
        ...where,
        isGstClaimable: true,
      },
      _sum: {
        gstAmount: true,
      },
    });

    // Grand total
    const grandTotal = await prisma.expense.aggregate({
      where,
      _sum: {
        amount: true,
        gstAmount: true,
      },
      _count: {
        id: true,
      },
    });

    return {
      byCategory: byCategory.map((cat) => ({
        category: cat.category,
        totalAmount: cat._sum.amount,
        totalGst: cat._sum.gstAmount,
        count: cat._count.id,
      })),
      totalGstClaimable: gstClaimable._sum.gstAmount,
      grandTotal: grandTotal._sum.amount,
      grandTotalGst: grandTotal._sum.gstAmount,
      totalCount: grandTotal._count.id,
    };
  },
};
