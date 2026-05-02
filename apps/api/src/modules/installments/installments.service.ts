import { prisma } from '../../config/database.js';
import type { Prisma } from '@prisma/client';
import { ensureRolledForToday, applyPartialWithPromise, syncScheduleAndSale, distributeOverpayment } from './installments.rules.js';
import { computeSettlementQuote, computeAccruedInterest } from '@retailerp/shared-utils';

export const installmentsService = {
  /**
   * List installment schedules for a shop, with optional status filter.
   * Shop-scoped via sale.shopId.
   */
  async listSchedules(
    shopId: string,
    filters: {
      skip: number;
      take: number;
      page: number;
      pageSize: number;
      status?: string;
    },
  ) {
    const where: Prisma.InstallmentScheduleWhereInput = {
      sale: { shopId },
    };

    if (filters.status) {
      where.status = filters.status;
    }

    const [schedules, totalItems] = await Promise.all([
      prisma.installmentSchedule.findMany({
        where,
        include: {
          sale: {
            select: {
              id: true,
              saleNumber: true,
              saleDate: true,
              totalAmount: true,
              downPayment: true,
              customer: {
                select: {
                  id: true,
                  name: true,
                  phone: true,
                  customerCode: true,
                },
              },
              product: {
                select: {
                  id: true,
                  brand: true,
                  modelNumber: true,
                  serialNumber: true,
                  category: { select: { id: true, name: true } },
                },
              },
              shop: {
                select: { id: true, name: true, code: true },
              },
            },
          },
          installments: {
            where: { isRescheduled: false },
            select: {
              id: true,
              status: true,
              amountPaid: true,
              amountDue: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: filters.skip,
        take: filters.take,
      }),
      prisma.installmentSchedule.count({ where }),
    ]);

    // Enrich with summary: paid count, overdue count, total collected
    const enriched = schedules.map((schedule) => {
      const paidCount = schedule.installments.filter((i) => i.status === 'paid').length;
      const overdueCount = schedule.installments.filter((i) => i.status === 'overdue').length;
      const totalCollected = schedule.installments.reduce(
        (sum, i) => sum + Number(i.amountPaid),
        0,
      );
      const { installments: _omit, ...rest } = schedule;
      return {
        ...rest,
        summary: {
          paidCount,
          overdueCount,
          totalInstallments: schedule.installments.length,
          totalCollected,
        },
      };
    });

    return { schedules: enriched, totalItems };
  },

  /**
   * Get all overdue installments for a shop.
   * Overdue = dueDate < today AND status NOT in [paid, rescheduled].
   */
  async getOverdue(shopId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Lazy rollover — apply Rule C (absorb stale chains) and mark due_today
    // so the list reflects today's real state before we query it.
    await prisma.$transaction(async (tx) => {
      await ensureRolledForToday(tx, today, { shopId });
    });

    const overdueInstallments = await prisma.installment.findMany({
      where: {
        dueDate: { lt: today },
        status: { notIn: ['paid', 'rescheduled'] },
        isRescheduled: false,
        remainingAmount: { gt: 0 },
        schedule: {
          sale: { shopId },
          status: 'active',
        },
      },
      include: {
        schedule: {
          select: {
            id: true,
            emiAmount: true,
            totalPayable: true,
            sale: {
              select: {
                id: true,
                saleNumber: true,
                saleDate: true,
                customer: {
                  select: {
                    id: true,
                    name: true,
                    phone: true,
                    customerCode: true,
                    addressLine1: true,
                    city: true,
                  },
                },
                product: {
                  select: {
                    id: true,
                    brand: true,
                    modelNumber: true,
                    category: { select: { id: true, name: true } },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { dueDate: 'asc' },
    });

    // Flatten and enrich with days overdue
    return overdueInstallments.map((inst) => {
      const sale = inst.schedule?.sale;
      const customer = sale?.customer;
      const product = sale?.product;
      return {
        id: inst.id,
        scheduleId: inst.scheduleId,
        installmentNumber: inst.installmentNumber,
        parentInstallmentNumber: inst.parentInstallmentNumber,
        subSequence: inst.subSequence,
        dueDate: inst.dueDate,
        amountDue: inst.amountDue,
        amountPaid: inst.amountPaid,
        remainingAmount: inst.remainingAmount,
        status: inst.status,
        daysOverdue: Math.floor(
          (today.getTime() - new Date(inst.dueDate).getTime()) / (1000 * 60 * 60 * 24),
        ),
        customerName: customer?.name ?? '',
        customerPhone: customer?.phone ?? '',
        customerAddress: [customer?.addressLine1, customer?.city].filter(Boolean).join(', ') || undefined,
        productName: product?.modelNumber ?? '',
        productBrand: product?.brand ?? '',
        saleId: sale?.id ?? '',
      };
    });
  },

  /**
   * Get all installments due on a specific date for a shop.
   * This is THE daily collection list — the core feature for employees.
   * Optionally filter by assigned employee.
   */
  async getCollectionsForDate(
    shopId: string,
    date: string,
    employeeId?: string,
  ) {
    const targetDate = new Date(date);
    targetDate.setHours(0, 0, 0, 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Lazy rollover only when querying today (historical dates are immutable history).
    if (targetDate.getTime() === today.getTime()) {
      await prisma.$transaction(async (tx) => {
        await ensureRolledForToday(tx, today, { shopId });
      });
    }

    // Build the base where clause
    const where: Prisma.InstallmentWhereInput = {
      dueDate: targetDate,
      status: { notIn: ['paid', 'rescheduled'] },
      isRescheduled: false,
      remainingAmount: { gt: 0 },
      schedule: {
        sale: { shopId },
        status: 'active',
      },
    };

    // If employeeId is provided, filter by assigned employee
    if (employeeId) {
      where.schedule = {
        ...where.schedule as object,
        collectionAssigns: {
          some: {
            employeeId,
            isActive: true,
          },
        },
      };
    }

    const collections = await prisma.installment.findMany({
      where,
      include: {
        schedule: {
          select: {
            id: true,
            emiAmount: true,
            numInstallments: true,
            totalPayable: true,
            sale: {
              select: {
                id: true,
                saleNumber: true,
                ledgerNumber: true,
                saleDate: true,
                totalAmount: true,
                downPayment: true,
                customer: {
                  select: {
                    id: true,
                    name: true,
                    phone: true,
                    customerCode: true,
                    addressLine1: true,
                    addressLine2: true,
                    city: true,
                    pincode: true,
                  },
                },
                product: {
                  select: {
                    id: true,
                    brand: true,
                    modelNumber: true,
                    serialNumber: true,
                    category: { select: { id: true, name: true } },
                  },
                },
                guarantor: {
                  select: {
                    id: true,
                    name: true,
                    phone: true,
                  },
                },
              },
            },
            collectionAssigns: {
              where: { isActive: true },
              select: {
                employee: {
                  select: { id: true, fullName: true, username: true },
                },
              },
            },
          },
        },
        payments: {
          orderBy: { paymentDate: 'desc' },
          select: {
            id: true,
            amount: true,
            paymentMode: true,
            paymentDate: true,
          },
        },
        // Include rescheduled-from info so we can show notes about rescheduled installments
        rescheduledFrom: {
          select: {
            id: true,
            installmentNumber: true,
            dueDate: true,
            amountDue: true,
            notes: true,
          },
        },
      },
      orderBy: [
        { schedule: { sale: { customer: { name: 'asc' } } } },
        { installmentNumber: 'asc' },
      ],
    });

    // Also find installments where a rescheduled version exists on a LATER date
    // but the original due date is today — these should show with a note
    const rescheduledNotes = await prisma.installment.findMany({
      where: {
        dueDate: targetDate,
        status: 'rescheduled',
        isRescheduled: true,
        schedule: {
          sale: { shopId },
          status: 'active',
        },
      },
      include: {
        rescheduledTo: {
          select: {
            id: true,
            dueDate: true,
            amountDue: true,
            status: true,
          },
        },
        schedule: {
          select: {
            id: true,
            sale: {
              select: {
                saleNumber: true,
                customer: {
                  select: { id: true, name: true, phone: true },
                },
              },
            },
          },
        },
      },
    });

    return { collections: flattenCollections(collections), rescheduledNotes };
  },

  /**
   * Get installments whose dueDate is within the range AND that have received
   * at least one payment (full or partial). Used by the "Paid" tab to show
   * who actually paid (on or around their due date) over a period.
   */
  async getPaidCollectionsForDateRange(
    shopId: string,
    dateFrom: string,
    dateTo: string,
  ) {
    const fromDate = new Date(dateFrom);
    fromDate.setHours(0, 0, 0, 0);
    const toDate = new Date(dateTo);
    toDate.setHours(23, 59, 59, 999);

    const collections = await prisma.installment.findMany({
      where: {
        dueDate: { gte: fromDate, lte: toDate },
        amountPaid: { gt: 0 },
        schedule: {
          sale: { shopId },
        },
      },
      include: {
        schedule: {
          select: {
            id: true,
            numInstallments: true,
            sale: {
              select: {
                id: true,
                saleNumber: true,
                ledgerNumber: true,
                customer: {
                  select: {
                    id: true,
                    name: true,
                    phone: true,
                    customerCode: true,
                    addressLine1: true,
                    addressLine2: true,
                    city: true,
                    pincode: true,
                  },
                },
                product: {
                  select: {
                    id: true,
                    brand: true,
                    modelNumber: true,
                    serialNumber: true,
                  },
                },
              },
            },
          },
        },
        payments: {
          orderBy: { paymentDate: 'asc' },
          select: {
            id: true,
            amount: true,
            paymentMode: true,
            paymentDate: true,
          },
        },
      },
      orderBy: [{ dueDate: 'desc' }, { installmentNumber: 'asc' }],
    });

    return { collections: flattenPaidCollections(collections) };
  },

  /**
   * Get all installments due within a date range for a shop.
   * Used to show pending collections for a period (e.g., last 2 weeks to today).
   * Optionally filter by assigned employee.
   */
  async getCollectionsForDateRange(
    shopId: string,
    dateFrom: string,
    dateTo: string,
    employeeId?: string,
  ) {
    const fromDate = new Date(dateFrom);
    fromDate.setHours(0, 0, 0, 0);
    const toDate = new Date(dateTo);
    toDate.setHours(23, 59, 59, 999);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Lazy rollover if the range includes today.
    if (toDate.getTime() >= today.getTime()) {
      await prisma.$transaction(async (tx) => {
        await ensureRolledForToday(tx, today, { shopId });
      });
    }

    const where: Prisma.InstallmentWhereInput = {
      dueDate: { gte: fromDate, lte: toDate },
      status: { notIn: ['paid', 'rescheduled'] },
      isRescheduled: false,
      remainingAmount: { gt: 0 },
      schedule: {
        sale: { shopId },
        status: 'active',
      },
    };

    if (employeeId) {
      where.schedule = {
        ...where.schedule as object,
        collectionAssigns: {
          some: {
            employeeId,
            isActive: true,
          },
        },
      };
    }

    const collections = await prisma.installment.findMany({
      where,
      include: {
        schedule: {
          select: {
            id: true,
            emiAmount: true,
            numInstallments: true,
            totalPayable: true,
            sale: {
              select: {
                id: true,
                saleNumber: true,
                ledgerNumber: true,
                saleDate: true,
                totalAmount: true,
                downPayment: true,
                customer: {
                  select: {
                    id: true,
                    name: true,
                    phone: true,
                    customerCode: true,
                    addressLine1: true,
                    addressLine2: true,
                    city: true,
                    pincode: true,
                  },
                },
                product: {
                  select: {
                    id: true,
                    brand: true,
                    modelNumber: true,
                    serialNumber: true,
                    category: { select: { id: true, name: true } },
                  },
                },
                guarantor: {
                  select: {
                    id: true,
                    name: true,
                    phone: true,
                  },
                },
              },
            },
            collectionAssigns: {
              where: { isActive: true },
              select: {
                employee: {
                  select: { id: true, fullName: true, username: true },
                },
              },
            },
          },
        },
        payments: {
          orderBy: { paymentDate: 'desc' },
          select: {
            id: true,
            amount: true,
            paymentMode: true,
            paymentDate: true,
          },
        },
        rescheduledFrom: {
          select: {
            id: true,
            installmentNumber: true,
            dueDate: true,
            amountDue: true,
            notes: true,
          },
        },
      },
      orderBy: { dueDate: 'asc' },
    });

    // Also find installments where a rescheduled version exists on a LATER date
    // but the original due date is within the range — these should show with a note
    const rescheduledNotes = await prisma.installment.findMany({
      where: {
        dueDate: { gte: fromDate, lte: toDate },
        status: 'rescheduled',
        isRescheduled: true,
        schedule: {
          sale: { shopId },
          status: 'active',
        },
      },
      include: {
        rescheduledTo: {
          select: {
            id: true,
            dueDate: true,
            amountDue: true,
            status: true,
          },
        },
        schedule: {
          select: {
            id: true,
            sale: {
              select: {
                saleNumber: true,
                customer: {
                  select: { id: true, name: true, phone: true },
                },
              },
            },
          },
        },
      },
    });

    return { collections: flattenCollections(collections), rescheduledNotes };
  },

  /**
   * Full schedule detail with all installments, payments, and rescheduling chain.
   */
  async getScheduleDetail(scheduleId: string) {
    // Lazy rollover scoped to just this schedule.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    await prisma.$transaction(async (tx) => {
      await ensureRolledForToday(tx, today, { scheduleId });
    });

    const schedule = await prisma.installmentSchedule.findUnique({
      where: { id: scheduleId },
      include: {
        sale: {
          select: {
            id: true,
            saleNumber: true,
            ledgerNumber: true,
            saleDate: true,
            saleType: true,
            totalAmount: true,
            downPayment: true,
            interestRate: true,
            fileCharge: true,
            numInstallments: true,
            emiAmount: true,
            customer: {
              select: {
                id: true,
                name: true,
                phone: true,
                customerCode: true,
                addressLine1: true,
                city: true,
                aadhaarNumber: true,
              },
            },
            product: {
              select: {
                id: true,
                brand: true,
                modelNumber: true,
                serialNumber: true,
                category: { select: { id: true, name: true } },
              },
            },
            guarantor: {
              select: {
                id: true,
                name: true,
                phone: true,
                customerCode: true,
                addressLine1: true,
                city: true,
              },
            },
            shop: {
              select: { id: true, name: true, code: true },
            },
          },
        },
        installments: {
          orderBy: [{ dueDate: 'asc' }, { installmentNumber: 'asc' }, { createdAt: 'asc' }],
          include: {
            payments: {
              include: {
                collector: {
                  select: { id: true, username: true, fullName: true },
                },
              },
              orderBy: { paymentDate: 'desc' },
            },
            rescheduledFrom: {
              select: {
                id: true,
                installmentNumber: true,
                dueDate: true,
                amountDue: true,
              },
            },
            rescheduledTo: {
              select: {
                id: true,
                installmentNumber: true,
                dueDate: true,
                amountDue: true,
                status: true,
              },
            },
          },
        },
        collectionAssigns: {
          where: { isActive: true },
          select: {
            employee: {
              select: { id: true, fullName: true, username: true },
            },
          },
        },
      },
    });

    if (!schedule) return null;

    // Reshape to the response contract expected by the web client:
    // { schedule, installments, sale, customer, product, guarantor, shop, collectionAssigns }
    const { sale, installments, collectionAssigns, ...scheduleCore } = schedule;
    const { customer, product, guarantor, shop, ...saleCore } = sale;
    return {
      schedule: scheduleCore,
      installments,
      sale: saleCore,
      customer,
      product,
      guarantor,
      shop,
      collectionAssigns,
    };
  },

  /**
   * Build a timeline view for a schedule showing chronological events:
   * - Schedule created
   * - Each installment due
   * - Payments made
   * - Rescheduling events
   */
  async getTimeline(scheduleId: string) {
    const schedule = await prisma.installmentSchedule.findUnique({
      where: { id: scheduleId },
      include: {
        installments: {
          orderBy: [{ dueDate: 'asc' }, { installmentNumber: 'asc' }, { createdAt: 'asc' }],
          include: {
            payments: {
              include: {
                collector: { select: { id: true, fullName: true } },
              },
              orderBy: { paymentDate: 'asc' },
            },
            rescheduledFrom: { select: { id: true, installmentNumber: true } },
            rescheduledTo: { select: { id: true, installmentNumber: true } },
          },
        },
      },
    });

    if (!schedule) return null;

    // Web client expects a flat list of TimelineEvent — one per installment —
    // each containing its payments[] inline. Determine the event "type" from
    // status: rescheduled installments are reschedule events; if any payments
    // exist treat it as a payment event; otherwise it's the installment due event.
    return schedule.installments.map((inst) => {
      const lastPayment = inst.payments[inst.payments.length - 1];
      const hasPayments = inst.payments.length > 0;
      const type: 'installment' | 'payment' | 'reschedule' = inst.isRescheduled
        ? 'reschedule'
        : hasPayments
          ? 'payment'
          : 'installment';

      return {
        id: inst.id,
        installmentNumber: inst.installmentNumber,
        parentInstallmentNumber: inst.parentInstallmentNumber,
        subSequence: inst.subSequence,
        isClosed: inst.isClosed,
        type,
        date: lastPayment?.paymentDate ?? inst.dueDate,
        dueDate: inst.dueDate,
        amountDue: Number(inst.amountDue),
        amountPaid: Number(inst.amountPaid),
        remainingAmount: Number(inst.remainingAmount),
        status: inst.status,
        paymentMode: lastPayment?.paymentMode,
        collectedBy: lastPayment?.collector?.fullName ?? undefined,
        isRescheduled: inst.isRescheduled,
        rescheduledFromId: inst.rescheduledFromId ?? undefined,
        rescheduledToId: inst.rescheduledTo?.[0]?.id ?? undefined,
        notes: inst.notes ?? undefined,
        payments: inst.payments.map((p) => ({
          id: p.id,
          installmentId: p.installmentId,
          amount: Number(p.amount),
          paymentMode: p.paymentMode,
          paymentDate: p.paymentDate,
          collectedBy: p.collectedBy,
          referenceNumber: p.referenceNumber,
          notes: p.notes,
          createdAt: p.createdAt,
          collectorName: p.collector?.fullName ?? undefined,
        })),
      };
    });
  },

  /**
   * Record a payment — handles ALL 3 scenarios in a single method.
   *
   * Scenario 1: full_payment — Mark installment as paid, create payment record
   * Scenario 2: reschedule — Mark original as rescheduled, create new installment on new date
   * Scenario 3: partial_reschedule — Record partial payment, create new installment for remainder
   *
   * After payment: check if ALL installments in the schedule are paid → update schedule status.
   */
  async recordPayment(
    installmentId: string,
    data: {
      scenario: 'full_payment' | 'reschedule' | 'partial_reschedule';
      amountPaid?: number;
      paymentMode?: string;
      paymentBreakdown?: Array<{ mode: string; amount: number }>;
      paymentDate?: string;
      newDate?: string;
      referenceNumber?: string;
      notes?: string;
      earlyCollectionDate?: string;
      applyInterest?: { amount: number; notes?: string };
      waiveExcessInterest?: boolean;
    },
    userId: string,
  ) {
    // 1. Fetch installment with schedule
    const installment = await prisma.installment.findUnique({
      where: { id: installmentId },
      include: {
        schedule: {
          include: {
            sale: { select: { shopId: true, saleNumber: true, interestRate: true } },
          },
        },
      },
    });

    if (!installment) {
      throw new Error('Installment not found');
    }

    if (installment.status === 'paid') {
      throw new Error('Installment is already fully paid');
    }

    if (installment.isRescheduled && installment.status === 'rescheduled') {
      throw new Error('Installment has been rescheduled. Pay the rescheduled installment instead.');
    }

    // Discretionary overdue interest will be applied as part of this
    // transaction, BEFORE recording the payment. The remaining amount used
    // for the rest of the flow is the post-interest value.
    const interestToApply = data.applyInterest?.amount ?? 0;
    const remainingAmount = Number(installment.remainingAmount) + interestToApply;
    const schedule = installment.schedule;

    // 2. Execute scenario in a transaction
    const result = await prisma.$transaction(async (tx) => {
      let paymentRecord = null;
      let newInstallment = null;

      // 2a. If the collector chose to apply discretionary overdue interest
      // as part of this payment, persist it FIRST so amountDue reflects the
      // bumped value before the payment posts. The whole transaction rolls
      // back atomically if the payment fails.
      if (data.applyInterest && data.applyInterest.amount > 0) {
        const monthlyRate = Number(installment.schedule.sale.interestRate ?? 0);
        const due = installment.dueDate;
        const today = new Date();
        const dueDay = Date.UTC(
          due.getUTCFullYear(),
          due.getUTCMonth(),
          due.getUTCDate(),
        );
        const todayDay = Date.UTC(
          today.getUTCFullYear(),
          today.getUTCMonth(),
          today.getUTCDate(),
        );
        const daysOverdue = Math.max(
          0,
          Math.floor((todayDay - dueDay) / (1000 * 60 * 60 * 24)),
        );
        const dailyRate = monthlyRate / 100 / 30;

        const app = await tx.installmentInterestApplication.create({
          data: {
            installmentId,
            scheduleId: schedule.id,
            daysOverdue,
            dailyRate,
            baseAmount: Number(installment.remainingAmount),
            appliedAmount: data.applyInterest.amount,
            appliedBy: userId,
            notes: data.applyInterest.notes ?? null,
          },
        });
        await tx.installment.update({
          where: { id: installmentId },
          data: {
            amountDue: { increment: data.applyInterest.amount },
            remainingAmount: { increment: data.applyInterest.amount },
          },
        });
        const instLabel =
          installment.parentInstallmentNumber != null && installment.subSequence != null
            ? `#${installment.parentInstallmentNumber}.${installment.subSequence}`
            : `#${installment.installmentNumber}`;
        await tx.installmentRollLog.create({
          data: {
            scheduleId: schedule.id,
            installmentId,
            eventType: 'interest_applied',
            eventDate: new Date(),
            actorUserId: userId,
            displayMessage:
              `Overdue interest of ₹${data.applyInterest.amount.toLocaleString('en-IN')} applied to installment ${instLabel} (${daysOverdue} days overdue) along with payment.` +
              (data.applyInterest.notes ? ` Note: ${data.applyInterest.notes}` : ''),
            metadata: {
              applicationId: app.id,
              amount: data.applyInterest.amount,
              daysOverdue,
              dailyRate,
              baseAmount: Number(installment.remainingAmount),
              appliedAlongsidePayment: true,
            } as Prisma.InputJsonValue,
          },
        });
        await tx.auditLog.create({
          data: {
            userId,
            shopId: installment.schedule.sale.shopId,
            entityType: 'installment',
            entityId: installmentId,
            action: 'interest_applied',
            oldValues: { remainingAmount: Number(installment.remainingAmount) } as any,
            newValues: {
              applicationId: app.id,
              appliedAmount: data.applyInterest.amount,
              daysOverdue,
              appliedAlongsidePayment: true,
            } as any,
          },
        });
      }

      if (data.scenario === 'full_payment') {
        // Validate amount
        const amount = data.amountPaid!;
        if (amount < remainingAmount) {
          throw new Error(
            `Amount ${amount} is less than remaining amount ${remainingAmount}. Use partial_reschedule scenario instead.`,
          );
        }

        // Overpayment handling: excess is distributed across future primaries
        // (R7). We record the FULL cash amount on the source installment's
        // amountPaid so the UI reflects what the customer actually handed
        // over for this row. The original `amountDue` (contractual EMI) is
        // left unchanged — `remainingAmount` is forced to 0 because the
        // excess has been redistributed elsewhere.
        const excess = amount - remainingAmount;
        const amountAppliedToRow = amount;

        // Determine payment date (employee can override). NOTE: we never
        // mutate the installment's original dueDate — the paid-on date lives
        // on the InstallmentPayment row so the timeline preserves whether
        // the customer paid early, on time, or late.
        const paidOnDate = data.paymentDate ? new Date(data.paymentDate) : new Date();

        await tx.installment.update({
          where: { id: installmentId },
          data: {
            amountPaid: { increment: amountAppliedToRow },
            remainingAmount: 0,
            status: 'paid',
            notes: data.notes ?? null,
          },
        });

        // Create payment record (full cash amount, including excess). When
        // the collector split the payment across multiple modes, we create
        // one InstallmentPayment row per split for full audit fidelity; the
        // first row carries the reference number.
        const splits =
          data.paymentBreakdown && data.paymentBreakdown.length > 0
            ? data.paymentBreakdown
            : [{ mode: data.paymentMode!, amount }];
        let firstRecord = null;
        for (let i = 0; i < splits.length; i++) {
          const s = splits[i];
          const created = await tx.installmentPayment.create({
            data: {
              installmentId,
              amount: s.amount,
              paymentMode: s.mode as any,
              paymentDate: paidOnDate,
              collectedBy: userId,
              referenceNumber: i === 0 ? data.referenceNumber ?? null : null,
              notes:
                splits.length > 1
                  ? `${data.notes ?? ''}${data.notes ? ' · ' : ''}Split ${i + 1}/${splits.length}`.trim()
                  : data.notes ?? null,
            },
          });
          if (i === 0) firstRecord = created;
        }
        paymentRecord = firstRecord;

        // Audit log
        await tx.installmentRollLog.create({
          data: {
            scheduleId: schedule.id,
            installmentId,
            eventType: 'payment_recorded',
            eventDate: paidOnDate,
            actorUserId: userId,
            displayMessage:
              `Payment of ₹${amount.toLocaleString('en-IN')} received for Installment ` +
              `#${installment.installmentNumber} via ${data.paymentMode?.replace(/_/g, ' ') ?? 'cash'}.` +
              (data.referenceNumber ? ` Ref: ${data.referenceNumber}.` : '') +
              (data.notes ? ` Note: ${data.notes}` : ''),
            metadata: {
              installmentId,
              installmentNumber: installment.installmentNumber,
              amount,
              amountAppliedToRow,
              excess,
              paymentMode: data.paymentMode,
              referenceNumber: data.referenceNumber ?? null,
            } as Prisma.InputJsonValue,
          },
        });

        // Distribute any excess across future primaries (R7).
        if (excess > 0.005) {
          const sourcePrimaryNumber =
            installment.parentInstallmentNumber ?? installment.installmentNumber;
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const { distributed, targets } = await distributeOverpayment(tx, {
            scheduleId: schedule.id,
            sourcePrimaryNumber,
            sourceInstallmentId: installmentId,
            excess,
            today,
            actorUserId: userId,
            paymentMode: data.paymentMode,
            notes: data.notes,
            waiveInterest: data.waiveExcessInterest === true,
          });
          if (targets.length === 0) {
            // No future primaries to absorb the excess. Roll back the
            // transaction so the caller can show a clear validation error
            // instead of silently keeping the excess on the source row.
            throw new Error(
              `Overpayment of ₹${excess.toLocaleString('en-IN')} cannot be distributed: ` +
                `no future unpaid installments remain on this schedule.`,
            );
          }
          void distributed;
        }

        // Handle early collection date for next installment
        if (data.earlyCollectionDate) {
          const earlyDate = new Date(data.earlyCollectionDate);
          // Find the next upcoming primary installment after this one
          const nextInstallment = await tx.installment.findFirst({
            where: {
              scheduleId: schedule.id,
              installmentNumber: { gt: installment.installmentNumber },
              status: { in: ['upcoming', 'overdue', 'due_today'] },
              parentInstallmentNumber: null,
            },
            orderBy: { installmentNumber: 'asc' },
          });

          if (nextInstallment) {
            // Determine next subSequence
            const lastSub = await tx.installment.findFirst({
              where: {
                scheduleId: schedule.id,
                parentInstallmentNumber: nextInstallment.installmentNumber,
              },
              orderBy: { subSequence: 'desc' },
              select: { subSequence: true },
            });
            const nextSub = (lastSub?.subSequence ?? 0) + 1;

            // Create a sub-row marker for early collection
            await tx.installment.create({
              data: {
                scheduleId: schedule.id,
                installmentNumber: nextInstallment.installmentNumber,
                parentInstallmentNumber: nextInstallment.installmentNumber,
                subSequence: nextSub,
                dueDate: earlyDate,
                amountDue: Number(nextInstallment.amountDue),
                amountPaid: 0,
                remainingAmount: Number(nextInstallment.remainingAmount),
                status: 'upcoming',
                notes: `Early collection scheduled — customer willing to pay before ${new Date(nextInstallment.dueDate).toISOString().split('T')[0]}.`,
              },
            });

            // Mark the original next installment as rescheduled
            await tx.installment.update({
              where: { id: nextInstallment.id },
              data: {
                isRescheduled: true,
                status: 'rescheduled',
                notes: `Rescheduled to ${data.earlyCollectionDate} (early collection)`,
              },
            });

            // Log the early collection scheduling
            await tx.installmentRollLog.create({
              data: {
                scheduleId: schedule.id,
                installmentId: nextInstallment.id,
                eventType: 'early_collection_scheduled',
                eventDate: new Date(),
                actorUserId: userId,
                displayMessage:
                  `Early collection for installment #${nextInstallment.installmentNumber} ` +
                  `scheduled on ${data.earlyCollectionDate} (original due: ${new Date(nextInstallment.dueDate).toISOString().split('T')[0]}).`,
                metadata: {
                  originalDueDate: nextInstallment.dueDate,
                  earlyDate: data.earlyCollectionDate,
                  installmentNumber: nextInstallment.installmentNumber,
                } as Prisma.InputJsonValue,
              },
            });
          }
        }
      } else if (data.scenario === 'reschedule') {
        const newDate = new Date(data.newDate!);

        // Mark original as rescheduled
        await tx.installment.update({
          where: { id: installmentId },
          data: {
            isRescheduled: true,
            status: 'rescheduled',
            notes: data.notes ?? `Rescheduled to ${data.newDate}`,
          },
        });

        // Create new installment on the new date. Preserve sub-row identity
        // (parentInstallmentNumber + subSequence) so e.g. 6.1 stays 6.1 on the
        // new date rather than appearing as a primary #6.
        newInstallment = await tx.installment.create({
          data: {
            scheduleId: schedule.id,
            installmentNumber: installment.installmentNumber,
            parentInstallmentNumber: installment.parentInstallmentNumber,
            subSequence: installment.subSequence,
            dueDate: newDate,
            amountDue: Number(installment.remainingAmount),
            amountPaid: 0,
            remainingAmount: Number(installment.remainingAmount),
            status: 'upcoming',
            isRescheduled: false,
            rescheduledFromId: installmentId,
            notes: data.notes ?? `Rescheduled from ${new Date(installment.dueDate).toISOString().split('T')[0]}. Original installment #${installment.installmentNumber}.`,
          },
        });

        // Audit log
        const instLabel =
          installment.parentInstallmentNumber != null && installment.subSequence != null
            ? `#${installment.parentInstallmentNumber}.${installment.subSequence}`
            : `#${installment.installmentNumber}`;
        const fromDateStr = new Date(installment.dueDate).toISOString().split('T')[0];
        const toDateStr = newDate.toISOString().split('T')[0];
        await tx.installmentRollLog.create({
          data: {
            scheduleId: schedule.id,
            installmentId,
            eventType: 'rescheduled',
            eventDate: new Date(),
            actorUserId: userId,
            displayMessage:
              `Installment ${instLabel} rescheduled from ${fromDateStr} to ${toDateStr}.` +
              (data.notes ? ` Note: ${data.notes}` : ''),
            metadata: {
              installmentId,
              newInstallmentId: newInstallment.id,
              installmentNumber: installment.installmentNumber,
              parentInstallmentNumber: installment.parentInstallmentNumber,
              subSequence: installment.subSequence,
              fromDate: fromDateStr,
              toDate: toDateStr,
              amount: Number(installment.remainingAmount),
            } as Prisma.InputJsonValue,
          },
        });
      } else if (data.scenario === 'partial_reschedule') {
        const amount = data.amountPaid!;
        const newDate = new Date(data.newDate!);

        if (amount >= remainingAmount) {
          throw new Error(
            `Partial amount ${amount} must be less than remaining amount ${remainingAmount}. Use full_payment scenario instead.`,
          );
        }

        const newRemainingAmount = remainingAmount - amount;

        // 1. Record the partial payment on the source installment
        await tx.installment.update({
          where: { id: installmentId },
          data: {
            amountPaid: { increment: amount },
            remainingAmount: newRemainingAmount,
            status: 'partially_paid',
            notes: data.notes ?? null,
          },
        });

        // Create payment row(s). Multi-mode splits create one row per mode.
        const partialSplits =
          data.paymentBreakdown && data.paymentBreakdown.length > 0
            ? data.paymentBreakdown
            : [{ mode: data.paymentMode!, amount }];
        let firstPartialRecord = null;
        for (let i = 0; i < partialSplits.length; i++) {
          const s = partialSplits[i];
          const baseNote = data.notes ?? `Partial payment of ${amount}. Promise date: ${data.newDate}.`;
          const created = await tx.installmentPayment.create({
            data: {
              installmentId,
              amount: s.amount,
              paymentMode: s.mode as any,
              paymentDate: new Date(),
              collectedBy: userId,
              referenceNumber: i === 0 ? data.referenceNumber ?? null : null,
              notes:
                partialSplits.length > 1
                  ? `${baseNote} · Split ${i + 1}/${partialSplits.length}`
                  : baseNote,
            },
          });
          if (i === 0) firstPartialRecord = created;
        }
        paymentRecord = firstPartialRecord;

        // 2. Delegate chain handling (create sub / absorb into next) to the rule engine
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const result = await applyPartialWithPromise(tx, {
          sourceInstallmentId: installmentId,
          newPromiseDate: newDate,
          remainderAfterPayment: newRemainingAmount,
          actorUserId: userId,
          employeeNote: data.notes,
          today,
        });

        // If a sub row was created, expose it in the response as newInstallment
        if (result.branch === 'sub_created' && result.newSubId) {
          newInstallment = await tx.installment.findUnique({
            where: { id: result.newSubId },
          });
        }
      }

      // Sync schedule + sale aggregates. This also handles the
      // "schedule_completed" roll log and sets sale.completedAt when every
      // installment is settled (remaining == 0 across the schedule).
      await syncScheduleAndSale(tx, schedule.id, userId);

      return { paymentRecord, newInstallment };
    });

    // Return updated installment with full details
    const updated = await prisma.installment.findUnique({
      where: { id: installmentId },
      include: {
        payments: {
          include: {
            collector: {
              select: { id: true, username: true, fullName: true },
            },
          },
          orderBy: { paymentDate: 'desc' },
        },
        rescheduledTo: {
          select: {
            id: true,
            installmentNumber: true,
            dueDate: true,
            amountDue: true,
            status: true,
          },
        },
        schedule: {
          select: {
            id: true,
            status: true,
            sale: {
              select: {
                saleNumber: true,
                customer: { select: { name: true, phone: true } },
              },
            },
          },
        },
      },
    });

    return {
      installment: updated,
      newInstallment: result.newInstallment,
      payment: result.paymentRecord,
    };
  },

  /**
   * Search installment schedules by ledger number, sale number, customer phone, or customer name.
   * Used for quick lookup when a customer walks in to pay.
   */
  async searchSchedules(shopId: string, query: string, filterBy: string) {
    const searchTerm = query.trim();
    if (!searchTerm) return [];

    // Build sale filter based on search type
    let saleFilter: any = { shopId };

    switch (filterBy) {
      case 'ledger_number':
        saleFilter.ledgerNumber = { contains: searchTerm, mode: 'insensitive' };
        break;
      case 'sale_number':
        saleFilter.saleNumber = { contains: searchTerm, mode: 'insensitive' };
        break;
      case 'customer_phone':
        saleFilter.customer = { phone: { contains: searchTerm } };
        break;
      case 'customer_name':
        saleFilter.customer = { name: { contains: searchTerm, mode: 'insensitive' } };
        break;
      case 'all':
      default:
        saleFilter.OR = [
          { ledgerNumber: { contains: searchTerm, mode: 'insensitive' } },
          { saleNumber: { contains: searchTerm, mode: 'insensitive' } },
          { customer: { phone: { contains: searchTerm } } },
          { customer: { name: { contains: searchTerm, mode: 'insensitive' } } },
        ];
        break;
    }

    return prisma.installmentSchedule.findMany({
      where: {
        status: 'active',
        sale: saleFilter,
      },
      take: 10,
      include: {
        sale: {
          select: {
            id: true,
            saleNumber: true,
            ledgerNumber: true,
            saleDate: true,
            sellingPrice: true,
            totalAmount: true,
            downPayment: true,
            customer: {
              select: { id: true, name: true, phone: true, customerCode: true },
            },
            product: {
              select: { id: true, brand: true, modelNumber: true },
            },
          },
        },
        installments: {
          where: { isRescheduled: false },
          orderBy: [{ installmentNumber: 'asc' }, { dueDate: 'asc' }],
          select: {
            id: true,
            installmentNumber: true,
            dueDate: true,
            amountDue: true,
            amountPaid: true,
            remainingAmount: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  /**
   * Dedicated reschedule method (Scenario 2).
   * Creates new installment on the new date, marks original as rescheduled.
   */
  async reschedule(
    installmentId: string,
    data: { newDate: string; notes?: string },
    userId: string | null = null,
  ) {
    const installment = await prisma.installment.findUnique({
      where: { id: installmentId },
      include: {
        schedule: {
          select: { id: true, status: true },
        },
      },
    });

    if (!installment) {
      throw new Error('Installment not found');
    }

    if (installment.status === 'paid') {
      throw new Error('Cannot reschedule a paid installment');
    }

    if (installment.isRescheduled && installment.status === 'rescheduled') {
      throw new Error('Installment has already been rescheduled');
    }

    const newDate = new Date(data.newDate);

    const result = await prisma.$transaction(async (tx) => {
      // Mark original as rescheduled
      await tx.installment.update({
        where: { id: installmentId },
        data: {
          isRescheduled: true,
          status: 'rescheduled',
          notes: data.notes ?? `Rescheduled to ${data.newDate}`,
        },
      });

      // Create new installment on new date. Preserve sub-row identity so
      // rescheduling 6.1 produces a new 6.1 on the new date (not a primary #6).
      const newInstallment = await tx.installment.create({
        data: {
          scheduleId: installment.schedule.id,
          installmentNumber: installment.installmentNumber,
          parentInstallmentNumber: installment.parentInstallmentNumber,
          subSequence: installment.subSequence,
          dueDate: newDate,
          amountDue: Number(installment.remainingAmount),
          amountPaid: 0,
          remainingAmount: Number(installment.remainingAmount),
          status: 'upcoming',
          isRescheduled: false,
          rescheduledFromId: installmentId,
          notes: data.notes ?? `Rescheduled from ${new Date(installment.dueDate).toISOString().split('T')[0]}. Original installment #${installment.installmentNumber}.`,
        },
      });

      // Audit log
      const instLabel =
        installment.parentInstallmentNumber != null && installment.subSequence != null
          ? `#${installment.parentInstallmentNumber}.${installment.subSequence}`
          : `#${installment.installmentNumber}`;
      const fromDateStr = new Date(installment.dueDate).toISOString().split('T')[0];
      const toDateStr = newDate.toISOString().split('T')[0];
      await tx.installmentRollLog.create({
        data: {
          scheduleId: installment.schedule.id,
          installmentId,
          eventType: 'rescheduled',
          eventDate: new Date(),
          actorUserId: userId,
          displayMessage:
            `Installment ${instLabel} rescheduled from ${fromDateStr} to ${toDateStr}.` +
            (data.notes ? ` Note: ${data.notes}` : ''),
          metadata: {
            installmentId,
            newInstallmentId: newInstallment.id,
            installmentNumber: installment.installmentNumber,
            parentInstallmentNumber: installment.parentInstallmentNumber,
            subSequence: installment.subSequence,
            fromDate: fromDateStr,
            toDate: toDateStr,
            amount: Number(installment.remainingAmount),
          } as Prisma.InputJsonValue,
        },
      });

      await syncScheduleAndSale(tx, installment.schedule.id);

      return newInstallment;
    });

    // Return with full details
    const newInstallment = await prisma.installment.findUnique({
      where: { id: result.id },
      include: {
        rescheduledFrom: {
          select: {
            id: true,
            installmentNumber: true,
            dueDate: true,
            amountDue: true,
          },
        },
        schedule: {
          select: {
            id: true,
            sale: {
              select: {
                saleNumber: true,
                customer: { select: { name: true, phone: true } },
              },
            },
          },
        },
      },
    });

    return newInstallment;
  },

  /**
   * Return the audit trail (roll log) for a schedule, newest first.
   * Includes the actor user (if any) for user-driven events.
   */
  async getRollLog(scheduleId: string) {
    const events = await prisma.installmentRollLog.findMany({
      where: { scheduleId },
      orderBy: [{ eventDate: 'desc' }, { createdAt: 'desc' }],
      include: {
        actor: { select: { id: true, fullName: true, username: true } },
      },
    });
    return events;
  },

  /**
   * Manually trigger the rule engine. Used by the admin endpoint for
   * ops/recovery. Defaults to "today" and all active schedules, but can be
   * scoped to a specific date or schedule.
   */
  async runRollover(args: { date?: string; scheduleId?: string }) {
    const today = args.date ? new Date(args.date) : new Date();
    today.setHours(0, 0, 0, 0);
    const result = await prisma.$transaction(async (tx) => {
      return ensureRolledForToday(tx, today, {
        scheduleId: args.scheduleId,
      });
    });
    return {
      date: today.toISOString().split('T')[0],
      scope: args.scheduleId ? `schedule:${args.scheduleId}` : 'all-active-schedules',
      ...result,
    };
  },

  /**
   * Revert (undo) a specific installment payment.
   * Restores the installment amounts and logs the reversal in the activity log.
   */
  async revertPayment(
    paymentId: string,
    reason: string,
    userId: string,
  ) {
    const payment = await prisma.installmentPayment.findUnique({
      where: { id: paymentId },
      include: {
        installment: {
          include: {
            schedule: { select: { id: true, status: true } },
          },
        },
      },
    });

    if (!payment) {
      throw new Error('Payment not found');
    }

    const inst = payment.installment;
    const amountToRevert = Number(payment.amount);

    const result = await prisma.$transaction(async (tx) => {
      // Delete the payment record
      await tx.installmentPayment.delete({ where: { id: paymentId } });

      // Restore installment amounts
      const newAmountPaid = Math.max(0, Number(inst.amountPaid) - amountToRevert);
      const newRemaining = Number(inst.amountDue) - newAmountPaid;
      const newStatus = newAmountPaid <= 0
        ? (new Date(inst.dueDate) < new Date() ? 'overdue' : 'upcoming')
        : 'partially_paid';

      await tx.installment.update({
        where: { id: inst.id },
        data: {
          amountPaid: newAmountPaid,
          remainingAmount: newRemaining,
          status: newStatus,
        },
      });

      // Log the reversal
      const instLabel = inst.parentInstallmentNumber != null && inst.subSequence != null
        ? `#${inst.parentInstallmentNumber}.${inst.subSequence}`
        : `#${inst.installmentNumber}`;
      await tx.installmentRollLog.create({
        data: {
          scheduleId: inst.schedule.id,
          installmentId: inst.id,
          eventType: 'payment_reverted',
          eventDate: new Date(),
          actorUserId: userId,
          displayMessage: `Payment of ₹${amountToRevert.toLocaleString('en-IN')} on installment ${instLabel} was reverted. Reason: ${reason}`,
          metadata: {
            paymentId,
            amount: amountToRevert,
            paymentMode: payment.paymentMode,
            reason,
          } as Prisma.InputJsonValue,
        },
      });

      // Re-sync schedule totals
      await syncScheduleAndSale(tx, inst.schedule.id);

      // The reverted payment may have re-exposed an overdue chain whose
      // next-primary date has already passed. Reset the schedule's
      // lastRolloverDate so the rule engine re-evaluates redistributions
      // for today, then run it. This restores Rule R4 behavior: an
      // installment that's been overdue for >= a month rolls into the
      // next primary instead of remaining as a stand-alone overdue row.
      await tx.installmentSchedule.update({
        where: { id: inst.schedule.id },
        data: { lastRolloverDate: null },
      });
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      await ensureRolledForToday(tx, today, { scheduleId: inst.schedule.id });

      return { installmentId: inst.id, amountReverted: amountToRevert };
    });

    return result;
  },

  /**
   * Compute an early-closure quote: principal + file charge for unpaid
   * installments, with future interest waived. Read-only — used by the UI to
   * show a "Pay X to close the loan" amount.
   */
  async getSettlementQuote(scheduleId: string) {
    const schedule = await prisma.installmentSchedule.findUnique({
      where: { id: scheduleId },
      include: {
        sale: { select: { id: true, saleNumber: true } },
        installments: {
          select: {
            id: true,
            installmentNumber: true,
            amountDue: true,
            amountPaid: true,
            status: true,
            isRescheduled: true,
            isClosed: true,
          },
        },
      },
    });
    if (!schedule) return null;
    const quote = computeSettlementQuote({
      totalPrincipal: Number(schedule.totalPrincipal),
      totalInterest: Number(schedule.totalInterest),
      fileCharge: Number(schedule.fileCharge),
      numInstallments: schedule.numInstallments,
      installments: schedule.installments.map((i) => ({
        installmentNumber: i.installmentNumber,
        amountDue: Number(i.amountDue),
        amountPaid: Number(i.amountPaid),
        status: i.status as string,
        isRescheduled: i.isRescheduled,
        isClosed: i.isClosed,
      })),
    });
    return {
      scheduleId: schedule.id,
      saleId: schedule.saleId,
      saleNumber: schedule.sale.saleNumber,
      totalPrincipal: Number(schedule.totalPrincipal),
      totalInterest: Number(schedule.totalInterest),
      fileCharge: Number(schedule.fileCharge),
      numInstallments: schedule.numInstallments,
      asOf: new Date().toISOString(),
      ...quote,
    };
  },

  /**
   * Close the loan with a single final-settlement payment. Marks every
   * unpaid installment as paid (at its waived amount), records one
   * InstallmentPayment per installment for traceability, and creates both
   * an InstallmentRollLog and AuditLog entry.
   */
  async recordFinalSettlement(
    scheduleId: string,
    body: {
      paymentMode: string;
      paymentDate?: string;
      referenceNumber?: string;
      notes?: string;
      expectedAmount?: number;
    },
    userId: string,
  ) {
    const schedule = await prisma.installmentSchedule.findUnique({
      where: { id: scheduleId },
      include: {
        sale: { select: { id: true, shopId: true, saleNumber: true } },
        installments: {
          select: {
            id: true,
            installmentNumber: true,
            amountDue: true,
            amountPaid: true,
            remainingAmount: true,
            status: true,
            isRescheduled: true,
            isClosed: true,
          },
          orderBy: [{ installmentNumber: 'asc' }],
        },
      },
    });
    if (!schedule) throw new Error('Schedule not found');
    if (schedule.status === 'completed') {
      throw new Error('Schedule is already completed');
    }

    const quote = computeSettlementQuote({
      totalPrincipal: Number(schedule.totalPrincipal),
      totalInterest: Number(schedule.totalInterest),
      fileCharge: Number(schedule.fileCharge),
      numInstallments: schedule.numInstallments,
      installments: schedule.installments.map((i) => ({
        installmentNumber: i.installmentNumber,
        amountDue: Number(i.amountDue),
        amountPaid: Number(i.amountPaid),
        status: i.status as string,
        isRescheduled: i.isRescheduled,
        isClosed: i.isClosed,
      })),
    });
    if (quote.unpaidCount === 0) {
      throw new Error('No unpaid installments — schedule already settled');
    }

    if (
      body.expectedAmount !== undefined &&
      Math.abs(body.expectedAmount - quote.finalSettlement) > 1
    ) {
      throw new Error(
        `Quote out of date. Expected ₹${body.expectedAmount.toFixed(2)} but live quote is ₹${quote.finalSettlement.toFixed(2)}.`,
      );
    }

    const paymentDate = body.paymentDate ? new Date(body.paymentDate) : new Date();
    paymentDate.setHours(0, 0, 0, 0);

    const result = await prisma.$transaction(async (tx) => {
      const targetable = schedule.installments.filter(
        (i) => !i.isClosed && !i.isRescheduled && i.status !== 'paid',
      );
      const principalPlusFile = quote.perInstallment.principalShare + quote.perInstallment.fileChargeShare;

      let runningRefId = body.referenceNumber ?? null;
      const updates: Array<{
        installmentNumber: number;
        priorAmountDue: number;
        priorRemaining: number;
        newAmountDue: number;
        amountPaid: number;
      }> = [];

      for (const inst of targetable) {
        const newAmountDue = Math.round(principalPlusFile * 100) / 100;
        const priorAmountDue = Number(inst.amountDue);
        const priorRemaining = Number(inst.remainingAmount);
        const amountPaidNow = Math.max(0, newAmountDue - Number(inst.amountPaid));

        await tx.installment.update({
          where: { id: inst.id },
          data: {
            amountDue: newAmountDue,
            amountPaid: newAmountDue,
            remainingAmount: 0,
            status: 'paid',
          },
        });

        if (amountPaidNow > 0) {
          await tx.installmentPayment.create({
            data: {
              installmentId: inst.id,
              amount: amountPaidNow,
              paymentMode: body.paymentMode as any,
              paymentDate,
              collectedBy: userId,
              referenceNumber: runningRefId,
              notes: 'Final settlement (early closure)',
            },
          });
          // Only attach the reference number to the first payment — others
          // are part of the same atomic transaction.
          runningRefId = null;
        }

        updates.push({
          installmentNumber: inst.installmentNumber,
          priorAmountDue,
          priorRemaining,
          newAmountDue,
          amountPaid: amountPaidNow,
        });
      }

      await tx.installmentRollLog.create({
        data: {
          scheduleId,
          eventType: 'final_settlement',
          eventDate: paymentDate,
          actorUserId: userId,
          displayMessage:
            `Loan closed with final settlement of ₹${quote.finalSettlement.toLocaleString('en-IN')} ` +
            `(₹${quote.waivedInterest.toLocaleString('en-IN')} interest waived across ${quote.unpaidCount} installments).` +
            (body.notes ? ` Note: ${body.notes}` : ''),
          metadata: {
            finalSettlement: quote.finalSettlement,
            waivedInterest: quote.waivedInterest,
            unpaidCount: quote.unpaidCount,
            paymentMode: body.paymentMode,
            referenceNumber: body.referenceNumber ?? null,
            updates,
          } as Prisma.InputJsonValue,
        },
      });

      await tx.auditLog.create({
        data: {
          userId,
          shopId: schedule.sale.shopId,
          entityType: 'sale',
          entityId: schedule.sale.id,
          action: 'final_settlement',
          oldValues: {
            unpaidCount: quote.unpaidCount,
            originalUnpaidEmi: quote.unpaidCount * quote.perInstallment.emiAmount,
          } as any,
          newValues: {
            finalSettlement: quote.finalSettlement,
            waivedInterest: quote.waivedInterest,
            paymentMode: body.paymentMode,
            paymentDate: paymentDate.toISOString(),
          } as any,
        },
      });

      await syncScheduleAndSale(tx, scheduleId, userId);

      return { quote, updates };
    });

    return result;
  },

  /**
   * Compute the suggested overdue interest for every still-overdue installment
   * on a schedule, based on the parent sale's monthly interest rate. Includes
   * any active (not-rolled-back) interest application already on each row.
   */
  async getInterestAccrual(scheduleId: string) {
    const schedule = await prisma.installmentSchedule.findUnique({
      where: { id: scheduleId },
      include: {
        sale: { select: { id: true, interestRate: true } },
        installments: {
          where: { isRescheduled: false, isClosed: false },
          select: {
            id: true,
            installmentNumber: true,
            parentInstallmentNumber: true,
            subSequence: true,
            dueDate: true,
            amountDue: true,
            remainingAmount: true,
            status: true,
            interestApplications: {
              where: { rolledBackAt: null },
              orderBy: { appliedAt: 'desc' },
              select: {
                id: true,
                appliedAmount: true,
                appliedAt: true,
                appliedBy: true,
                notes: true,
              },
            },
          },
          orderBy: [{ installmentNumber: 'asc' }, { subSequence: 'asc' }],
        },
      },
    });
    if (!schedule) return null;

    const monthlyRate = Number(schedule.sale.interestRate ?? 0);
    const today = new Date();

    return schedule.installments.map((inst) => {
      const accrual = computeAccruedInterest({
        remainingAmount: Number(inst.remainingAmount),
        dueDate: inst.dueDate,
        asOf: today,
        monthlyInterestRate: monthlyRate,
      });
      const appliedActive = inst.interestApplications.reduce(
        (s, a) => s + Number(a.appliedAmount),
        0,
      );
      return {
        installmentId: inst.id,
        installmentNumber: inst.installmentNumber,
        parentInstallmentNumber: inst.parentInstallmentNumber,
        subSequence: inst.subSequence,
        dueDate: inst.dueDate,
        remainingAmount: Number(inst.remainingAmount),
        status: inst.status,
        daysOverdue: accrual.daysOverdue,
        suggestedInterest: accrual.accruedInterest,
        appliedInterest: Math.round(appliedActive * 100) / 100,
        applications: inst.interestApplications,
      };
    });
  },

  /**
   * Apply discretionary overdue interest to one installment. The employee
   * sees a suggested amount based on days overdue but may override it.
   * Adds the penalty to amountDue + remainingAmount and records the source
   * application row so it can be rolled back later.
   */
  async applyOverdueInterest(
    installmentId: string,
    body: { amount: number; notes?: string },
    userId: string,
  ) {
    const inst = await prisma.installment.findUnique({
      where: { id: installmentId },
      include: {
        schedule: {
          select: { id: true, sale: { select: { id: true, shopId: true, interestRate: true } } },
        },
      },
    });
    if (!inst) throw new Error('Installment not found');
    if (inst.isClosed) throw new Error('Installment is closed');
    if (inst.status === 'paid') {
      throw new Error('Cannot apply interest to a fully-paid installment');
    }

    const monthlyRate = Number(inst.schedule.sale.interestRate ?? 0);
    const accrual = computeAccruedInterest({
      remainingAmount: Number(inst.remainingAmount),
      dueDate: inst.dueDate,
      monthlyInterestRate: monthlyRate,
    });
    if (accrual.daysOverdue <= 0) {
      throw new Error('Installment is not overdue — no interest can be applied');
    }

    const amount = Math.round(body.amount * 100) / 100;
    if (amount <= 0) throw new Error('Amount must be positive');

    const result = await prisma.$transaction(async (tx) => {
      const app = await tx.installmentInterestApplication.create({
        data: {
          installmentId,
          scheduleId: inst.schedule.id,
          daysOverdue: accrual.daysOverdue,
          dailyRate: accrual.dailyRate,
          baseAmount: Number(inst.remainingAmount),
          appliedAmount: amount,
          appliedBy: userId,
          notes: body.notes ?? null,
        },
      });

      await tx.installment.update({
        where: { id: installmentId },
        data: {
          amountDue: { increment: amount },
          remainingAmount: { increment: amount },
        },
      });

      const instLabel =
        inst.parentInstallmentNumber != null && inst.subSequence != null
          ? `#${inst.parentInstallmentNumber}.${inst.subSequence}`
          : `#${inst.installmentNumber}`;

      await tx.installmentRollLog.create({
        data: {
          scheduleId: inst.schedule.id,
          installmentId,
          eventType: 'interest_applied',
          eventDate: new Date(),
          actorUserId: userId,
          displayMessage: `Overdue interest of ₹${amount.toLocaleString('en-IN')} applied to installment ${instLabel} (${accrual.daysOverdue} days overdue).` +
            (body.notes ? ` Note: ${body.notes}` : ''),
          metadata: {
            applicationId: app.id,
            amount,
            daysOverdue: accrual.daysOverdue,
            dailyRate: accrual.dailyRate,
            baseAmount: Number(inst.remainingAmount),
          } as Prisma.InputJsonValue,
        },
      });

      await tx.auditLog.create({
        data: {
          userId,
          shopId: inst.schedule.sale.shopId,
          entityType: 'installment',
          entityId: installmentId,
          action: 'interest_applied',
          oldValues: { remainingAmount: Number(inst.remainingAmount) } as any,
          newValues: {
            applicationId: app.id,
            appliedAmount: amount,
            daysOverdue: accrual.daysOverdue,
          } as any,
        },
      });

      await syncScheduleAndSale(tx, inst.schedule.id, userId);
      return app;
    });

    return result;
  },

  /**
   * Roll back a previously-applied overdue interest application. Restores
   * the installment's amountDue / remainingAmount and logs the reversal.
   */
  async rollbackInterestApplication(
    applicationId: string,
    body: { reason: string },
    userId: string,
  ) {
    const app = await prisma.installmentInterestApplication.findUnique({
      where: { id: applicationId },
      include: {
        installment: {
          select: {
            id: true,
            installmentNumber: true,
            parentInstallmentNumber: true,
            subSequence: true,
            amountPaid: true,
          },
        },
        schedule: { select: { id: true, sale: { select: { id: true, shopId: true } } } },
      },
    });
    if (!app) throw new Error('Interest application not found');
    if (app.rolledBackAt) throw new Error('Interest application is already rolled back');

    const amount = Number(app.appliedAmount);

    await prisma.$transaction(async (tx) => {
      await tx.installmentInterestApplication.update({
        where: { id: applicationId },
        data: {
          rolledBackAt: new Date(),
          rolledBackBy: userId,
          rollbackReason: body.reason,
        },
      });

      // Decrement installment dues by the rolled-back amount, never below
      // what's already been paid (so we don't go negative on remainingAmount).
      const inst = await tx.installment.findUnique({
        where: { id: app.installmentId },
        select: { id: true, amountDue: true, amountPaid: true, remainingAmount: true, status: true },
      });
      if (!inst) return;
      const newAmountDue = Math.max(Number(inst.amountPaid), Number(inst.amountDue) - amount);
      const newRemaining = Math.max(0, newAmountDue - Number(inst.amountPaid));
      const isPaid = newRemaining <= 0 && Number(inst.amountPaid) > 0;
      await tx.installment.update({
        where: { id: app.installmentId },
        data: {
          amountDue: newAmountDue,
          remainingAmount: newRemaining,
          status: isPaid ? 'paid' : (inst.status as any),
        },
      });

      const instLabel =
        app.installment.parentInstallmentNumber != null && app.installment.subSequence != null
          ? `#${app.installment.parentInstallmentNumber}.${app.installment.subSequence}`
          : `#${app.installment.installmentNumber}`;

      await tx.installmentRollLog.create({
        data: {
          scheduleId: app.schedule.id,
          installmentId: app.installmentId,
          eventType: 'interest_rolled_back',
          eventDate: new Date(),
          actorUserId: userId,
          displayMessage:
            `Overdue interest of ₹${amount.toLocaleString('en-IN')} on installment ${instLabel} rolled back. Reason: ${body.reason}`,
          metadata: {
            applicationId,
            amount,
            reason: body.reason,
          } as Prisma.InputJsonValue,
        },
      });

      await tx.auditLog.create({
        data: {
          userId,
          shopId: app.schedule.sale.shopId,
          entityType: 'installment',
          entityId: app.installmentId,
          action: 'interest_rolled_back',
          oldValues: { applicationId, appliedAmount: amount } as any,
          newValues: { rolledBackAt: new Date(), reason: body.reason } as any,
        },
      });

      await syncScheduleAndSale(tx, app.schedule.id, userId);
    });

    return { applicationId, amountReverted: amount };
  },
};

/**
 * Flatten nested Prisma collection data into flat objects for the frontend.
 */
function flattenCollections(collections: any[]) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return collections.map((inst: any) => {
    const sale = inst.schedule?.sale;
    const customer = sale?.customer;
    const product = sale?.product;
    return {
      id: inst.id,
      scheduleId: inst.scheduleId,
      installmentNumber: inst.installmentNumber,
      parentInstallmentNumber: inst.parentInstallmentNumber,
      subSequence: inst.subSequence,
      totalInstallments: inst.schedule?.numInstallments ?? 0,
      dueDate: inst.dueDate,
      amountDue: inst.amountDue,
      amountPaid: inst.amountPaid,
      remainingAmount: inst.remainingAmount,
      status: inst.status,
      daysOverdue: Math.max(0, Math.floor(
        (today.getTime() - new Date(inst.dueDate).getTime()) / (1000 * 60 * 60 * 24),
      )),
      customerName: customer?.name ?? '',
      customerPhone: customer?.phone ?? '',
      customerAddress: [customer?.addressLine1, customer?.city].filter(Boolean).join(', ') || undefined,
      productName: product?.modelNumber ?? '',
      productBrand: product?.brand ?? '',
      saleId: sale?.id ?? '',
    };
  });
}

function flattenPaidCollections(collections: any[]) {
  return collections.map((inst: any) => {
    const sale = inst.schedule?.sale;
    const customer = sale?.customer;
    const product = sale?.product;
    const payments = (inst.payments ?? []) as Array<{
      id: string;
      amount: any;
      paymentMode: string;
      paymentDate: Date | string;
    }>;
    const firstPayment = payments[0];
    const lastPayment = payments[payments.length - 1];
    const firstPaymentDate = firstPayment?.paymentDate ?? null;
    const daysFromDue = firstPaymentDate
      ? Math.floor(
          (new Date(firstPaymentDate).getTime() - new Date(inst.dueDate).getTime()) /
            (1000 * 60 * 60 * 24),
        )
      : null;
    return {
      id: inst.id,
      scheduleId: inst.scheduleId,
      installmentNumber: inst.installmentNumber,
      parentInstallmentNumber: inst.parentInstallmentNumber,
      subSequence: inst.subSequence,
      totalInstallments: inst.schedule?.numInstallments ?? 0,
      dueDate: inst.dueDate,
      amountDue: inst.amountDue,
      amountPaid: inst.amountPaid,
      remainingAmount: inst.remainingAmount,
      status: inst.status,
      firstPaymentDate,
      lastPaymentDate: lastPayment?.paymentDate ?? null,
      daysFromDue,
      paymentCount: payments.length,
      customerName: customer?.name ?? '',
      customerPhone: customer?.phone ?? '',
      customerAddress: [customer?.addressLine1, customer?.city].filter(Boolean).join(', ') || undefined,
      productName: product?.modelNumber ?? '',
      productBrand: product?.brand ?? '',
      saleId: sale?.id ?? '',
      saleNumber: sale?.saleNumber ?? '',
      ledgerNumber: sale?.ledgerNumber ?? '',
    };
  });
}
