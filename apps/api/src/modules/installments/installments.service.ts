import { prisma } from '../../config/database.js';
import type { Prisma } from '@prisma/client';
import { ensureRolledForToday, applyPartialWithPromise, syncScheduleAndSale } from './installments.rules.js';

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

        // Determine payment date (employee can override)
        const paidOnDate = data.paymentDate ? new Date(data.paymentDate) : new Date();

        // Mark installment as paid; update dueDate if employee changed it
        const updateData: any = {
          amountPaid: { increment: amount },
          remainingAmount: 0,
          status: 'paid',
          notes: data.notes ?? null,
        };
        if (data.paymentDate) {
          updateData.dueDate = paidOnDate;
        }

        await tx.installment.update({
          where: { id: installmentId },
          data: updateData,
        });

        // Create payment record
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
              paymentMode: data.paymentMode,
              referenceNumber: data.referenceNumber ?? null,
            } as Prisma.InputJsonValue,
          },
        });
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

        // Create new installment on the new date
        newInstallment = await tx.installment.create({
          data: {
            scheduleId: schedule.id,
            installmentNumber: installment.installmentNumber,
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

      // Create new installment on new date
      const newInstallment = await tx.installment.create({
        data: {
          scheduleId: installment.schedule.id,
          installmentNumber: installment.installmentNumber,
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
