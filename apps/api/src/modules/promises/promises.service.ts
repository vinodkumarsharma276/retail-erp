import { InstallmentPromiseStatus, Prisma } from '@prisma/client';
import { prisma } from '../../config/database.js';

const D = (value: Prisma.Decimal | number | string) => new Prisma.Decimal(value);

export interface PromiseContext {
  tenantId: string;
  actorUserId: string;
}

export const promisesService = {
  async create(
    input: {
      scheduleId: string;
      customerId: string;
      coveredInstallmentIds: string[];
      promisedDate: string;
      promisedAmount: number;
      notes?: string;
    },
    ctx: PromiseContext,
  ) {
    const promisedDate = new Date(input.promisedDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (promisedDate < today) throw new Error('Promise date cannot be in the past');

    return prisma.$transaction(async (tx) => {
      const schedule = await tx.installmentSchedule.findFirst({
        where: { id: input.scheduleId, tenantId: ctx.tenantId, sale: { customerId: input.customerId } },
        select: { id: true, tenantId: true, saleId: true, sale: { select: { customerId: true } } },
      });
      if (!schedule) throw new Error('Installment schedule not found');

      const installments = await tx.installment.findMany({
        where: {
          tenantId: ctx.tenantId,
          scheduleId: input.scheduleId,
          id: { in: input.coveredInstallmentIds },
        },
        select: { id: true, remainingAmount: true },
      });
      if (installments.length !== input.coveredInstallmentIds.length) {
        throw new Error('One or more covered installments were not found');
      }
      if (installments.some((installment) => D(installment.remainingAmount).lte(0))) {
        throw new Error('Promises can only cover unpaid installments');
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

      await tx.installmentRollLog.create({
        data: {
          tenantId: ctx.tenantId,
          scheduleId: input.scheduleId,
          eventType: 'promise_created',
          eventDate: today,
          displayMessage: `Promise of ₹${Number(input.promisedAmount).toLocaleString('en-IN')} for ${input.promisedDate} created for ${input.coveredInstallmentIds.length} EMI(s).`,
          metadata: {
            promiseId: promise.id,
            coveredInstallmentIds: input.coveredInstallmentIds,
            promisedAmount: input.promisedAmount,
            promisedDate: input.promisedDate,
          },
          actorUserId: ctx.actorUserId,
        },
      });

      return promise;
    });
  },

  async list(
    query: { scheduleId?: string; customerId?: string; status?: InstallmentPromiseStatus },
    tenantId: string,
  ) {
    return prisma.installmentPromise.findMany({
      where: {
        tenantId,
        scheduleId: query.scheduleId,
        customerId: query.customerId,
        status: query.status,
      },
      include: {
        createdByUser: { select: { id: true, username: true, fullName: true } },
        customer: { select: { id: true, name: true, customerCode: true, phone: true } },
      },
      orderBy: [{ promisedDate: 'asc' }, { createdAt: 'desc' }],
    });
  },

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
          status: InstallmentPromiseStatus.broken,
          resolvedAt: new Date(),
          notes: reason ? [promise.notes, `Cancelled: ${reason}`].filter(Boolean).join('\n') : promise.notes,
        },
      });
      await tx.installmentRollLog.create({
        data: {
          tenantId: ctx.tenantId,
          scheduleId: promise.scheduleId,
          eventType: 'promise_broken',
          eventDate: new Date(),
          displayMessage: 'Promise cancelled and marked broken.',
          metadata: { promiseId: promise.id, reason },
          actorUserId: ctx.actorUserId,
        },
      });
      return updated;
    });
  },
};
