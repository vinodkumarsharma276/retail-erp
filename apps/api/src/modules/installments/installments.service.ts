import { prisma } from '../../config/database.js';
import type { Prisma } from '@prisma/client';
import { ensureRolledForToday, applyPartialWithPromise, syncScheduleAndSale, distributeOverpayment, resolveScheduleTenantId } from './installments.rules.js';
import { computeSettlementQuote, computeAccruedInterest, computeLatePenalty } from '@retailerp/shared-utils';
import { computeDaysOverdue, mergeInstallmentSettings } from './installments.derivations.js';
import type { CallListResponse, CallListRow } from '@retailerp/shared-types';
import { promisesService } from '../promises/promises.service.js';

/**
 * Scope object passed to read endpoints. `shopId` is always set (the user's
 * currently-active shop). When `shopIds` is also set we are in "All Shops"
 * mode: the read should fan out across every accessible shop.
 */
type ReadScope = { shopId: string; shopIds?: string[] };

/**
 * Builds the `sale.shopId` Prisma filter fragment for a read scope. In
 * single-shop mode returns `{ shopId: 'x' }`; in all-shops mode returns
 * `{ shopId: { in: [...] } }`.
 */
function saleScopeFilter(scope: ReadScope): Prisma.SaleRecordWhereInput {
  if (scope.shopIds && scope.shopIds.length > 0) {
    return { shopId: { in: scope.shopIds } };
  }
  return { shopId: scope.shopId };
}

/** UTC day truncation — used to compare dates without time-of-day noise. */
function toDateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Strip the `"Rescheduled to YYYY-MM-DD."` prefix (and any trailing space)
 * that `reschedule()` / `recordPayment(scenario='reschedule')` prepend to the
 * source row's notes. Idempotent — returns the original text when no such
 * prefix is present.
 */
function stripReschedulePrefix(notes: string | null): string | null {
  if (!notes) return notes;
  const match = notes.match(/^Rescheduled to \d{4}-\d{2}-\d{2}\.\s*/);
  if (!match) return notes;
  const stripped = notes.slice(match[0].length).trim();
  return stripped.length > 0 ? stripped : null;
}

export const installmentsService = {
  /**
   * List installment schedules for a shop (or all shops in All-Shops mode),
   * with optional status filter.
   */
  async listSchedules(
    scope: ReadScope,
    filters: {
      skip: number;
      take: number;
      page: number;
      pageSize: number;
      status?: string;
    },
  ) {
    const where: Prisma.InstallmentScheduleWhereInput = {
      sale: saleScopeFilter(scope),
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
   * Get all overdue installments for a shop (or all shops in All-Shops mode).
   * Overdue = dueDate < today AND status NOT in [paid, rescheduled].
   */
  /**
   * The collector's list for one day, one row per sale.
   *
   * - An EMI due that day is always listed, even if an earlier EMI has a
   *   promise running — the collector decides whether to call.
   * - A promise dated that day brings the customer back.
   * - Overdue EMIs covered by a promise dated LATER are snoozed until then.
   * - Once a promise date passes unpaid, its EMIs are overdue again and the
   *   row says the promise was broken.
   *
   * EMI due dates never move; promises only decide when to call.
   */
  async getCallList(
    scope: ReadScope,
    tenantId: string,
    date: string,
    opts?: { zone?: string },
  ): Promise<CallListResponse> {
    const day = new Date(`${date}T00:00:00.000Z`);
    const DAY_MS = 24 * 60 * 60 * 1000;
    const iso = (d: Date) => d.toISOString().slice(0, 10);

    const saleWhere: Prisma.SaleRecordWhereInput = saleScopeFilter(scope);
    if (opts?.zone) saleWhere.customer = { zone: opts.zone };

    const owingWhere: Prisma.InstallmentWhereInput = {
      parentInstallmentNumber: null,
      isClosed: false,
      remainingAmount: { gt: 0 },
    };

    const schedules = await prisma.installmentSchedule.findMany({
      where: {
        tenantId,
        status: 'active',
        sale: saleWhere,
        OR: [
          { installments: { some: { ...owingWhere, dueDate: { lte: day } } } },
          { promises: { some: { status: 'pending', promisedDate: { lte: day } } } },
        ],
      },
      select: {
        id: true,
        installments: {
          where: owingWhere,
          orderBy: [{ dueDate: 'asc' }, { installmentNumber: 'asc' }],
          select: {
            id: true,
            installmentNumber: true,
            dueDate: true,
            remainingAmount: true,
            carriedIn: {
              where: { rolledBackAt: null },
              select: { amount: true, fromInstallment: { select: { installmentNumber: true } } },
            },
          },
        },
        promises: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            status: true,
            createdAt: true,
            promisedDate: true,
            promisedAmount: true,
            coveredInstallmentIds: true,
          },
        },
        sale: {
          select: {
            id: true,
            saleNumber: true,
            ledgerNumber: true,
            customer: { select: { id: true, name: true, phone: true, zone: true, city: true } },
            product: { select: { brand: true, modelNumber: true } },
          },
        },
      },
    });

    const labels = await promisesService.labelPromises(
      schedules.flatMap((s) => s.promises),
      tenantId,
    );
    const labelOf = (promiseId: string) => Object.values(labels.get(promiseId) ?? {}).join(', ');

    type Reason = CallListRow['reasons'][number];
    const rank: Record<Reason['kind'], number> = { promise_due: 0, due_today: 1, promise_broken: 2, overdue: 3 };
    const rows: CallListRow[] = [];
    const snoozed: CallListResponse['snoozed'] = [];

    for (const schedule of schedules) {
      const dueNow = schedule.installments.filter((i) => i.dueDate <= day);
      const pending = schedule.promises.filter((p) => p.status === 'pending');
      const future = pending.filter((p) => p.promisedDate > day);
      const coveredLater = new Set(future.flatMap((p) => p.coveredInstallmentIds));
      const reasons: Reason[] = [];

      for (const p of pending.filter((p) => p.promisedDate.getTime() === day.getTime())) {
        reasons.push({ kind: 'promise_due', label: labelOf(p.id), amount: Number(p.promisedAmount) });
      }
      for (const i of dueNow.filter((i) => i.dueDate.getTime() === day.getTime())) {
        reasons.push({ kind: 'due_today', installmentNumber: i.installmentNumber, amount: Number(i.remainingAmount) });
      }

      const lateUncovered = dueNow.filter((i) => i.dueDate < day && !coveredLater.has(i.id));
      if (lateUncovered.length > 0) {
        // The most recent promise on these EMIs, if its date has passed and
        // it wasn't kept, is a broken promise worth mentioning.
        const lateIds = new Set(lateUncovered.map((i) => i.id));
        const lastPromise = [...schedule.promises]
          .reverse()
          .find(
            (p) =>
              p.status !== 'cancelled' &&
              p.status !== 'replaced' &&
              p.coveredInstallmentIds.some((id) => lateIds.has(id)),
          );
        if (
          lastPromise &&
          lastPromise.promisedDate < day &&
          (lastPromise.status === 'pending' || lastPromise.status === 'broken' || lastPromise.status === 'partially_kept')
        ) {
          reasons.push({
            kind: 'promise_broken',
            label: labelOf(lastPromise.id),
            promisedDate: iso(lastPromise.promisedDate),
            daysSince: Math.round((day.getTime() - lastPromise.promisedDate.getTime()) / DAY_MS),
          });
        }
        const oldest = lateUncovered[0];
        reasons.push({
          kind: 'overdue',
          oldestInstallmentNumber: oldest.installmentNumber,
          daysLate: Math.round((day.getTime() - oldest.dueDate.getTime()) / DAY_MS),
        });
      }

      const nextPromise = [...future].sort((a, b) => a.promisedDate.getTime() - b.promisedDate.getTime())[0];
      const openPromise = nextPromise
        ? { label: labelOf(nextPromise.id), promisedDate: iso(nextPromise.promisedDate), amount: Number(nextPromise.promisedAmount) }
        : null;

      if (reasons.length === 0) {
        if (nextPromise && dueNow.length > 0) {
          snoozed.push({
            scheduleId: schedule.id,
            customerName: schedule.sale.customer.name,
            label: openPromise!.label,
            promisedDate: openPromise!.promisedDate,
            amount: openPromise!.amount,
          });
        }
        continue;
      }

      reasons.sort((a, b) => rank[a.kind] - rank[b.kind]);
      rows.push({
        scheduleId: schedule.id,
        saleId: schedule.sale.id,
        saleNumber: schedule.sale.saleNumber,
        ledgerNumber: schedule.sale.ledgerNumber ?? '',
        customer: schedule.sale.customer,
        product: { brand: schedule.sale.product.brand, modelNumber: schedule.sale.product.modelNumber },
        reasons,
        dueNow: dueNow.map((i) => ({
          installmentId: i.id,
          installmentNumber: i.installmentNumber,
          dueDate: iso(i.dueDate),
          remainingAmount: Number(i.remainingAmount),
          carriedIn: i.carriedIn.map((c) => ({
            fromInstallmentNumber: c.fromInstallment.installmentNumber,
            amount: Number(c.amount),
          })),
        })),
        totalDueNow: dueNow.reduce((sum, i) => sum + Number(i.remainingAmount), 0),
        nextEmi: (() => {
          const next = schedule.installments.find((i) => i.dueDate > day);
          return next
            ? {
                installmentId: next.id,
                installmentNumber: next.installmentNumber,
                dueDate: iso(next.dueDate),
                remainingAmount: Number(next.remainingAmount),
              }
            : null;
        })(),
        openPromise,
      });
    }

    const daysLate = (row: CallListRow) => {
      const overdue = row.reasons.find((r) => r.kind === 'overdue');
      return overdue && overdue.kind === 'overdue' ? overdue.daysLate : 0;
    };
    rows.sort((a, b) => rank[a.reasons[0].kind] - rank[b.reasons[0].kind] || daysLate(b) - daysLate(a));
    snoozed.sort((a, b) => a.promisedDate.localeCompare(b.promisedDate));

    return { date, rows, snoozed };
  },

  async getOverdue(scope: ReadScope, opts?: { zone?: string }) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Lazy rollover — apply Rule C (absorb stale chains) and mark due_today
    // so the list reflects today's real state before we query it.
    await prisma.$transaction(async (tx) => {
      await ensureRolledForToday(tx, today, {
        shopId: scope.shopId,
        shopIds: scope.shopIds,
      });
    });

    // Optional zone filter — narrows by Customer.zone via the Sale relation.
    const saleWhere: Prisma.SaleRecordWhereInput = saleScopeFilter(scope);
    if (opts?.zone) {
      saleWhere.customer = { zone: opts.zone };
    }

    const overdueInstallments = await prisma.installment.findMany({
      where: {
        dueDate: { lt: today },
        status: { notIn: ['paid', 'rescheduled'] },
        isRescheduled: false,
        remainingAmount: { gt: 0 },
        schedule: {
          sale: saleWhere,
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
                ledgerNumber: true,
                saleDate: true,
                customer: {
                  select: {
                    id: true,
                    name: true,
                    phone: true,
                    customerCode: true,
                    addressLine1: true,
                    city: true,
                    zone: true,
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
                shop: {
                  select: { id: true, name: true, code: true },
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
        customerZone: customer?.zone ?? null,
        productName: product?.modelNumber ?? '',
        productBrand: product?.brand ?? '',
        saleId: sale?.id ?? '',
        saleNumber: (sale as any)?.saleNumber ?? '',
        ledgerNumber: (sale as any)?.ledgerNumber ?? '',
        shop: (sale as any)?.shop ?? null,
      };
    });
  },

  /**
   * Get all installments due on a specific date for a shop (or all shops in
   * All-Shops mode). This is THE daily collection list — the core feature
   * for employees. Optionally filter by assigned employee.
   */
  async getCollectionsForDate(
    scope: ReadScope,
    date: string,
    employeeId?: string,
    opts?: { zone?: string },
  ) {
    const targetDate = new Date(date);
    targetDate.setHours(0, 0, 0, 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Lazy rollover only when querying today (historical dates are immutable history).
    if (targetDate.getTime() === today.getTime()) {
      await prisma.$transaction(async (tx) => {
        await ensureRolledForToday(tx, today, {
          shopId: scope.shopId,
          shopIds: scope.shopIds,
        });
      });
    }

    // Optional zone narrowing via Customer.zone
    const saleWhere: Prisma.SaleRecordWhereInput = saleScopeFilter(scope);
    if (opts?.zone) {
      saleWhere.customer = { zone: opts.zone };
    }

    // Build the base where clause
    const where: Prisma.InstallmentWhereInput = {
      dueDate: targetDate,
      status: { notIn: ['paid', 'rescheduled'] },
      isRescheduled: false,
      remainingAmount: { gt: 0 },
      schedule: {
        sale: saleWhere,
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
                    zone: true,
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
                shop: {
                  select: { id: true, name: true, code: true },
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
          sale: saleScopeFilter(scope),
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
    scope: ReadScope,
    dateFrom: string,
    dateTo: string,
    opts?: { zone?: string },
  ) {
    const fromDate = new Date(dateFrom);
    fromDate.setHours(0, 0, 0, 0);
    const toDate = new Date(dateTo);
    toDate.setHours(23, 59, 59, 999);

    const saleWhere: Prisma.SaleRecordWhereInput = saleScopeFilter(scope);
    if (opts?.zone) {
      saleWhere.customer = { zone: opts.zone };
    }

    const collections = await prisma.installment.findMany({
      where: {
        dueDate: { gte: fromDate, lte: toDate },
        amountPaid: { gt: 0 },
        schedule: {
          sale: saleWhere,
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
                    zone: true,
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
                shop: {
                  select: { id: true, name: true, code: true },
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
   * Get all installments due within a date range for a shop (or all shops
   * in All-Shops mode). Used to show pending collections for a period
   * (e.g., last 2 weeks to today). Optionally filter by assigned employee.
   */
  async getCollectionsForDateRange(
    scope: ReadScope,
    dateFrom: string,
    dateTo: string,
    employeeId?: string,
    opts?: { zone?: string },
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
        await ensureRolledForToday(tx, today, {
          shopId: scope.shopId,
          shopIds: scope.shopIds,
        });
      });
    }

    const saleWhere: Prisma.SaleRecordWhereInput = saleScopeFilter(scope);
    if (opts?.zone) {
      saleWhere.customer = { zone: opts.zone };
    }

    const where: Prisma.InstallmentWhereInput = {
      dueDate: { gte: fromDate, lte: toDate },
      status: { notIn: ['paid', 'rescheduled'] },
      isRescheduled: false,
      remainingAmount: { gt: 0 },
      schedule: {
        sale: saleWhere,
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
                    zone: true,
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
                shop: {
                  select: { id: true, name: true, code: true },
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
          sale: saleScopeFilter(scope),
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
            penaltyPerDay: true,
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
            // Why an EMI differs from plan: shortfalls spread onto it / off it.
            carriedIn: {
              where: { rolledBackAt: null },
              select: { amount: true, fromInstallment: { select: { installmentNumber: true } } },
            },
            carriedOut: {
              where: { rolledBackAt: null },
              select: { amount: true, toInstallment: { select: { installmentNumber: true } } },
            },
            interestApplications: {
              where: { rolledBackAt: null },
              select: { appliedAmount: true },
            },
            rebatesReceived: {
              where: { rolledBackAt: null },
              select: { amount: true },
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

    // The rate actually in force, so the screen never has to guess the shop
    // default. `penaltyPerDayIsDefault` tells it whether the sale set its own.
    const tenant = await prisma.tenant.findUnique({
      where: { id: scheduleCore.tenantId },
      select: { settings: true },
    });
    const penaltyPerDayIsDefault = saleCore.penaltyPerDay === null;
    const effectivePenaltyPerDay = penaltyPerDayIsDefault
      ? mergeInstallmentSettings(tenant?.settings).defaultPenaltyPerDay
      : Number(saleCore.penaltyPerDay);

    return {
      schedule: scheduleCore,
      installments,
      sale: { ...saleCore, effectivePenaltyPerDay, penaltyPerDayIsDefault },
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
            tenantId: await resolveScheduleTenantId(tx, schedule.id),
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
            tenantId: await resolveScheduleTenantId(tx, schedule.id),
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
            tenantId: await resolveScheduleTenantId(tx, schedule.id),
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

          // ── Bug-2 fix: greedy interest waiver is the wrong semantic when
          // paying an "absorbed" row (rem === 0 because R4 already pushed
          // the obligation forward). In that case the user's intent is to
          // reverse the absorption, NOT to early-settle future installments.
          // Force equal-split (no greedy clearing) regardless of the UI
          // flag for absorbed-row payments. Genuine overpayments on rows
          // with rem > 0 continue to honour `waiveExcessInterest`.
          const isAbsorbedRowPayment =
            Number(installment.remainingAmount) === 0 &&
            Number(installment.amountPaid) === 0;
          const effectiveWaiveInterest =
            isAbsorbedRowPayment ? false : data.waiveExcessInterest === true;

          const { distributed, targets } = await distributeOverpayment(tx, {
            scheduleId: schedule.id,
            sourcePrimaryNumber,
            sourceInstallmentId: installmentId,
            excess,
            today,
            actorUserId: userId,
            paymentMode: data.paymentMode,
            notes: data.notes,
            waiveInterest: effectiveWaiveInterest,
            paymentId: paymentRecord?.id,
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
                tenantId: await resolveScheduleTenantId(tx, schedule.id),
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
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const newDateStr = newDate.toISOString().split('T')[0];

        // Record the reschedule date on the source row's notes so it is
        // visible in the installment table and timeline. Preserve any
        // user-provided note by appending it.
        const sourceNote = data.notes
          ? `Rescheduled to ${newDateStr}. ${data.notes}`
          : `Rescheduled to ${newDateStr}.`;
        await tx.installment.update({
          where: { id: installmentId },
          data: { notes: sourceNote },
        });

        // Delegate chain handling to the rule engine. This mirrors the
        // partial_reschedule path with zero payment:
        //   • newDate ≤ next primary's dueDate  → create sub-row #N.(k+1)
        //   • newDate >  next primary's dueDate → redistribute remainder (R3)
        const result = await applyPartialWithPromise(tx, {
          sourceInstallmentId: installmentId,
          newPromiseDate: newDate,
          remainderAfterPayment: Number(installment.remainingAmount),
          actorUserId: userId,
          employeeNote: data.notes,
          today,
        });

        if (result.branch === 'sub_created' && result.newSubId) {
          newInstallment = await tx.installment.findUnique({
            where: { id: result.newSubId },
          });
        }
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
  async searchSchedules(scope: ReadScope, query: string, filterBy: string) {
    const searchTerm = query.trim();
    if (!searchTerm) return [];

    // Build sale filter based on search type
    const baseShopFilter: Prisma.SaleRecordWhereInput = saleScopeFilter(scope);
    const saleFilter: Prisma.SaleRecordWhereInput = { ...baseShopFilter };

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
   * Dedicated reschedule method (Scenario 2 — no payment recorded).
   *
   * Delegates chain handling to the rule engine (applyPartialWithPromise),
   * which creates a sub-row #N.(k+1) when the new date falls on/before the
   * next primary's due date, or redistributes the remainder across future
   * primaries otherwise (R3). The source row's notes are updated to record
   * the reschedule date.
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
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const newDateStr = newDate.toISOString().split('T')[0];

    const result = await prisma.$transaction(async (tx) => {
      // Record the reschedule date on the source row's notes so it is
      // visible in the installment table and timeline. Preserve any
      // user-provided note by appending it.
      const sourceNote = data.notes
        ? `Rescheduled to ${newDateStr}. ${data.notes}`
        : `Rescheduled to ${newDateStr}.`;
      await tx.installment.update({
        where: { id: installmentId },
        data: { notes: sourceNote },
      });

      // Delegate chain handling to the rule engine.
      const ruleResult = await applyPartialWithPromise(tx, {
        sourceInstallmentId: installmentId,
        newPromiseDate: newDate,
        remainderAfterPayment: Number(installment.remainingAmount),
        actorUserId: userId,
        employeeNote: data.notes,
        today,
      });

      await syncScheduleAndSale(tx, installment.schedule.id);

      return ruleResult;
    });

    // If a sub row was created, return it with full details. Otherwise
    // (redistribution branch) there is no single new installment to return.
    if (result.branch === 'sub_created' && result.newSubId) {
      return prisma.installment.findUnique({
        where: { id: result.newSubId },
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
    }

    return null;
  },

  /**
   * Preview an undo-reschedule for an installment that was created by a
   * reschedule (either a sub-row OR a `redistributed` event that absorbed
   * a parent into future primaries). Read-only — used by the UI to decide
   * whether to show the Undo button and what consequence-text to display.
   *
   * Returns one of:
   *   { eligible: true, branch: 'sub_row', restoresInstallmentId, amount, sourceDueDate }
   *   { eligible: true, branch: 'redistribute', restoresPrimaryNumber, targets: [...], promisedDate }
   *   { eligible: false, reason: '...' }
   */
  async previewUndoReschedule(installmentId: string) {
    const inst = await prisma.installment.findUnique({
      where: { id: installmentId },
      select: {
        id: true,
        scheduleId: true,
        installmentNumber: true,
        parentInstallmentNumber: true,
        subSequence: true,
        dueDate: true,
        amountDue: true,
        amountPaid: true,
        remainingAmount: true,
        status: true,
        isRescheduled: true,
        rescheduledFromId: true,
      },
    });
    if (!inst) {
      return { eligible: false as const, reason: 'Installment not found' };
    }

    // Case A — this row is a reschedule-created sub-row.
    if (inst.parentInstallmentNumber != null && inst.rescheduledFromId) {
      if (Number(inst.amountPaid) > 0) {
        return {
          eligible: false as const,
          reason: 'Cannot undo: this rescheduled installment already has a payment recorded on it.',
        };
      }
      if (inst.isRescheduled) {
        return {
          eligible: false as const,
          reason: 'Cannot undo: this installment was itself rescheduled again. Undo the newer reschedule first.',
        };
      }
      const source = await prisma.installment.findUnique({
        where: { id: inst.rescheduledFromId },
        select: { id: true, installmentNumber: true, parentInstallmentNumber: true, subSequence: true, dueDate: true, remainingAmount: true },
      });
      if (!source) {
        return { eligible: false as const, reason: 'Source installment not found.' };
      }
      const subCreatedLog = await prisma.installmentRollLog.findFirst({
        where: {
          scheduleId: inst.scheduleId,
          installmentId: inst.id,
          eventType: 'sub_created',
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, eventDate: true, createdAt: true, actorUserId: true, actor: { select: { fullName: true, username: true } } },
      });
      return {
        eligible: true as const,
        branch: 'sub_row' as const,
        subRowId: inst.id,
        subRowLabel:
          inst.parentInstallmentNumber != null && inst.subSequence != null
            ? `#${inst.parentInstallmentNumber}.${inst.subSequence}`
            : `#${inst.installmentNumber}`,
        amount: Number(inst.amountDue),
        newDueDate: inst.dueDate,
        sourceId: source.id,
        sourceLabel:
          source.parentInstallmentNumber != null && source.subSequence != null
            ? `#${source.parentInstallmentNumber}.${source.subSequence}`
            : `#${source.installmentNumber}`,
        sourceDueDate: source.dueDate,
        rescheduledAt: subCreatedLog?.eventDate ?? null,
        rescheduledBy: subCreatedLog?.actor?.fullName ?? subCreatedLog?.actor?.username ?? null,
      };
    }

    // Case B — caller passed the *primary* row that was redistributed away.
    // Find the latest `redistributed` log on this schedule for this primary
    // whose reason is `promise_after_next` (i.e. user-driven reschedule, not
    // automatic R4 daily rollover).
    const primaryNumber = inst.installmentNumber;
    const redistLog = await prisma.installmentRollLog.findFirst({
      where: {
        scheduleId: inst.scheduleId,
        eventType: 'redistributed',
      },
      orderBy: [{ eventDate: 'desc' }, { createdAt: 'desc' }],
      include: { actor: { select: { fullName: true, username: true } } },
    });
    if (!redistLog || !redistLog.metadata) {
      return { eligible: false as const, reason: 'No reschedule found to undo.' };
    }
    const meta = redistLog.metadata as Prisma.JsonObject;
    if (meta.sourcePrimary !== primaryNumber) {
      return { eligible: false as const, reason: 'Latest redistribute event does not target this installment.' };
    }
    if (meta.reason !== 'promise_after_next') {
      return {
        eligible: false as const,
        reason: 'Cannot undo: this redistribution was performed automatically by the daily rollover, not by a manual reschedule. Use Apply Interest / Move Payment to correct instead.',
      };
    }
    const targets = (meta.targets ?? []) as Array<{ id: string; delta: number; installmentNumber: number }>;
    if (targets.length === 0) {
      return { eligible: false as const, reason: 'Redistribution log has no targets.' };
    }
    const carryover = Number(meta.carryover ?? 0);
    const promisedDate = (meta.promisedDate as string | null) ?? null;
    const cutoff = redistLog.eventDate;

    // Eligibility check: no payments/interest/newer events touching any
    // target since `cutoff`.
    const targetIds = targets.map((t) => t.id);
    const [postPayments, postInterest, postRollLogs] = await Promise.all([
      prisma.installmentPayment.count({
        where: { installmentId: { in: targetIds }, createdAt: { gt: cutoff } },
      }),
      prisma.installmentInterestApplication.count({
        where: { installmentId: { in: targetIds }, createdAt: { gt: cutoff } },
      }),
      prisma.installmentRollLog.count({
        where: {
          scheduleId: inst.scheduleId,
          installmentId: { in: targetIds },
          eventType: { in: ['redistributed', 'sub_created', 'rescheduled', 'interest_applied', 'payment_recorded'] },
          createdAt: { gt: cutoff },
        },
      }),
    ]);
    if (postPayments > 0 || postInterest > 0 || postRollLogs > 0) {
      return {
        eligible: false as const,
        reason: 'Cannot undo: payments, interest, or other reschedules have been recorded on the affected installments since this reschedule. Reverse those actions first.',
      };
    }

    // Per-target preview: each target's new amountDue/remainingAmount after
    // decrementing by its delta. We also sanity-check that none would go
    // below amountPaid (which would mean a payment slipped through despite
    // the count check — should not happen with the gates above).
    const targetRows = await prisma.installment.findMany({
      where: { id: { in: targetIds } },
      select: { id: true, installmentNumber: true, amountDue: true, amountPaid: true, remainingAmount: true },
    });
    const previews = targets.map((t) => {
      const row = targetRows.find((r) => r.id === t.id);
      if (!row) {
        return { id: t.id, installmentNumber: t.installmentNumber, delta: t.delta, eligible: false as const };
      }
      const newAmountDue = Number(row.amountDue) - t.delta;
      const newRemaining = Number(row.remainingAmount) - t.delta;
      const safe = newAmountDue >= Number(row.amountPaid) && newRemaining >= 0;
      return {
        id: t.id,
        installmentNumber: t.installmentNumber,
        currentAmountDue: Number(row.amountDue),
        currentRemaining: Number(row.remainingAmount),
        delta: t.delta,
        newAmountDue,
        newRemaining,
        eligible: safe,
      };
    });
    const allSafe = previews.every((p) => p.eligible);
    if (!allSafe) {
      return {
        eligible: false as const,
        reason: 'Cannot undo: reversing the redistribution would corrupt one or more target installments.',
      };
    }

    return {
      eligible: true as const,
      branch: 'redistribute' as const,
      restoresPrimaryNumber: primaryNumber,
      carryover,
      promisedDate,
      targets: previews,
      redistLogId: redistLog.id,
      rescheduledAt: redistLog.eventDate,
      rescheduledBy: redistLog.actor?.fullName ?? redistLog.actor?.username ?? null,
    };
  },

  /**
   * Undo a reschedule. Two branches mirror previewUndoReschedule:
   *
   *  Case A — sub-row branch (`installmentId` points to the sub-row #N.k):
   *    1. Restore the source row's remainingAmount to the sub-row's amount.
   *    2. Recompute the source row's status from amountPaid + today vs dueDate.
   *    3. Delete the sub-row's payments (none expected — eligibility blocks).
   *    4. Delete the sub-row.
   *    5. Delete the `sub_created` roll-log entry.
   *    6. Strip the "Rescheduled to YYYY-MM-DD." prefix from source.notes.
   *    7. Write a `reschedule_undone` log.
   *
   *  Case B — redistribute branch (`installmentId` points to the source
   *    primary row; eligibility lookup finds a recent `redistributed` log):
   *    1. For each target in the log's metadata, decrement amountDue and
   *       remainingAmount by `delta`. Recompute status (`paid` ↔ `upcoming`).
   *    2. Restore the source primary chain's remainingAmount to `carryover`,
   *       split back to the rows that originally held it (we restore the
   *       FULL carryover onto the primary row itself for simplicity — the
   *       sub-rows we previously zeroed all had remaining=0 at the time of
   *       redistribute, so collapsing the carryover onto the primary is
   *       lossless w.r.t. totals; if the primary itself had been
   *       partially_paid we preserve amountPaid as-is).
   *    3. Delete the `redistributed` roll-log entry.
   *    4. Strip the reschedule note from the source primary.
   *    5. Write a `reschedule_undone` log.
   *
   * After either branch: syncScheduleAndSale + ensureRolledForToday (with
   * lastRolloverDate=null) so the chain is re-evaluated.
   */
  async undoReschedule(
    installmentId: string,
    reason: string,
    userId: string | null,
  ) {
    const preview = await this.previewUndoReschedule(installmentId);
    if (!preview.eligible) {
      throw new Error(preview.reason);
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return prisma.$transaction(async (tx) => {
      if (preview.branch === 'sub_row') {
        const source = await tx.installment.findUnique({
          where: { id: preview.sourceId },
        });
        if (!source) throw new Error('Source installment not found');

        const amountToRestore = preview.amount;
        const newRemaining = Number(source.remainingAmount) + amountToRestore;
        const newAmountPaid = Number(source.amountPaid);
        let newStatus: string;
        if (newAmountPaid >= Number(source.amountDue) + amountToRestore) {
          newStatus = 'paid';
        } else if (newAmountPaid > 0) {
          newStatus = 'partially_paid';
        } else {
          const dueDay = toDateOnly(source.dueDate).getTime();
          const todayDay = toDateOnly(today).getTime();
          newStatus = dueDay < todayDay ? 'overdue' : dueDay === todayDay ? 'due_today' : 'upcoming';
        }

        // Strip the "Rescheduled to YYYY-MM-DD. " prefix we added on
        // reschedule (the standalone reschedule() method writes this).
        const strippedNotes = stripReschedulePrefix(source.notes);

        await tx.installment.update({
          where: { id: source.id },
          data: {
            remainingAmount: newRemaining,
            status: newStatus as any,
            notes: strippedNotes,
          },
        });

        // Delete the sub-row's roll log entries first (FK), then the row.
        await tx.installmentRollLog.deleteMany({
          where: { installmentId: preview.subRowId },
        });
        // Delete any (unexpected) payments on the sub-row — eligibility
        // gate above should mean there are none, but be defensive.
        await tx.installmentPayment.deleteMany({
          where: { installmentId: preview.subRowId },
        });
        await tx.installment.delete({ where: { id: preview.subRowId } });

        // Write the undone log on the SOURCE row.
        await tx.installmentRollLog.create({
          data: {
            tenantId: await resolveScheduleTenantId(tx, source.scheduleId),
            scheduleId: source.scheduleId,
            installmentId: source.id,
            eventType: 'reschedule_undone',
            eventDate: new Date(),
            actorUserId: userId,
            displayMessage:
              `Reschedule of installment ${preview.sourceLabel} to ` +
              `${toDateOnly(preview.newDueDate).toISOString().split('T')[0]} was undone.` +
              (reason ? ` Reason: ${reason}` : ''),
            metadata: {
              branch: 'sub_row',
              deletedSubRowId: preview.subRowId,
              restoredAmount: amountToRestore,
              originalDueDate: toDateOnly(preview.sourceDueDate).toISOString().split('T')[0],
              cancelledNewDueDate: toDateOnly(preview.newDueDate).toISOString().split('T')[0],
              reason,
            } as Prisma.InputJsonValue,
          },
        });

        await syncScheduleAndSale(tx, source.scheduleId, userId ?? undefined);
        await tx.installmentSchedule.update({
          where: { id: source.scheduleId },
          data: { lastRolloverDate: null },
        });
        await ensureRolledForToday(tx, today, { scheduleId: source.scheduleId });

        return { branch: 'sub_row', restoredInstallmentId: source.id, restoredAmount: amountToRestore };
      }

      // Case B — redistribute branch.
      const sourcePrimary = await tx.installment.findUnique({
        where: { id: installmentId },
      });
      if (!sourcePrimary) throw new Error('Source primary installment not found');

      // 1. Reverse the per-target deltas.
      for (const t of preview.targets) {
        const row = await tx.installment.findUnique({ where: { id: t.id } });
        if (!row) continue;
        const newAmountDue = Number(row.amountDue) - t.delta;
        const newRemaining = Number(row.remainingAmount) - t.delta;
        const newAmountPaid = Number(row.amountPaid);
        let newStatus: string;
        if (newAmountPaid >= newAmountDue && newAmountDue > 0) {
          newStatus = 'paid';
        } else if (newAmountPaid > 0) {
          newStatus = 'partially_paid';
        } else {
          const dueDay = toDateOnly(row.dueDate).getTime();
          const todayDay = toDateOnly(today).getTime();
          newStatus = dueDay < todayDay ? 'overdue' : dueDay === todayDay ? 'due_today' : 'upcoming';
        }
        await tx.installment.update({
          where: { id: t.id },
          data: {
            amountDue: newAmountDue,
            remainingAmount: newRemaining,
            status: newStatus as any,
          },
        });
      }

      // 2. Restore the source primary chain. Find every row in the chain
      //    (primary + sub-rows) so we can put the carryover back.
      //    Simplest: dump the full carryover onto the primary row's
      //    remainingAmount (collapsing all sub-row remainders that were
      //    zeroed at redistribute time). Status is recomputed from
      //    amountPaid + today.
      const primaryAmountPaid = Number(sourcePrimary.amountPaid);
      const primaryAmountDue = Number(sourcePrimary.amountDue);
      const restoredPrimaryRemaining = primaryAmountDue - primaryAmountPaid;
      let primaryStatus: string;
      if (primaryAmountPaid >= primaryAmountDue) {
        primaryStatus = 'paid';
      } else if (primaryAmountPaid > 0) {
        primaryStatus = 'partially_paid';
      } else {
        const dueDay = toDateOnly(sourcePrimary.dueDate).getTime();
        const todayDay = toDateOnly(today).getTime();
        primaryStatus = dueDay < todayDay ? 'overdue' : dueDay === todayDay ? 'due_today' : 'upcoming';
      }
      const strippedPrimaryNotes = stripReschedulePrefix(sourcePrimary.notes);
      await tx.installment.update({
        where: { id: sourcePrimary.id },
        data: {
          remainingAmount: restoredPrimaryRemaining,
          status: primaryStatus as any,
          notes: strippedPrimaryNotes,
        },
      });

      // 3. Delete the original `redistributed` log entry.
      await tx.installmentRollLog.delete({ where: { id: preview.redistLogId } });

      // 4. Write the undone log.
      const sourceLabel = `#${sourcePrimary.installmentNumber}`;
      await tx.installmentRollLog.create({
        data: {
          tenantId: await resolveScheduleTenantId(tx, sourcePrimary.scheduleId),
          scheduleId: sourcePrimary.scheduleId,
          installmentId: sourcePrimary.id,
          eventType: 'reschedule_undone',
          eventDate: new Date(),
          actorUserId: userId,
          displayMessage:
            `Reschedule (redistribute) of installment ${sourceLabel} ` +
            `(promised ${preview.promisedDate ?? 'n/a'}) was undone. ` +
            `${preview.targets.length} future installment(s) restored.` +
            (reason ? ` Reason: ${reason}` : ''),
          metadata: {
            branch: 'redistribute',
            sourcePrimary: sourcePrimary.installmentNumber,
            carryoverRestored: preview.carryover,
            cancelledPromisedDate: preview.promisedDate,
            targets: preview.targets.map((t) => ({
              id: t.id,
              installmentNumber: t.installmentNumber,
              delta: t.delta,
            })),
            reason,
          } as Prisma.InputJsonValue,
        },
      });

      await syncScheduleAndSale(tx, sourcePrimary.scheduleId, userId ?? undefined);
      await tx.installmentSchedule.update({
        where: { id: sourcePrimary.scheduleId },
        data: { lastRolloverDate: null },
      });
      await ensureRolledForToday(tx, today, { scheduleId: sourcePrimary.scheduleId });

      return {
        branch: 'redistribute',
        restoredInstallmentId: sourcePrimary.id,
        restoredAmount: preview.carryover,
        targetsAffected: preview.targets.length,
      };
    });
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
    options?: {
      /**
       * Optional discretionary overdue interest the collector wants to add
       * to the row at the same time as reverting (e.g. when reverting an
       * old missed payment that has accrued interest since its due date).
       * Applied INSIDE the same transaction, BEFORE the rollover engine
       * absorbs the row, so the interest carries through to the future
       * installments the chain rolls into.
       */
      applyInterest?: { amount: number; notes?: string };
      /**
       * When true, each consecutive paid primary installment AFTER the
       * reverted one has its payment shifted back one slot.
       * Example: undo #4 → #5's payment moves to #4, #6's payment moves
       * to #5, until a gap (unpaid / non-primary) is encountered.
       * The final installment in the chain becomes unpaid and is absorbed
       * by the rollover engine as usual.
       */
      cascade?: boolean;
    },
  ) {
    const payment = await prisma.installmentPayment.findUnique({
      where: { id: paymentId },
      include: {
        installment: {
          include: {
            schedule: {
              select: {
                id: true,
                status: true,
                sale: { select: { shopId: true, interestRate: true } },
              },
            },
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
      // ── Pre-step: reverse R7 overpayment distribution side-effects ──────
      // When the original recordPayment had excess cash, R7 mutated future
      // installments' amountDue / remainingAmount / amountPaid. Those
      // mutations are *not* undone by simply deleting the payment row —
      // we must explicitly reverse them. We locate the R7 log entry by
      //   (a) preferred:  metadata.paymentId === paymentId, OR
      //   (b) fallback:   most recent `redistributed` log for this row
      //                   with reason='overpayment' AND createdAt close to
      //                   the payment's createdAt (same transaction).
      // Eligibility: if ANY of the target installments has had a payment,
      // interest application, or further redistribute event AFTER the R7
      // log was written, refuse the revert — the user must reverse those
      // newer actions first to avoid silently corrupting totals.
      const r7Log = await tx.installmentRollLog.findFirst({
        where: {
          scheduleId: inst.schedule.id,
          eventType: 'redistributed',
          installmentId: inst.id,
          OR: [
            { metadata: { path: ['paymentId'], equals: paymentId } as any },
            // Fallback for older payments (no paymentId stored in meta) —
            // match by closely-following createdAt and reason='overpayment'.
            {
              AND: [
                { metadata: { path: ['reason'], equals: 'overpayment' } as any },
                { createdAt: { gte: new Date(payment.createdAt.getTime() - 2000) } },
                { createdAt: { lte: new Date(payment.createdAt.getTime() + 10000) } },
              ],
            },
          ],
        },
        orderBy: { createdAt: 'desc' },
      });

      if (r7Log && r7Log.metadata) {
        const meta = r7Log.metadata as Prisma.JsonObject;
        const targets = (meta.targets ?? []) as Array<{
          id: string;
          delta: number;
          installmentNumber: number;
          paidOff?: boolean;
          interestWaived?: number;
          closedEarly?: boolean;
        }>;
        const targetIds = targets.map((t) => t.id);

        if (targetIds.length > 0) {
          // Eligibility gate (same algorithm as undoReschedule Case B).
          const cutoff = r7Log.createdAt;
          const [postPayments, postInterest, postRollLogs] = await Promise.all([
            tx.installmentPayment.count({
              where: {
                installmentId: { in: targetIds },
                createdAt: { gt: cutoff },
              },
            }),
            tx.installmentInterestApplication.count({
              where: {
                installmentId: { in: targetIds },
                createdAt: { gt: cutoff },
              },
            }),
            tx.installmentRollLog.count({
              where: {
                scheduleId: inst.schedule.id,
                installmentId: { in: targetIds },
                eventType: {
                  in: [
                    'redistributed',
                    'sub_created',
                    'rescheduled',
                    'interest_applied',
                    'payment_recorded',
                  ],
                },
                createdAt: { gt: cutoff },
              },
            }),
          ]);
          if (postPayments > 0 || postInterest > 0 || postRollLogs > 0) {
            throw new Error(
              'Cannot revert: payments, interest, or further redistributions have been recorded on the installments that received this overpayment. Reverse those newer actions first.',
            );
          }

          // Reverse each target's R7 mutation. Two shapes to handle:
          //   - greedy/closedEarly: amountDue and rem were decremented by
          //     (delta + interestWaived); amountPaid was incremented by
          //     delta. Reverse exactly.
          //   - equal-split (default): amountDue and rem decremented by
          //     delta; amountPaid untouched. Reverse the same.
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          for (const t of targets) {
            const row = await tx.installment.findUnique({ where: { id: t.id } });
            if (!row) continue;
            const delta = Number(t.delta);
            const interestWaived = Number(t.interestWaived ?? 0);
            const wasGreedy = !!t.closedEarly;
            const addToDue = delta + interestWaived;
            const restoredAmountDue = Number(row.amountDue) + addToDue;
            const restoredAmountPaid = wasGreedy
              ? Math.max(0, Number(row.amountPaid) - delta)
              : Number(row.amountPaid);
            // Re-derive rem from the invariant rem = due - paid to be
            // safe against any drift in the live row state.
            const restoredRem = Math.max(0, restoredAmountDue - restoredAmountPaid);
            let newStatus: string;
            if (restoredAmountPaid >= restoredAmountDue && restoredAmountDue > 0) {
              newStatus = 'paid';
            } else if (restoredAmountPaid > 0) {
              newStatus = 'partially_paid';
            } else {
              const dueDay = new Date(
                Date.UTC(
                  row.dueDate.getUTCFullYear(),
                  row.dueDate.getUTCMonth(),
                  row.dueDate.getUTCDate(),
                ),
              ).getTime();
              const todayDay = today.getTime();
              newStatus = dueDay < todayDay
                ? 'overdue'
                : dueDay === todayDay
                  ? 'due_today'
                  : 'upcoming';
            }
            await tx.installment.update({
              where: { id: row.id },
              data: {
                amountDue: restoredAmountDue,
                amountPaid: restoredAmountPaid,
                remainingAmount: restoredRem,
                status: newStatus as any,
              },
            });
          }

          // Delete the R7 log entry — its side-effects are undone.
          await tx.installmentRollLog.delete({ where: { id: r7Log.id } });
        }
      }

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
          tenantId: await resolveScheduleTenantId(tx, inst.schedule.id),
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

      // Optionally apply discretionary overdue interest BEFORE the chain
      // engine absorbs the now-overdue row. This is convenient when
      // reverting an old payment whose installment has been overdue for
      // weeks/months — the collector can attach the late-fee in one step.
      if (options?.applyInterest && options.applyInterest.amount > 0) {
        const monthlyRate = Number(inst.schedule.sale.interestRate ?? 0);
        const due = inst.dueDate;
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
            tenantId: await resolveScheduleTenantId(tx, inst.schedule.id),
            installmentId: inst.id,
            scheduleId: inst.schedule.id,
            daysOverdue,
            dailyRate,
            baseAmount: newRemaining,
            appliedAmount: options.applyInterest.amount,
            appliedBy: userId,
            notes: options.applyInterest.notes ?? null,
          },
        });
        await tx.installment.update({
          where: { id: inst.id },
          data: {
            amountDue: { increment: options.applyInterest.amount },
            remainingAmount: { increment: options.applyInterest.amount },
          },
        });
        await tx.installmentRollLog.create({
          data: {
            tenantId: await resolveScheduleTenantId(tx, inst.schedule.id),
            scheduleId: inst.schedule.id,
            installmentId: inst.id,
            eventType: 'interest_applied',
            eventDate: new Date(),
            actorUserId: userId,
            displayMessage:
              `Overdue interest of ₹${options.applyInterest.amount.toLocaleString('en-IN')} applied to installment ${instLabel} (${daysOverdue} days overdue) along with revert.` +
              (options.applyInterest.notes ? ` Note: ${options.applyInterest.notes}` : ''),
            metadata: {
              applicationId: app.id,
              amount: options.applyInterest.amount,
              daysOverdue,
              dailyRate,
              baseAmount: newRemaining,
              appliedAlongsideRevert: true,
            } as Prisma.InputJsonValue,
          },
        });
        await tx.auditLog.create({
          data: {
            userId,
            shopId: inst.schedule.sale.shopId,
            entityType: 'installment',
            entityId: inst.id,
            action: 'interest_applied',
            oldValues: { remainingAmount: newRemaining } as any,
            newValues: {
              applicationId: app.id,
              appliedAmount: options.applyInterest.amount,
              daysOverdue,
              appliedAlongsideRevert: true,
            } as any,
          },
        });
      }

      // ── Cascade: shift subsequent consecutive paid primaries back one ────
      // Walk N+1, N+2, … while each is a paid primary with at least one
      // payment record. Move the last payment of N+k to N+k-1 and mark
      // N+k-1 paid (N+k will be left unpaid and absorbed by rollover).
      const cascadedInstallments: Array<{ from: number; to: number; amount: number; paymentDate: Date }> = [];

      if (options?.cascade && inst.installmentNumber != null) {
        let prevInstallment = await tx.installment.findUnique({ where: { id: inst.id } });
        let currentNumber = inst.installmentNumber + 1;

        while (true) {
          const nextInst = await tx.installment.findFirst({
            where: {
              scheduleId: inst.schedule.id,
              installmentNumber: currentNumber,
              parentInstallmentNumber: null,
              isRescheduled: false,
              isClosed: false,
              status: 'paid',
            },
            include: {
              payments: {
                orderBy: { paymentDate: 'desc' },
                take: 1,
              },
            },
          });

          if (!nextInst || !nextInst.payments.length || !prevInstallment) break;

          const shiftPayment = nextInst.payments[0];
          const shiftAmount = Number(shiftPayment.amount);

          // Re-link the payment to the previous installment
          await tx.installmentPayment.update({
            where: { id: shiftPayment.id },
            data: { installmentId: prevInstallment.id },
          });

          // Mark the previous installment as paid
          await tx.installment.update({
            where: { id: prevInstallment.id },
            data: {
              amountPaid: shiftAmount,
              remainingAmount: Math.max(0, Number(prevInstallment.amountDue) - shiftAmount),
              status: 'paid',
            },
          });

          const prevLabel = prevInstallment.parentInstallmentNumber != null && prevInstallment.subSequence != null
            ? `#${prevInstallment.parentInstallmentNumber}.${prevInstallment.subSequence}`
            : `#${prevInstallment.installmentNumber}`;
          const nextLabel = `#${nextInst.installmentNumber}`;

          await tx.installmentRollLog.create({
            data: {
              tenantId: await resolveScheduleTenantId(tx, inst.schedule.id),
              scheduleId: inst.schedule.id,
              installmentId: prevInstallment.id,
              eventType: 'payment_moved',
              eventDate: new Date(),
              actorUserId: userId,
              displayMessage: `Payment of ₹${shiftAmount.toLocaleString('en-IN')} shifted from installment ${nextLabel} to ${prevLabel} (cascade revert).`,
              metadata: { fromInstallmentId: nextInst.id, toInstallmentId: prevInstallment.id, amount: shiftAmount, cascade: true } as Prisma.InputJsonValue,
            },
          });

          cascadedInstallments.push({ from: currentNumber, to: currentNumber - 1, amount: shiftAmount, paymentDate: shiftPayment.paymentDate });

          // Now mark nextInst as unpaid — it will be absorbed by rollover below
          const nextDueDate = new Date(nextInst.dueDate);
          const todayCheck = new Date();
          todayCheck.setHours(0, 0, 0, 0);
          const nextStatus = nextDueDate < todayCheck ? 'overdue' : 'upcoming';

          await tx.installment.update({
            where: { id: nextInst.id },
            data: {
              amountPaid: 0,
              remainingAmount: Number(nextInst.amountDue),
              status: nextStatus,
            },
          });

          prevInstallment = await tx.installment.findUnique({ where: { id: nextInst.id } });
          currentNumber += 1;
        }
      }

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

      return { installmentId: inst.id, amountReverted: amountToRevert, cascadedInstallments };
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
          tenantId: await resolveScheduleTenantId(tx, scheduleId),
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
        sale: { select: { id: true, interestRate: true, penaltyPerDay: true } },
        tenant: { select: { settings: true } },
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
                chargedThrough: true,
                notes: true,
              },
            },
          },
          orderBy: [{ installmentNumber: 'asc' }, { subSequence: 'asc' }],
        },
      },
    });
    if (!schedule) return null;

    // Flat ₹/day per SALE while any EMI is late — the sale's own rate, else the shop default.
    // (Previously this used the loan's monthly interest rate, which is not a
    // penalty rate at all.)
    const settings = mergeInstallmentSettings(schedule.tenant.settings);
    const perDay =
      schedule.sale.penaltyPerDay !== null && schedule.sale.penaltyPerDay !== undefined
        ? Number(schedule.sale.penaltyPerDay)
        : settings.defaultPenaltyPerDay;
    const today = new Date();

    // Penalty is per SALE: one clock for the whole schedule, starting at the
    // oldest EMI still owing and resuming after the last day already charged.
    let chargedThrough: Date | null = null;
    for (const inst of schedule.installments) {
      for (const app of inst.interestApplications) {
        const covered = app.chargedThrough ?? app.appliedAt;
        if (!chargedThrough || covered > chargedThrough) chargedThrough = covered;
      }
    }
    const oldestUnpaid = schedule.installments
      .filter((i) => Number(i.remainingAmount) > 0 && i.parentInstallmentNumber === null)
      .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0];
    const salePenalty = computeLatePenalty({
      perDay,
      oldestUnpaidDueDate: oldestUnpaid?.dueDate ?? null,
      asOf: today,
      chargedThrough,
    });

    return schedule.installments.map((inst) => {
      const appliedActive = inst.interestApplications.reduce(
        (s, a) => s + Number(a.appliedAmount),
        0,
      );
      // The sale-level figure is reported once, on the oldest unpaid row, so
      // anything that adds rows up can't count it several times.
      const carriesSalePenalty = oldestUnpaid?.id === inst.id;
      return {
        installmentId: inst.id,
        installmentNumber: inst.installmentNumber,
        parentInstallmentNumber: inst.parentInstallmentNumber,
        subSequence: inst.subSequence,
        dueDate: inst.dueDate,
        remainingAmount: Number(inst.remainingAmount),
        status: inst.status,
        daysOverdue: computeDaysOverdue(inst.dueDate, today),
        penaltyPerDay: perDay,
        uncharged: carriesSalePenalty
          ? { days: salePenalty.days, amount: salePenalty.amount }
          : { days: 0, amount: 0 },
        suggestedInterest: carriesSalePenalty ? salePenalty.amount : 0,
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
          tenantId: await resolveScheduleTenantId(tx, inst.schedule.id),
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
          tenantId: await resolveScheduleTenantId(tx, inst.schedule.id),
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
          tenantId: await resolveScheduleTenantId(tx, app.schedule.id),
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

  /**
   * Move a mis-recorded payment from one installment to the correct one.
   *
   * This is an atomic operation that:
   *   1. Removes the payment from the source installment (restoring its balance).
   *   2. Optionally applies overdue interest on the target installment.
   *   3. Records the same payment on the target installment.
   *   4. Runs the rollover engine so the newly-unpaid source row gets
   *      redistributed correctly if its due date has passed.
   *
   * Typical usage: employee recorded payment X against installment #3 but
   * it was actually the customer paying installment #2 late. Admin calls
   * this with paymentId=<#3's payment>, targetInstallmentId=<#2's id>,
   * paymentDate=<original payment date>.
   */
  async movePayment(
    paymentId: string,
    targetInstallmentId: string,
    reason: string,
    userId: string,
    options?: {
      /** Override payment date (YYYY-MM-DD). Defaults to the original payment date. */
      paymentDate?: string;
      /** Optional overdue interest to apply on the target installment before posting the payment. */
      applyInterestOnTarget?: { amount: number; notes?: string };
    },
  ) {
    const payment = await prisma.installmentPayment.findUnique({
      where: { id: paymentId },
      include: {
        installment: {
          include: {
            schedule: {
              select: {
                id: true,
                status: true,
                sale: { select: { shopId: true, interestRate: true } },
              },
            },
          },
        },
      },
    });

    if (!payment) throw new Error('Payment not found');

    const sourceInst = payment.installment;
    const scheduleId = sourceInst.schedule.id;
    const amountToMove = Number(payment.amount);

    if (sourceInst.id === targetInstallmentId) {
      throw new Error('Source and target installment must be different');
    }

    const targetInst = await prisma.installment.findUnique({
      where: { id: targetInstallmentId },
      include: {
        schedule: {
          select: {
            id: true,
            sale: { select: { shopId: true, interestRate: true } },
          },
        },
      },
    });

    if (!targetInst) throw new Error('Target installment not found');
    if (targetInst.schedule.id !== scheduleId) {
      throw new Error('Target installment belongs to a different schedule');
    }
    if (targetInst.status === 'paid') {
      throw new Error('Target installment is already fully paid');
    }
    if (targetInst.isRescheduled && targetInst.status === 'rescheduled') {
      throw new Error('Target installment has been rescheduled');
    }

    const sourceLabel =
      sourceInst.parentInstallmentNumber != null && sourceInst.subSequence != null
        ? `#${sourceInst.parentInstallmentNumber}.${sourceInst.subSequence}`
        : `#${sourceInst.installmentNumber}`;
    const targetLabel =
      targetInst.parentInstallmentNumber != null && (targetInst as any).subSequence != null
        ? `#${targetInst.parentInstallmentNumber}.${(targetInst as any).subSequence}`
        : `#${targetInst.installmentNumber}`;

    const result = await prisma.$transaction(async (tx) => {
      // ── Step A: Remove payment from source, restore its balance ─────────
      await tx.installmentPayment.delete({ where: { id: paymentId } });

      const newSourcePaid = Math.max(0, Number(sourceInst.amountPaid) - amountToMove);
      const newSourceRemaining = Number(sourceInst.amountDue) - newSourcePaid;
      const newSourceStatus =
        newSourcePaid <= 0
          ? new Date(sourceInst.dueDate) < new Date()
            ? 'overdue'
            : 'upcoming'
          : 'partially_paid';

      await tx.installment.update({
        where: { id: sourceInst.id },
        data: {
          amountPaid: newSourcePaid,
          remainingAmount: newSourceRemaining,
          status: newSourceStatus,
        },
      });

      await tx.installmentRollLog.create({
        data: {
          tenantId: await resolveScheduleTenantId(tx, scheduleId),
          scheduleId,
          installmentId: sourceInst.id,
          eventType: 'payment_moved',
          eventDate: new Date(),
          actorUserId: userId,
          displayMessage: `Payment of ₹${amountToMove.toLocaleString('en-IN')} moved from installment ${sourceLabel} → ${targetLabel}. Reason: ${reason}`,
          metadata: {
            paymentId,
            amount: amountToMove,
            sourceInstallmentId: sourceInst.id,
            targetInstallmentId,
            reason,
          } as Prisma.InputJsonValue,
        },
      });

      // ── Step B: Optional overdue interest on target ──────────────────────
      let targetRemainingWithInterest = Number(targetInst.remainingAmount);

      if (options?.applyInterestOnTarget && options.applyInterestOnTarget.amount > 0) {
        const monthlyRate = Number(targetInst.schedule.sale.interestRate ?? 0);
        const due = targetInst.dueDate;
        const today = new Date();
        const dueDay = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
        const todayDay = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
        const daysOverdue = Math.max(0, Math.floor((todayDay - dueDay) / (1000 * 60 * 60 * 24)));
        const dailyRate = monthlyRate / 100 / 30;

        const app = await tx.installmentInterestApplication.create({
          data: {
            tenantId: await resolveScheduleTenantId(tx, scheduleId),
            installmentId: targetInst.id,
            scheduleId,
            daysOverdue,
            dailyRate,
            baseAmount: targetRemainingWithInterest,
            appliedAmount: options.applyInterestOnTarget.amount,
            appliedBy: userId,
            notes: options.applyInterestOnTarget.notes ?? null,
          },
        });

        await tx.installment.update({
          where: { id: targetInst.id },
          data: {
            amountDue: { increment: options.applyInterestOnTarget.amount },
            remainingAmount: { increment: options.applyInterestOnTarget.amount },
          },
        });
        targetRemainingWithInterest += options.applyInterestOnTarget.amount;

        await tx.installmentRollLog.create({
          data: {
            tenantId: await resolveScheduleTenantId(tx, scheduleId),
            scheduleId,
            installmentId: targetInst.id,
            eventType: 'interest_applied',
            eventDate: new Date(),
            actorUserId: userId,
            displayMessage:
              `Overdue interest of ₹${options.applyInterestOnTarget.amount.toLocaleString('en-IN')} applied to installment ${targetLabel} (${daysOverdue} days overdue) as part of payment correction.` +
              (options.applyInterestOnTarget.notes
                ? ` Note: ${options.applyInterestOnTarget.notes}`
                : ''),
            metadata: {
              applicationId: app.id,
              amount: options.applyInterestOnTarget.amount,
              daysOverdue,
              dailyRate,
              baseAmount: Number(targetInst.remainingAmount),
              appliedAlongsideMove: true,
            } as Prisma.InputJsonValue,
          },
        });
      }

      // ── Step C: Record payment on target ─────────────────────────────────
      const paidOnDate = options?.paymentDate
        ? new Date(options.paymentDate)
        : new Date(payment.paymentDate);

      const newTargetPaid = Number(targetInst.amountPaid) + amountToMove;
      const newTargetRemaining = Math.max(0, targetRemainingWithInterest - amountToMove);
      const newTargetStatus = newTargetRemaining <= 0 ? 'paid' : 'partially_paid';

      await tx.installment.update({
        where: { id: targetInst.id },
        data: {
          amountPaid: newTargetPaid,
          remainingAmount: newTargetRemaining,
          status: newTargetStatus,
        },
      });

      await tx.installmentPayment.create({
        data: {
          installmentId: targetInst.id,
          amount: amountToMove,
          paymentMode: payment.paymentMode,
          paymentDate: paidOnDate,
          referenceNumber: payment.referenceNumber,
          notes: payment.notes,
          collectedBy: userId,
        },
      });

      await tx.installmentRollLog.create({
        data: {
          tenantId: await resolveScheduleTenantId(tx, scheduleId),
          scheduleId,
          installmentId: targetInst.id,
          eventType: 'payment_moved',
          eventDate: new Date(),
          actorUserId: userId,
          displayMessage: `Payment of ₹${amountToMove.toLocaleString('en-IN')} received from correction of mis-recorded ${sourceLabel} and applied to ${targetLabel}. Paid on: ${paidOnDate.toISOString().split('T')[0]}.`,
          metadata: {
            paymentId,
            amount: amountToMove,
            sourceInstallmentId: sourceInst.id,
            targetInstallmentId,
            paymentDate: paidOnDate.toISOString(),
            reason,
          } as Prisma.InputJsonValue,
        },
      });

      // ── Step D: Distribute any excess over the target's due amount ────────
      const excess = amountToMove - targetRemainingWithInterest;
      if (excess > 0) {
        await distributeOverpayment(tx, targetInst.id, scheduleId, excess, userId, false);
      }

      // ── Step E: Re-run rollover so the newly-unpaid source row is absorbed
      //           correctly if its due date has passed ─────────────────────
      await tx.installmentSchedule.update({
        where: { id: scheduleId },
        data: { lastRolloverDate: null },
      });
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      await ensureRolledForToday(tx, today, { scheduleId });

      // ── Step F: Re-sync schedule totals ──────────────────────────────────
      await syncScheduleAndSale(tx, scheduleId);

      return {
        sourceInstallmentId: sourceInst.id,
        targetInstallmentId,
        amountMoved: amountToMove,
      };
    });

    return result;
  },

  /**
   * Correct a payment that was recorded with the wrong (higher) amount.
   *
   * Example: employee recorded ₹5,000 but customer actually paid ₹3,000.
   * The ₹2,000 shortfall is spread equally across upcoming installments.
   * If no upcoming installments remain, a new installment is created due today.
   *
   * Optional discretionary interest on the shortfall (from installment's due
   * date to today) may be applied and included in the distributed amount.
   */
  async correctPayment(
    paymentId: string,
    correctAmount: number,
    reason: string,
    userId: string,
    options?: {
      applyInterest?: { amount: number; notes?: string };
    },
  ) {
    const r2 = (n: number) => Math.round(n * 100) / 100;

    const payment = await prisma.installmentPayment.findUnique({
      where: { id: paymentId },
      include: {
        installment: {
          include: {
            schedule: {
              select: {
                id: true,
                sale: { select: { shopId: true, interestRate: true } },
              },
            },
          },
        },
      },
    });

    if (!payment) throw new Error('Payment not found');

    const inst = payment.installment;
    const scheduleId = inst.schedule.id;
    const originalAmount = r2(Number(payment.amount));

    if (correctAmount >= originalAmount) {
      throw new Error(
        'Correct amount must be less than the recorded amount. To add more payment, use the regular Pay flow.',
      );
    }

    const shortfall = r2(originalAmount - correctAmount);

    const instLabel =
      inst.parentInstallmentNumber != null && inst.subSequence != null
        ? `#${inst.parentInstallmentNumber}.${inst.subSequence}`
        : `#${inst.installmentNumber}`;

    const result = await prisma.$transaction(async (tx) => {
      // ── Step A: Optional interest on the shortfall ───────────────────────
      // Interest accrues from the installment's original due date to today
      // (since the missing money has been owed since then). This is logged
      // as a separate interest_applied event and included in the distributed
      // amount so upcoming installments absorb both the principal shortfall
      // and the penalty in one go.
      let totalToDistribute = shortfall;

      if (options?.applyInterest && options.applyInterest.amount > 0) {
        totalToDistribute = r2(totalToDistribute + options.applyInterest.amount);

        const monthlyRate = Number(inst.schedule.sale.interestRate ?? 0);
        const due = inst.dueDate;
        const today = new Date();
        const dueDay = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
        const todayDay = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
        const daysOverdue = Math.max(0, Math.floor((todayDay - dueDay) / (1000 * 60 * 60 * 24)));
        const dailyRate = monthlyRate / 100 / 30;

        const app = await tx.installmentInterestApplication.create({
          data: {
            installmentId: inst.id,
            scheduleId,
            daysOverdue,
            dailyRate,
            baseAmount: shortfall,
            appliedAmount: options.applyInterest.amount,
            appliedBy: userId,
            notes: options.applyInterest.notes ?? null,
          },
        });

        await tx.installmentRollLog.create({
          data: {
            tenantId: await resolveScheduleTenantId(tx, scheduleId),
            scheduleId,
            installmentId: inst.id,
            eventType: 'interest_applied',
            eventDate: new Date(),
            actorUserId: userId,
            displayMessage:
              `Interest of ₹${options.applyInterest.amount.toLocaleString('en-IN')} applied on shortfall of ` +
              `₹${shortfall.toLocaleString('en-IN')} for installment ${instLabel} (${daysOverdue} days from due date). ` +
              `Distributed to upcoming installments.` +
              (options.applyInterest.notes ? ` Note: ${options.applyInterest.notes}` : ''),
            metadata: {
              applicationId: app.id,
              amount: options.applyInterest.amount,
              daysOverdue,
              dailyRate,
              baseAmount: shortfall,
              appliedAlongsideCorrection: true,
            } as Prisma.InputJsonValue,
          },
        });
      }

      // ── Step B: Correct the payment record ───────────────────────────────
      await tx.installmentPayment.update({
        where: { id: paymentId },
        data: { amount: correctAmount },
      });

      // ── Step C & D: Update source installment + distribute if needed ──────
      // Two distinct cases:
      //   Partial  (correctAmount < amountDue): the shortfall stays on THIS
      //     installment (status = partially_paid). Any interest on the shortfall
      //     is added to amountDue here, not distributed forward.
      //   Full/over (correctAmount >= amountDue): installment is still fully
      //     settled; distribute totalToDistribute to future rows as before.
      const amountDue = r2(Number(inst.amountDue));
      const isPartialCorrection = correctAmount < amountDue;

      let distributionMessage = '';
      let affectedCount = 0;

      if (isPartialCorrection) {
        // Interest on the shortfall (if applied) bumps THIS installment's
        // amountDue — not future rows.
        const interestOnShortfall = r2(options?.applyInterest?.amount ?? 0);
        const newAmountDue = r2(amountDue + interestOnShortfall);
        const newRemainingAmount = r2(newAmountDue - correctAmount);

        await tx.installment.update({
          where: { id: inst.id },
          data: {
            amountPaid: correctAmount,
            amountDue: newAmountDue,
            remainingAmount: newRemainingAmount,
            status: 'partially_paid',
          },
        });

        distributionMessage = `Shortfall of ₹${newRemainingAmount.toLocaleString('en-IN')} remains on installment ${instLabel}.`;
        affectedCount = 0;
      } else {
        // Fully paid — distribute totalToDistribute to future rows.
        await tx.installment.update({
          where: { id: inst.id },
          data: {
            amountPaid: correctAmount,
            remainingAmount: 0,
            status: 'paid',
          },
        });

        // ── Step D: Distribute totalToDistribute to upcoming installments ───
        // Includes overdue rows with remaining balance (not yet absorbed/paid).
        const upcomingRows = await tx.installment.findMany({
          where: {
            scheduleId,
            id: { not: inst.id },
            status: { in: ['upcoming', 'due_today', 'overdue'] },
            remainingAmount: { gt: 0 },
            isRescheduled: false,
            isClosed: false,
          },
          orderBy: { installmentNumber: 'asc' },
        });

        if (upcomingRows.length === 0) {
          // No upcoming installments — create a new one due today
          const maxResult = await tx.installment.aggregate({
            where: { scheduleId },
            _max: { installmentNumber: true },
          });
          const maxNum = maxResult._max.installmentNumber ?? 0;
          const dueToday = new Date();
          dueToday.setHours(0, 0, 0, 0);

          await tx.installment.create({
            data: {
              scheduleId,
              installmentNumber: maxNum + 1,
              dueDate: dueToday,
              amountDue: totalToDistribute,
              amountPaid: 0,
              remainingAmount: totalToDistribute,
              status: 'due_today',
              notes: `Created due to payment correction on installment ${instLabel}. Shortfall: ₹${shortfall.toLocaleString('en-IN')}`,
            },
          });

          distributionMessage = `Shortfall of ₹${totalToDistribute.toLocaleString('en-IN')} placed in a new installment #${maxNum + 1} (due today).`;
          affectedCount = 0;
        } else {
          // Equal split across upcoming installments (last row absorbs rounding)
          const n = upcomingRows.length;
          const perRow = r2(totalToDistribute / n);
          let distributed = 0;

          for (let i = 0; i < n; i++) {
            const row = upcomingRows[i];
            const delta = i === n - 1 ? r2(totalToDistribute - distributed) : perRow;
            distributed = r2(distributed + delta);

            await tx.installment.update({
              where: { id: row.id },
              data: {
                amountDue: { increment: delta },
                remainingAmount: { increment: delta },
              },
            });

            const rowLabel =
              row.parentInstallmentNumber != null && row.subSequence != null
                ? `#${row.parentInstallmentNumber}.${row.subSequence}`
                : `#${row.installmentNumber}`;

            const newAmountDue = r2(Number(row.amountDue) + delta);

            await tx.installmentRollLog.create({
              data: {
                tenantId: await resolveScheduleTenantId(tx, scheduleId),
                scheduleId,
                installmentId: row.id,
                eventType: 'payment_corrected',
                eventDate: new Date(),
                actorUserId: userId,
                displayMessage: `Installment ${rowLabel} amount due updated: ₹${Number(row.amountDue).toLocaleString('en-IN')} → ₹${newAmountDue.toLocaleString('en-IN')} (+₹${delta.toLocaleString('en-IN')} shortfall from correction on installment ${instLabel}).`,
                metadata: {
                  sourceInstallmentId: inst.id,
                  delta,
                  totalShortfall: shortfall,
                  totalToDistribute,
                  reason,
                } as Prisma.InputJsonValue,
              },
            });
          }

          distributionMessage = `Shortfall of ₹${totalToDistribute.toLocaleString('en-IN')} split across ${n} upcoming installments (+₹${perRow.toLocaleString('en-IN')} each).`;
          affectedCount = n;
        }
      }

      // ── Step E: Log the correction on the source installment ─────────────
      await tx.installmentRollLog.create({
        data: {
          tenantId: await resolveScheduleTenantId(tx, scheduleId),
          scheduleId,
          installmentId: inst.id,
          eventType: 'payment_corrected',
          eventDate: new Date(),
          actorUserId: userId,
          displayMessage:
            `Payment on installment ${instLabel} corrected from ₹${originalAmount.toLocaleString('en-IN')} ` +
            `to ₹${correctAmount.toLocaleString('en-IN')}. Shortfall: ₹${shortfall.toLocaleString('en-IN')}. ` +
            `${distributionMessage} Reason: ${reason}`,
          metadata: {
            paymentId,
            originalAmount,
            correctAmount,
            shortfall,
            totalToDistribute,
            affectedInstallments: affectedCount,
            reason,
          } as Prisma.InputJsonValue,
        },
      });

      await tx.auditLog.create({
        data: {
          userId,
          shopId: inst.schedule.sale.shopId,
          entityType: 'installment',
          entityId: inst.id,
          action: 'payment_corrected',
          oldValues: { amountPaid: originalAmount } as any,
          newValues: { amountPaid: correctAmount, shortfall, totalToDistribute } as any,
        },
      });

      // ── Step F: Sync schedule totals ─────────────────────────────────────
      await syncScheduleAndSale(tx, scheduleId);

      return {
        installmentId: inst.id,
        originalAmount,
        correctAmount,
        shortfall,
        totalDistributed: totalToDistribute,
        affectedInstallments: affectedCount,
      };
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
      customerZone: customer?.zone ?? null,
      productName: product?.modelNumber ?? '',
      productBrand: product?.brand ?? '',
      saleId: sale?.id ?? '',
      saleNumber: sale?.saleNumber ?? '',
      ledgerNumber: sale?.ledgerNumber ?? '',
      shop: sale?.shop ?? null,
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
      customerZone: customer?.zone ?? null,
      productName: product?.modelNumber ?? '',
      productBrand: product?.brand ?? '',
      saleId: sale?.id ?? '',
      saleNumber: sale?.saleNumber ?? '',
      ledgerNumber: sale?.ledgerNumber ?? '',
      shop: sale?.shop ?? null,
    };
  });
}
