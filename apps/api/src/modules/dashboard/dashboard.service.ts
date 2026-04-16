import { prisma } from '../../config/database.js';
import type { Prisma } from '@prisma/client';

/**
 * Helper: generate an array of date strings (YYYY-MM-DD) between two dates, inclusive.
 */
function getDateRange(from: Date, to: Date): string[] {
  const dates: string[] = [];
  const current = new Date(from);
  current.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);

  while (current <= end) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

/**
 * Helper: default date range — last 30 days from today.
 */
function defaultDateRange() {
  const dateTo = new Date();
  dateTo.setHours(23, 59, 59, 999);
  const dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - 29);
  dateFrom.setHours(0, 0, 0, 0);
  return { dateFrom, dateTo };
}

/**
 * Helper: get first and last day of current month.
 */
function currentMonthRange() {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  firstDay.setHours(0, 0, 0, 0);
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  lastDay.setHours(23, 59, 59, 999);
  return { firstDay, lastDay };
}

/**
 * Helper: get first and last day of previous month.
 */
function previousMonthRange() {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  firstDay.setHours(0, 0, 0, 0);
  const lastDay = new Date(now.getFullYear(), now.getMonth(), 0);
  lastDay.setHours(23, 59, 59, 999);
  return { firstDay, lastDay };
}

export const dashboardService = {
  /**
   * Sales Graph Data — daily aggregated sale totals for a date range.
   * Returns array of { date, totalAmount, count } with zero-fill for missing days.
   */
  async getSalesGraph(
    shopId: string,
    dateFrom?: string,
    dateTo?: string,
  ) {
    const defaults = defaultDateRange();
    const from = dateFrom ? new Date(dateFrom) : defaults.dateFrom;
    const to = dateTo ? new Date(dateTo) : defaults.dateTo;

    // Prisma groupBy on saleDate
    const salesByDate = await prisma.saleRecord.groupBy({
      by: ['saleDate'],
      where: {
        shopId,
        saleDate: {
          gte: from,
          lte: to,
        },
      },
      _sum: {
        totalAmount: true,
      },
      _count: {
        id: true,
      },
      orderBy: {
        saleDate: 'asc',
      },
    });

    // Build a map from existing data
    const salesMap = new Map<string, { totalAmount: number; count: number }>();
    for (const row of salesByDate) {
      const dateKey = new Date(row.saleDate).toISOString().split('T')[0];
      salesMap.set(dateKey, {
        totalAmount: Number(row._sum.totalAmount ?? 0),
        count: row._count.id,
      });
    }

    // Fill in all dates in the range, inserting zeros for missing days
    const allDates = getDateRange(from, to);
    const result = allDates.map((date) => ({
      date,
      totalAmount: salesMap.get(date)?.totalAmount ?? 0,
      count: salesMap.get(date)?.count ?? 0,
    }));

    return result;
  },

  /**
   * Top N Products Sold — products with highest sale count in a date range.
   */
  async getTopProducts(
    shopId: string,
    dateFrom?: string,
    dateTo?: string,
    limit = 10,
  ) {
    const defaults = defaultDateRange();
    const from = dateFrom ? new Date(dateFrom) : defaults.dateFrom;
    const to = dateTo ? new Date(dateTo) : defaults.dateTo;

    // Group sales by productId
    const salesByProduct = await prisma.saleRecord.groupBy({
      by: ['productId'],
      where: {
        shopId,
        saleDate: {
          gte: from,
          lte: to,
        },
      },
      _count: {
        id: true,
      },
      _sum: {
        totalAmount: true,
      },
      orderBy: {
        _count: {
          id: 'desc',
        },
      },
      take: limit,
    });

    if (salesByProduct.length === 0) {
      return [];
    }

    // Fetch product details for those product IDs
    const productIds = salesByProduct.map((s) => s.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        brand: true,
        modelNumber: true,
        category: {
          select: { id: true, name: true },
        },
      },
    });

    const productMap = new Map(products.map((p) => [p.id, p]));

    return salesByProduct.map((row) => {
      const product = productMap.get(row.productId);
      return {
        productId: row.productId,
        brand: product?.brand ?? 'Unknown',
        modelNumber: product?.modelNumber ?? 'Unknown',
        categoryName: product?.category?.name ?? 'Unknown',
        count: row._count.id,
        totalRevenue: Number(row._sum.totalAmount ?? 0),
      };
    });
  },

  /**
   * Year-over-Year Comparison — compare same period last year vs this year.
   * Given a date range, query sales for that range and the same range shifted back 1 year.
   * Groups by product (brand + model) for comparison.
   */
  async getYoYComparison(
    shopId: string,
    dateFrom?: string,
    dateTo?: string,
  ) {
    const defaults = defaultDateRange();
    const from = dateFrom ? new Date(dateFrom) : defaults.dateFrom;
    const to = dateTo ? new Date(dateTo) : defaults.dateTo;

    // Shift dates back 1 year for last year's comparison
    const lastYearFrom = new Date(from);
    lastYearFrom.setFullYear(lastYearFrom.getFullYear() - 1);
    const lastYearTo = new Date(to);
    lastYearTo.setFullYear(lastYearTo.getFullYear() - 1);

    // Query both periods in parallel
    const [thisYearSales, lastYearSales] = await Promise.all([
      prisma.saleRecord.groupBy({
        by: ['productId'],
        where: {
          shopId,
          saleDate: { gte: from, lte: to },
        },
        _count: { id: true },
        _sum: { totalAmount: true },
        orderBy: { _sum: { totalAmount: 'desc' } },
      }),
      prisma.saleRecord.groupBy({
        by: ['productId'],
        where: {
          shopId,
          saleDate: { gte: lastYearFrom, lte: lastYearTo },
        },
        _count: { id: true },
        _sum: { totalAmount: true },
        orderBy: { _sum: { totalAmount: 'desc' } },
      }),
    ]);

    // Collect all unique product IDs from both years
    const allProductIds = new Set<string>();
    for (const row of thisYearSales) allProductIds.add(row.productId);
    for (const row of lastYearSales) allProductIds.add(row.productId);

    // Fetch product details
    const products = allProductIds.size > 0
      ? await prisma.product.findMany({
          where: { id: { in: [...allProductIds] } },
          select: {
            id: true,
            brand: true,
            modelNumber: true,
            category: { select: { id: true, name: true } },
          },
        })
      : [];

    const productMap = new Map(products.map((p) => [p.id, p]));

    const mapSales = (rows: typeof thisYearSales) =>
      rows.map((row) => {
        const product = productMap.get(row.productId);
        return {
          productId: row.productId,
          brand: product?.brand ?? 'Unknown',
          modelNumber: product?.modelNumber ?? 'Unknown',
          categoryName: product?.category?.name ?? 'Unknown',
          count: row._count.id,
          totalRevenue: Number(row._sum.totalAmount ?? 0),
        };
      });

    return {
      thisYear: {
        dateFrom: from.toISOString().split('T')[0],
        dateTo: to.toISOString().split('T')[0],
        products: mapSales(thisYearSales),
      },
      lastYear: {
        dateFrom: lastYearFrom.toISOString().split('T')[0],
        dateTo: lastYearTo.toISOString().split('T')[0],
        products: mapSales(lastYearSales),
      },
    };
  },

  /**
   * Overdue Installments Summary — all overdue installments, sorted by daysOverdue desc.
   * Joins through schedule -> sale -> customer + product.
   */
  async getOverdueInstallments(
    shopId: string,
    dateFrom?: string,
    dateTo?: string,
  ) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Build due date filter: overdue means dueDate < today
    const dueDateFilter: Prisma.DateTimeFilter = { lt: today };

    // If dateFrom/dateTo provided, constrain the overdue window
    if (dateFrom) {
      dueDateFilter.gte = new Date(dateFrom);
    } else {
      // Default: last 30 days of overdue
      const thirtyDaysAgo = new Date(today);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      dueDateFilter.gte = thirtyDaysAgo;
    }

    if (dateTo) {
      // dateTo overrides the lt: today only if it's before today
      const parsedTo = new Date(dateTo);
      if (parsedTo < today) {
        dueDateFilter.lt = parsedTo;
      }
    }

    const overdueInstallments = await prisma.installment.findMany({
      where: {
        dueDate: dueDateFilter,
        status: { notIn: ['paid', 'rescheduled'] },
        isRescheduled: false,
        schedule: {
          sale: { shopId },
          status: 'active',
        },
      },
      include: {
        schedule: {
          select: {
            id: true,
            sale: {
              select: {
                id: true,
                saleNumber: true,
                customer: {
                  select: {
                    id: true,
                    name: true,
                    phone: true,
                  },
                },
                product: {
                  select: {
                    id: true,
                    brand: true,
                    modelNumber: true,
                    category: { select: { name: true } },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { dueDate: 'asc' },
    });

    // Enrich with daysOverdue and flatten for easy frontend consumption
    const result = overdueInstallments.map((inst) => {
      const daysOverdue = Math.floor(
        (today.getTime() - new Date(inst.dueDate).getTime()) / (1000 * 60 * 60 * 24),
      );
      const sale = inst.schedule.sale;
      const product = sale.product;

      return {
        installmentId: inst.id,
        scheduleId: inst.schedule.id,
        saleId: sale.id,
        saleNumber: sale.saleNumber,
        customerName: sale.customer.name,
        customerPhone: sale.customer.phone,
        productName: `${product.brand} ${product.modelNumber}`,
        categoryName: product.category?.name ?? 'Unknown',
        installmentNumber: inst.installmentNumber,
        amountDue: Number(inst.amountDue),
        amountPaid: Number(inst.amountPaid),
        remainingAmount: Number(inst.remainingAmount),
        dueDate: new Date(inst.dueDate).toISOString().split('T')[0],
        daysOverdue,
      };
    });

    // Sort by daysOverdue descending (most overdue first)
    result.sort((a, b) => b.daysOverdue - a.daysOverdue);

    return result;
  },

  /**
   * Summary Metrics — key numbers for dashboard header cards.
   * Uses Promise.all for parallel execution of independent queries.
   */
  async getSummary(shopId: string) {
    const { firstDay: thisMonthStart, lastDay: thisMonthEnd } = currentMonthRange();
    const { firstDay: lastMonthStart, lastDay: lastMonthEnd } = previousMonthRange();

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayEnd = new Date(today);
    todayEnd.setHours(23, 59, 59, 999);

    const [
      thisMonthSales,
      lastMonthSales,
      overdueInstallments,
      stockValue,
      todaysExpectedCollections,
      todaysActualCollections,
    ] = await Promise.all([
      // 1. Total sales this month
      prisma.saleRecord.aggregate({
        where: {
          shopId,
          saleDate: { gte: thisMonthStart, lte: thisMonthEnd },
        },
        _sum: { totalAmount: true },
        _count: { id: true },
      }),

      // 2. Total sales last month (for percent change)
      prisma.saleRecord.aggregate({
        where: {
          shopId,
          saleDate: { gte: lastMonthStart, lte: lastMonthEnd },
        },
        _sum: { totalAmount: true },
        _count: { id: true },
      }),

      // 3. Pending (overdue) installments — count + total amount
      prisma.installment.aggregate({
        where: {
          dueDate: { lt: today },
          status: { notIn: ['paid', 'rescheduled'] },
          isRescheduled: false,
          schedule: {
            sale: { shopId },
            status: 'active',
          },
        },
        _count: { id: true },
        _sum: { remainingAmount: true },
      }),

      // 4. Stock value — sum of sellingPrice for all in_stock products
      prisma.product.aggregate({
        where: {
          shopId,
          status: 'in_stock',
        },
        _sum: { sellingPrice: true },
        _count: { id: true },
      }),

      // 5a. Today's expected collections — installments due today
      prisma.installment.aggregate({
        where: {
          dueDate: today,
          status: { notIn: ['paid', 'rescheduled'] },
          isRescheduled: false,
          schedule: {
            sale: { shopId },
            status: 'active',
          },
        },
        _sum: { remainingAmount: true },
        _count: { id: true },
      }),

      // 5b. Today's actual collections — payments recorded today
      prisma.installmentPayment.aggregate({
        where: {
          paymentDate: {
            gte: today,
            lte: todayEnd,
          },
          installment: {
            schedule: {
              sale: { shopId },
            },
          },
        },
        _sum: { amount: true },
        _count: { id: true },
      }),
    ]);

    // Calculate percentage change
    const thisMonthTotal = Number(thisMonthSales._sum.totalAmount ?? 0);
    const lastMonthTotal = Number(lastMonthSales._sum.totalAmount ?? 0);
    let salesChangePercent = 0;
    if (lastMonthTotal > 0) {
      salesChangePercent = ((thisMonthTotal - lastMonthTotal) / lastMonthTotal) * 100;
    } else if (thisMonthTotal > 0) {
      salesChangePercent = 100; // If no sales last month but some this month, 100% increase
    }

    return {
      totalSalesThisMonth: {
        amount: thisMonthTotal,
        count: thisMonthSales._count.id,
      },
      salesChangePercent: Math.round(salesChangePercent * 100) / 100,
      pendingInstallments: {
        count: overdueInstallments._count.id,
        totalAmount: Number(overdueInstallments._sum.remainingAmount ?? 0),
      },
      stockValue: {
        amount: Number(stockValue._sum.sellingPrice ?? 0),
        count: stockValue._count.id,
      },
      todaysCollections: {
        expectedAmount: Number(todaysExpectedCollections._sum.remainingAmount ?? 0),
        expectedCount: todaysExpectedCollections._count.id,
        collectedAmount: Number(todaysActualCollections._sum.amount ?? 0),
        collectedCount: todaysActualCollections._count.id,
      },
    };
  },
};
