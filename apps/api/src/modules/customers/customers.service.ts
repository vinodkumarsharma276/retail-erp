import { prisma } from '../../config/database.js';
import type { Prisma } from '@prisma/client';
import { generateCustomerCode } from '../../utils/id-generator.js';

export const customersService = {
  /**
   * List customers for a shop (or all shops in All-Shops mode).
   * `scope.shopIds` is set when the user picks "All Shops" in the
   * header (gated by the `shops.view_all` permission).
   */
  async list(
    scope: { shopId: string; shopIds?: string[] },
    filters: {
      skip: number;
      take: number;
      page: number;
      pageSize: number;
      search?: string;
      zone?: string;
    },
  ) {
    const where: Prisma.CustomerWhereInput =
      scope.shopIds && scope.shopIds.length > 0
        ? { shopId: { in: scope.shopIds } }
        : { shopId: scope.shopId };

    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { phone: { contains: filters.search, mode: 'insensitive' } },
        { customerCode: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    if (filters.zone) {
      where.zone = filters.zone;
    }

    const [customers, totalItems] = await Promise.all([
      prisma.customer.findMany({
        where,
        include: {
          guarantor: {
            select: { id: true, name: true, phone: true, customerCode: true },
          },
          creator: {
            select: { id: true, username: true, fullName: true },
          },
          shop: {
            select: { id: true, name: true, code: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: filters.skip,
        take: filters.take,
      }),
      prisma.customer.count({ where }),
    ]);

    return { customers, totalItems };
  },

  async search(query: string) {
    // Search across ALL shops — for sale form customer lookup (find repeat customers)
    const customers = await prisma.customer.findMany({
      where: {
        OR: [
          { phone: { contains: query, mode: 'insensitive' } },
          { name: { contains: query, mode: 'insensitive' } },
          { customerCode: { contains: query, mode: 'insensitive' } },
        ],
      },
      include: {
        shop: {
          select: { id: true, name: true, code: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    return customers;
  },

  async getById(id: string) {
    const customer = await prisma.customer.findUnique({
      where: { id },
      include: {
        guarantor: {
          select: { id: true, name: true, phone: true, customerCode: true },
        },
        guaranteedCustomers: {
          select: { id: true, name: true, phone: true, customerCode: true },
        },
        shop: {
          select: { id: true, name: true, code: true },
        },
        creator: {
          select: { id: true, username: true, fullName: true },
        },
        saleRecords: {
          include: {
            product: {
              select: { id: true, brand: true, modelNumber: true, serialNumber: true },
            },
          },
          orderBy: { saleDate: 'desc' },
        },
      },
    });

    return customer;
  },

  async create(shopId: string, data: {
    name: string;
    phone: string;
    altPhone?: string | null;
    aadhaarNumber?: string | null;
    addressLine1?: string | null;
    addressLine2?: string | null;
    city?: string | null;
    state?: string | null;
    pincode?: string | null;
    zone?: string | null;
    customerType?: 'individual' | 'business';
    businessName?: string | null;
    gstNumber?: string | null;
    isGuarantor?: boolean;
    guarantorId?: string | null;
    dynamicAttributes?: Record<string, unknown>;
  }, userId: string) {
    // Validate guarantor exists if provided
    if (data.guarantorId) {
      const guarantor = await prisma.customer.findUnique({
        where: { id: data.guarantorId },
      });
      if (!guarantor) {
        throw new Error('Guarantor not found');
      }
    }

    // Get last `CUST-####` code to generate the next one. Filter explicitly so
    // that non-standard codes (e.g. `SHOP-VE-NE` for transfer-shop customers)
    // can't poison the sequence and produce `CUST-0NaN`.
    const lastCustomer = await prisma.customer.findFirst({
      where: { customerCode: { startsWith: 'CUST-' } },
      orderBy: { customerCode: 'desc' },
      select: { customerCode: true },
    });

    const customerCode = generateCustomerCode(lastCustomer?.customerCode ?? undefined);

    const customer = await prisma.customer.create({
      data: {
        customerCode,
        name: data.name,
        phone: data.phone,
        altPhone: data.altPhone ?? null,
        aadhaarNumber: data.aadhaarNumber ?? null,
        addressLine1: data.addressLine1 ?? null,
        addressLine2: data.addressLine2 ?? null,
        city: data.city ?? null,
        state: data.state ?? null,
        pincode: data.pincode ?? null,
        zone: data.zone ?? null,
        customerType: (data.customerType ?? 'individual') as any,
        businessName: data.businessName ?? null,
        gstNumber: data.gstNumber ?? null,
        isGuarantor: data.isGuarantor ?? false,
        guarantorId: data.guarantorId ?? null,
        dynamicAttributes: (data.dynamicAttributes ?? {}) as any,
        shopId,
        createdBy: userId,
      },
      include: {
        guarantor: {
          select: { id: true, name: true, phone: true, customerCode: true },
        },
        shop: {
          select: { id: true, name: true, code: true },
        },
        creator: {
          select: { id: true, username: true, fullName: true },
        },
      },
    });

    return customer;
  },

  async update(id: string, data: {
    name?: string;
    phone?: string;
    altPhone?: string | null;
    aadhaarNumber?: string | null;
    addressLine1?: string | null;
    addressLine2?: string | null;
    city?: string | null;
    state?: string | null;
    pincode?: string | null;
    zone?: string | null;
    customerType?: 'individual' | 'business';
    businessName?: string | null;
    gstNumber?: string | null;
    isGuarantor?: boolean;
    guarantorId?: string | null;
    dynamicAttributes?: Record<string, unknown>;
  }) {
    const existing = await prisma.customer.findUnique({ where: { id } });
    if (!existing) {
      return null;
    }

    // Validate guarantor exists if provided
    if (data.guarantorId) {
      const guarantor = await prisma.customer.findUnique({
        where: { id: data.guarantorId },
      });
      if (!guarantor) {
        throw new Error('Guarantor not found');
      }
    }

    const updateData: Record<string, unknown> = {};

    if (data.name !== undefined) updateData.name = data.name;
    if (data.phone !== undefined) updateData.phone = data.phone;
    if (data.altPhone !== undefined) updateData.altPhone = data.altPhone;
    if (data.aadhaarNumber !== undefined) updateData.aadhaarNumber = data.aadhaarNumber;
    if (data.addressLine1 !== undefined) updateData.addressLine1 = data.addressLine1;
    if (data.addressLine2 !== undefined) updateData.addressLine2 = data.addressLine2;
    if (data.city !== undefined) updateData.city = data.city;
    if (data.state !== undefined) updateData.state = data.state;
    if (data.pincode !== undefined) updateData.pincode = data.pincode;
    if (data.zone !== undefined) updateData.zone = data.zone;
    if (data.customerType !== undefined) updateData.customerType = data.customerType;
    if (data.businessName !== undefined) updateData.businessName = data.businessName;
    if (data.gstNumber !== undefined) updateData.gstNumber = data.gstNumber;
    if (data.isGuarantor !== undefined) updateData.isGuarantor = data.isGuarantor;
    if (data.guarantorId !== undefined) updateData.guarantorId = data.guarantorId;
    if (data.dynamicAttributes !== undefined) {
      updateData.dynamicAttributes = data.dynamicAttributes as any;
    }

    const updated = await prisma.customer.update({
      where: { id },
      data: updateData as any,
      include: {
        guarantor: {
          select: { id: true, name: true, phone: true, customerCode: true },
        },
        shop: {
          select: { id: true, name: true, code: true },
        },
        creator: {
          select: { id: true, username: true, fullName: true },
        },
      },
    });

    return updated;
  },

  async getSales(customerId: string) {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
    });
    if (!customer) {
      return null;
    }

    const sales = await prisma.saleRecord.findMany({
      where: { customerId },
      include: {
        product: {
          select: {
            id: true,
            brand: true,
            modelNumber: true,
            serialNumber: true,
            category: {
              select: { id: true, name: true, slug: true },
            },
          },
        },
        shop: {
          select: { id: true, name: true, code: true },
        },
        guarantor: {
          select: { id: true, name: true, phone: true, customerCode: true },
        },
        financeCompany: {
          select: { id: true, name: true, code: true },
        },
        installmentSchedule: {
          select: { id: true, status: true, numInstallments: true, emiAmount: true, totalPayable: true },
        },
      },
      orderBy: { saleDate: 'desc' },
    });

    return sales;
  },

  /**
   * Aggregate installment reliability metrics across ALL schedules for this
   * customer (all shops). Drives the credit-worthiness banner shown on Sale
   * create and the summary card on Customer detail.
   */
  async getInstallmentHistory(customerId: string) {
    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) return null;

    const schedules = await prisma.installmentSchedule.findMany({
      where: { sale: { customerId } },
      include: {
        sale: { select: { shopId: true, saleDate: true, totalAmount: true } },
        installments: {
          include: { payments: { orderBy: { paymentDate: 'asc' } } },
          orderBy: [{ installmentNumber: 'asc' }, { subSequence: 'asc' }],
        },
      },
    });

    let totalSchedules = 0;
    let completedOnTime = 0;
    let completedLate = 0;
    let active = 0;
    let totalInstallments = 0;
    let paidOnTime = 0;
    let paidLate = 0;
    let absorbed = 0;
    let reschedulesCreated = 0;
    let totalDelayDays = 0;
    let paidInstallmentsWithDelay = 0;
    let longestOverdueDays = 0;
    let lifetimeFinancedAmount = 0;
    let lifetimePaid = 0;

    const now = new Date();
    now.setHours(0, 0, 0, 0);

    for (const sch of schedules) {
      totalSchedules += 1;
      lifetimeFinancedAmount += Number(sch.totalPayable);

      let scheduleHadLate = false;
      let hasUnpaid = false;

      for (const inst of sch.installments) {
        totalInstallments += 1;
        lifetimePaid += Number(inst.amountPaid);

        // Sub-row creation is a reschedule event
        if (inst.parentInstallmentNumber != null) {
          reschedulesCreated += 1;
        }

        if (inst.isClosed) {
          absorbed += 1;
          continue;
        }

        const due = new Date(inst.dueDate);
        due.setHours(0, 0, 0, 0);

        if (inst.status === 'paid') {
          const lastPayment = inst.payments[inst.payments.length - 1];
          if (lastPayment) {
            const pd = new Date(lastPayment.paymentDate);
            pd.setHours(0, 0, 0, 0);
            const delay = Math.max(
              0,
              Math.floor((pd.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)),
            );
            if (delay > 0) {
              paidLate += 1;
              scheduleHadLate = true;
              totalDelayDays += delay;
              paidInstallmentsWithDelay += 1;
            } else {
              paidOnTime += 1;
            }
          } else {
            paidOnTime += 1;
          }
        } else if (inst.status === 'rescheduled') {
          // primary row that was rescheduled — counted via sub creation above
        } else {
          hasUnpaid = true;
          const days = Math.max(
            0,
            Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)),
          );
          if (days > longestOverdueDays) longestOverdueDays = days;
        }
      }

      if (sch.status === 'active' || hasUnpaid) {
        active += 1;
      } else if (scheduleHadLate) {
        completedLate += 1;
      } else {
        completedOnTime += 1;
      }
    }

    const averageDelayDays =
      paidInstallmentsWithDelay > 0
        ? Math.round((totalDelayDays / paidInstallmentsWithDelay) * 10) / 10
        : 0;

    // Simple reliability score: 0-100.
    //   Start at 100, subtract penalties.
    //   -3 per late payment, -10 per chain absorbed, -0.5 per avg delay day,
    //   -20 per active schedule with >30 day longest overdue.
    let score = 100;
    score -= paidLate * 3;
    score -= absorbed * 10;
    score -= averageDelayDays * 0.5;
    if (longestOverdueDays > 30 && active > 0) score -= 20;
    score = Math.max(0, Math.min(100, Math.round(score)));

    const rating: 'excellent' | 'good' | 'fair' | 'poor' =
      score >= 85 ? 'excellent' : score >= 70 ? 'good' : score >= 50 ? 'fair' : 'poor';

    return {
      customer: {
        id: customer.id,
        name: customer.name,
        customerCode: customer.customerCode,
      },
      totalSchedules,
      completedOnTime,
      completedLate,
      active,
      totalInstallments,
      paidOnTime,
      paidLate,
      absorbed,
      reschedulesCreated,
      averageDelayDays,
      longestOverdueDays,
      lifetimeFinancedAmount: Math.round(lifetimeFinancedAmount * 100) / 100,
      lifetimePaid: Math.round(lifetimePaid * 100) / 100,
      reliabilityScore: score,
      rating,
    };
  },
};
