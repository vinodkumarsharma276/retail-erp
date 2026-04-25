import { prisma } from '../../config/database.js';
import type { Prisma } from '@prisma/client';
import { ensureRolledForToday, applyPartialWithPromise, syncScheduleAndSale, distributeOverpayment } from './installments.rules.js';

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
      paymentDate?: string;
      newDate?: string;
      referenceNumber?: string;
      notes?: string;
      earlyCollectionDate?: string;
    },
    userId: string,
  ) {
    // 1. Fetch installment with schedule
    const installment = await prisma.installment.findUnique({
      where: { id: installmentId },
      include: {
        schedule: {
          include: {
            sale: { select: { shopId: true, saleNumber: true } },
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

    const remainingAmount = Number(installment.remainingAmount);
    const schedule = installment.schedule;

    // 2. Execute scenario in a transaction
    const result = await prisma.$transaction(async (tx) => {
      let paymentRecord = null;
      let newInstallment = null;

      if (data.scenario === 'full_payment') {
        // Validate amount
        const amount = data.amountPaid!;
        if (amount < remainingAmount) {
          throw new Error(
            `Amount ${amount} is less than remaining amount ${remainingAmount}. Use partial_reschedule scenario instead.`,
          );
        }

        // Overpayment handling: excess is distributed across future primaries
        // (R7). We cap the source installment's amountPaid at its amountDue
        // so the row reports as cleanly paid; the full cash amount is still
        // recorded as a single InstallmentPayment so the audit trail matches
        // what the customer actually handed over.
        const excess = amount - remainingAmount;
        const amountAppliedToRow = remainingAmount;

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

        // Create payment record (full cash amount, including excess)
        paymentRecord = await tx.installmentPayment.create({
          data: {
            installmentId,
            amount,
            paymentMode: data.paymentMode as any,
            paymentDate: paidOnDate,
            collectedBy: userId,
            referenceNumber: data.referenceNumber ?? null,
            notes: data.notes ?? null,
          },
        });

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

        paymentRecord = await tx.installmentPayment.create({
          data: {
            installmentId,
            amount,
            paymentMode: data.paymentMode as any,
            paymentDate: new Date(),
            collectedBy: userId,
            referenceNumber: data.referenceNumber ?? null,
            notes: data.notes ?? `Partial payment of ${amount}. Promise date: ${data.newDate}.`,
          },
        });

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

      return { installmentId: inst.id, amountReverted: amountToRevert };
    });

    return result;
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
