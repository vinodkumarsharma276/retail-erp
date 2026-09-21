import { InstallmentPromiseStatus, Prisma } from '@prisma/client';
import { prisma } from '../../config/database.js';

const D = (value: Prisma.Decimal | number | string) => new Prisma.Decimal(value);

type Tx = Prisma.TransactionClient;

export interface PromiseContext {
  tenantId: string;
  actorUserId: string;
}

export interface CreatePromiseInput {
  scheduleId: string;
  customerId: string;
  coveredInstallmentIds: string[];
  promisedDate: string;
  promisedAmount: number;
  notes?: string;
}

/** UTC midnight for a YYYY-MM-DD string — how `@db.Date` columns are stored. */
function dateOnly(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

/** Today's date (UTC midnight) so it compares cleanly with `@db.Date` values. */
function todayDateOnly(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * A promise is a note: "customer will pay ₹X on date Y for these EMIs". It
 * never moves an EMI or changes what is owed. EMIs keep their own due dates;
 * the promise only decides when the collector is next reminded to call.
 */
export const promisesService = {
  /**
   * Create a promise inside an existing transaction — used by the payment
   * flow so a part payment and its promise are saved together or not at all.
   *
   * A new promise on EMIs that already have a pending one REPLACES it (the
   * customer gave a new date: 1.1 → 1.2). The old one is kept as history
   * with status `replaced`, which is not counted as a broken promise.
   */
  async createInTx(tx: Tx, input: CreatePromiseInput, ctx: PromiseContext) {
    const promisedDate = dateOnly(input.promisedDate);
    if (promisedDate < todayDateOnly()) throw new Error('Promise date cannot be in the past');
    if (!(input.promisedAmount > 0)) throw new Error('Promised amount must be more than zero');
    if (input.coveredInstallmentIds.length === 0) throw new Error('Pick at least one EMI for the promise');

    const schedule = await tx.installmentSchedule.findFirst({
      where: { id: input.scheduleId, tenantId: ctx.tenantId, sale: { customerId: input.customerId } },
      select: { id: true },
    });
    if (!schedule) throw new Error('Installment schedule not found');

    const installments = await tx.installment.findMany({
      where: {
        tenantId: ctx.tenantId,
        scheduleId: input.scheduleId,
        id: { in: input.coveredInstallmentIds },
      },
      select: { id: true, installmentNumber: true, remainingAmount: true },
    });
    if (installments.length !== input.coveredInstallmentIds.length) {
      throw new Error('One or more covered installments were not found');
    }
    if (installments.some((installment) => D(installment.remainingAmount).lte(0))) {
      throw new Error('Promises can only cover unpaid installments');
    }
    const outstanding = installments.reduce((sum, i) => sum.plus(i.remainingAmount), D(0));
    if (D(input.promisedAmount).gt(outstanding.plus(0.5))) {
      throw new Error(
        `Promised amount is more than is owed on those EMIs (${outstanding.toFixed(2)}).`,
      );
    }

    // Any promise still pending on these EMIs is superseded by this one.
    const superseded = await tx.installmentPromise.findMany({
      where: {
        tenantId: ctx.tenantId,
        scheduleId: input.scheduleId,
        status: InstallmentPromiseStatus.pending,
        coveredInstallmentIds: { hasSome: input.coveredInstallmentIds },
      },
      select: { id: true, promisedDate: true, notes: true },
    });
    for (const old of superseded) {
      await tx.installmentPromise.update({
        where: { id: old.id },
        data: {
          status: InstallmentPromiseStatus.replaced,
          resolvedAt: new Date(),
          notes: [old.notes, `Replaced by a promise for ${input.promisedDate}`].filter(Boolean).join('\n'),
        },
      });
    }

    const promise = await tx.installmentPromise.create({
      data: {
        tenantId: ctx.tenantId,
        scheduleId: input.scheduleId,
        customerId: input.customerId,
        coveredInstallmentIds: input.coveredInstallmentIds,
        promisedDate,
        promisedAmount: input.promisedAmount,
        createdBy: ctx.actorUserId,
        notes: input.notes ?? null,
      },
    });

    const numbers = installments
      .map((i) => i.installmentNumber)
      .sort((a, b) => a - b)
      .map((n) => `#${n}`)
      .join(', ');
    await tx.installmentRollLog.create({
      data: {
        tenantId: ctx.tenantId,
        scheduleId: input.scheduleId,
        eventType: 'promise_created',
        eventDate: todayDateOnly(),
        displayMessage:
          `Promise of ₹${Number(input.promisedAmount).toLocaleString('en-IN')} for ${input.promisedDate} ` +
          `on EMI ${numbers}.` +
          (superseded.length > 0 ? ` Replaces the earlier promise.` : ''),
        metadata: {
          promiseId: promise.id,
          coveredInstallmentIds: input.coveredInstallmentIds,
          promisedAmount: input.promisedAmount,
          promisedDate: input.promisedDate,
          replacedPromiseIds: superseded.map((s) => s.id),
        },
        actorUserId: ctx.actorUserId,
      },
    });

    return promise;
  },

  async create(input: CreatePromiseInput, ctx: PromiseContext) {
    return prisma.$transaction((tx) => promisesService.createInTx(tx, input, ctx));
  },

  /**
   * List promises with register-style labels. The k-th promise that covers
   * EMI N reads "N.k". Cancelled promises (a shop mistake) take no number.
   */
  async list(
    query: { scheduleId?: string; customerId?: string; status?: InstallmentPromiseStatus },
    tenantId: string,
  ) {
    const rows = await prisma.installmentPromise.findMany({
      where: {
        tenantId,
        scheduleId: query.scheduleId,
        customerId: query.customerId,
      },
      include: {
        createdByUser: { select: { id: true, username: true, fullName: true } },
        customer: { select: { id: true, name: true, customerCode: true, phone: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const labels = await promisesService.labelPromises(rows, tenantId);
    const withLabels = rows.map((row) => ({ ...row, labels: labels.get(row.id) ?? {} }));

    // Numbering needs every promise in date order; the status filter is
    // applied afterwards so labels stay stable whichever view asks.
    const filtered = query.status ? withLabels.filter((p) => p.status === query.status) : withLabels;
    return filtered.sort(
      (a, b) => a.promisedDate.getTime() - b.promisedDate.getTime() || b.createdAt.getTime() - a.createdAt.getTime(),
    );
  },

  /** Build `promiseId → { installmentId → "N.k" }` for the given promises. */
  async labelPromises(
    promises: Array<{ id: string; status: InstallmentPromiseStatus; createdAt: Date; coveredInstallmentIds: string[] }>,
    tenantId: string,
  ) {
    const installmentIds = [...new Set(promises.flatMap((p) => p.coveredInstallmentIds))];
    const numbers = new Map(
      (
        await prisma.installment.findMany({
          where: { tenantId, id: { in: installmentIds } },
          select: { id: true, installmentNumber: true },
        })
      ).map((i) => [i.id, i.installmentNumber]),
    );

    const counters = new Map<string, number>();
    const result = new Map<string, Record<string, string>>();
    const ordered = [...promises].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    for (const promise of ordered) {
      if (promise.status === InstallmentPromiseStatus.cancelled) continue;
      const perInstallment: Record<string, string> = {};
      for (const installmentId of promise.coveredInstallmentIds) {
        const k = (counters.get(installmentId) ?? 0) + 1;
        counters.set(installmentId, k);
        const n = numbers.get(installmentId);
        if (n !== undefined) perInstallment[installmentId] = `${n}.${k}`;
      }
      result.set(promise.id, perInstallment);
    }
    return result;
  },

  /**
   * Withdraw a promise recorded by mistake. It is marked `cancelled` — not
   * `broken` — so a typo never counts against the customer.
   */
  async cancel(id: string, reason: string | undefined, ctx: PromiseContext) {
    const promise = await prisma.installmentPromise.findFirst({
      where: { id, tenantId: ctx.tenantId },
    });
    if (!promise) throw new Error('Promise not found');
    if (promise.status !== InstallmentPromiseStatus.pending) {
      throw new Error('Only pending promises can be cancelled');
    }

    return prisma.$transaction(async (tx) => {
      const updated = await tx.installmentPromise.update({
        where: { id },
        data: {
          status: InstallmentPromiseStatus.cancelled,
          resolvedAt: new Date(),
          notes: reason ? [promise.notes, `Cancelled: ${reason}`].filter(Boolean).join('\n') : promise.notes,
        },
      });
      await tx.installmentRollLog.create({
        data: {
          tenantId: ctx.tenantId,
          scheduleId: promise.scheduleId,
          eventType: 'promise_cancelled',
          eventDate: todayDateOnly(),
          displayMessage: reason ? `Promise cancelled: ${reason}` : 'Promise cancelled.',
          metadata: { promiseId: promise.id, reason },
          actorUserId: ctx.actorUserId,
        },
      });
      return updated;
    });
  },
};
