import { InstallmentStatus, type PaymentMode, Prisma, type PrismaClient } from '@prisma/client';
import { computeEarlyPaymentDeduction, computeLatePenalty } from '@retailerp/shared-utils';
import type { PaymentPreview } from '@retailerp/shared-types';
import { promisesService } from '../promises/promises.service.js';
import { allocatePayment } from './installments.allocator.js';
import {
  computeDaysOverdue,
  computeInstallmentStatus,
  mergeInstallmentSettings,
  toDateOnly,
} from './installments.derivations.js';

const D = (value: Prisma.Decimal | number | string) => new Prisma.Decimal(value);

type Tx = Prisma.TransactionClient;

type Client = PrismaClient | Tx;

export interface InstallmentEngineContext {
  tenantId: string;
  actorUserId: string;
}

export interface EngineRecordPaymentInput {
  scheduleId?: string;
  installmentId?: string;
  amount: number;
  paymentMode: PaymentMode;
  paymentDate?: Date;
  collectedBy?: string;
  referenceNumber?: string | null;
  notes?: string | null;
  explicitInstallmentId?: string;
  /**
   * Legacy: charge a penalty of a caller-supplied amount. Kept for older
   * clients. New clients send `applyPenalty` and let the server work it out.
   */
  applyInterest?: {
    installmentId: string;
    appliedAmount: number;
    daysOverdue?: number;
    notes?: string | null;
  };
  /** Collector ticked "apply late penalty". Amount comes from the sale's ₹/day rate. */
  applyPenalty?: boolean;
  /** Collector ticked "deduct early-payment interest from the last installment". */
  applyEarlyPaymentDeduction?: boolean;
  /**
   * "Will pay the rest on <date>". Covers the listed EMIs, or by default every
   * EMI still owing that was due by the payment date. Amount defaults to what
   * is left on them after this payment.
   */
  promise?: {
    promisedDate: string;
    promisedAmount?: number;
    coveredInstallmentIds?: string[];
    notes?: string | null;
  };
}

// ---------------------------------------------------------------------------
// Shared context for the two discretionary adjustments
// ---------------------------------------------------------------------------

async function loadAdjustmentContext(client: Client, installmentId: string, tenantId: string) {
  const installment = await client.installment.findFirst({
    where: { id: installmentId, tenantId },
    include: {
      schedule: {
        select: {
          id: true,
          totalInterest: true,
          numInstallments: true,
          sale: { select: { penaltyPerDay: true } },
          tenant: { select: { settings: true } },
          // Penalty is per SALE, so the history that matters is the whole
          // schedule's, not just this EMI's.
          interestApplications: {
            where: { rolledBackAt: null },
            select: { appliedAmount: true, appliedAt: true, chargedThrough: true },
          },
          // The oldest EMI that still has money owing starts the clock.
          installments: {
            where: { parentInstallmentNumber: null, isClosed: false, remainingAmount: { gt: 0 } },
            orderBy: [{ dueDate: 'asc' }, { installmentNumber: 'asc' }],
            take: 1,
            select: { dueDate: true },
          },
        },
      },
    },
  });
  if (!installment) throw new Error('Installment not found');

  const settings = mergeInstallmentSettings(installment.schedule.tenant.settings);
  const salePerDay = installment.schedule.sale.penaltyPerDay;
  const perDay = salePerDay !== null && salePerDay !== undefined
    ? Number(salePerDay)
    : settings.defaultPenaltyPerDay;

  // The last day an earlier penalty on this sale already covered. Legacy
  // charges predate `chargedThrough`, so their applied date stands in for it.
  let chargedThrough: Date | null = null;
  for (const app of installment.schedule.interestApplications) {
    const covered = app.chargedThrough ?? toDateOnly(app.appliedAt);
    if (!chargedThrough || covered > chargedThrough) chargedThrough = covered;
  }
  const alreadyCharged = installment.schedule.interestApplications.reduce(
    (sum, app) => sum.plus(app.appliedAmount),
    D(0),
  );
  const oldestUnpaidDueDate = installment.schedule.installments[0]?.dueDate ?? null;

  return { installment, settings, perDay, chargedThrough, alreadyCharged, oldestUnpaidDueDate };
}

/**
 * Plan which installments an early-payment deduction reduces: the LAST unpaid
 * one first, spilling to the one before only if the last can't absorb it all.
 * Never takes an installment below zero.
 */
async function planDeductionTargets(
  client: Client,
  scheduleId: string,
  tenantId: string,
  amount: Prisma.Decimal,
) {
  const candidates = await client.installment.findMany({
    where: {
      scheduleId,
      tenantId,
      parentInstallmentNumber: null,
      isClosed: false,
      remainingAmount: { gt: 0 },
    },
    orderBy: { installmentNumber: 'desc' },
    select: { id: true, installmentNumber: true, remainingAmount: true },
  });

  const plan: Array<{ installmentId: string; installmentNumber: number; amount: Prisma.Decimal }> = [];
  let left = amount;
  for (const candidate of candidates) {
    if (left.lte(0)) break;
    const take = Prisma.Decimal.min(left, D(candidate.remainingAmount));
    if (take.gt(0)) {
      plan.push({ installmentId: candidate.id, installmentNumber: candidate.installmentNumber, amount: take });
      left = left.minus(take);
    }
  }
  return plan;
}

/** Why the early-payment deduction isn't on offer, or null if it is. */
async function earlyDeductionBlocker(
  client: Client,
  ctx: Awaited<ReturnType<typeof loadAdjustmentContext>>,
  paymentDate: Date,
  tenantId: string,
): Promise<{ reason: string | null; daysEarly: number; amount: Prisma.Decimal }> {
  const { installment, settings } = ctx;
  const result = computeEarlyPaymentDeduction({
    dueDate: installment.dueDate,
    paymentDate,
    minDaysEarly: settings.earlyPaymentMinDays,
    totalInterest: Number(installment.schedule.totalInterest),
    numInstallments: installment.schedule.numInstallments,
  });
  const amount = D(result.amount);

  if (D(installment.remainingAmount).lte(0)) {
    return { reason: 'This EMI is already paid.', daysEarly: result.daysEarly, amount };
  }
  if (result.amount <= 0) {
    return { reason: 'This sale has no interest to deduct.', daysEarly: result.daysEarly, amount };
  }
  if (ctx.oldestUnpaidDueDate && ctx.oldestUnpaidDueDate < installment.dueDate) {
    return { reason: 'Older EMIs are still unpaid.', daysEarly: result.daysEarly, amount };
  }
  if (!result.eligible) {
    return {
      reason: `Offered only when paid at least ${settings.earlyPaymentMinDays} days before the due date.`,
      daysEarly: result.daysEarly,
      amount,
    };
  }
  const existing = await client.installmentRebate.findFirst({
    where: { tenantId, sourceInstallmentId: installment.id, rolledBackAt: null },
    select: { id: true },
  });
  if (existing) {
    return { reason: 'A deduction has already been given for this EMI.', daysEarly: result.daysEarly, amount };
  }
  return { reason: null, daysEarly: result.daysEarly, amount };
}

/**
 * What the collector should see before recording a payment on one EMI:
 * the late penalty they MAY charge and the early-payment deduction they MAY
 * give. Pure read — nothing is applied here.
 */
export async function buildPaymentPreview(
  prisma: PrismaClient,
  installmentId: string,
  input: { paymentDate?: Date; targetInstallmentId?: string },
  ctx: { tenantId: string },
): Promise<PaymentPreview> {
  const asOf = toDateOnly(input.paymentDate ?? new Date());
  const opened = await prisma.installment.findFirst({
    where: { id: installmentId, tenantId: ctx.tenantId },
    select: { scheduleId: true },
  });
  if (!opened) throw new Error('Installment not found');

  // Every EMI still owing, oldest first — the order money is applied in.
  const owing = await prisma.installment.findMany({
    where: {
      tenantId: ctx.tenantId,
      scheduleId: opened.scheduleId,
      parentInstallmentNumber: null,
      isClosed: false,
      remainingAmount: { gt: 0 },
    },
    orderBy: [{ dueDate: 'asc' }, { installmentNumber: 'asc' }],
    select: { id: true, installmentNumber: true, dueDate: true, remainingAmount: true },
  });
  if (input.targetInstallmentId && !owing.some((row) => row.id === input.targetInstallmentId)) {
    throw new Error('That EMI has nothing left to pay');
  }

  // The preview is about the EMI that receives money first.
  const firstTargetId = input.targetInstallmentId ?? owing[0]?.id ?? installmentId;
  const adj = await loadAdjustmentContext(prisma, firstTargetId, ctx.tenantId);
  const { installment } = adj;
  const remaining = Number(installment.remainingAmount);

  const penalty = computeLatePenalty({
    perDay: adj.perDay,
    oldestUnpaidDueDate: adj.oldestUnpaidDueDate,
    asOf,
    chargedThrough: adj.chargedThrough,
  });
  const overdueSince =
    adj.oldestUnpaidDueDate && toDateOnly(adj.oldestUnpaidDueDate) < asOf
      ? adj.oldestUnpaidDueDate.toISOString().slice(0, 10)
      : null;

  const early = await earlyDeductionBlocker(prisma, adj, asOf, ctx.tenantId);
  const targets = early.reason
    ? []
    : await planDeductionTargets(prisma, installment.schedule.id, ctx.tenantId, early.amount);

  return {
    installmentId: installment.id,
    installmentNumber: installment.installmentNumber,
    dueDate: installment.dueDate.toISOString().slice(0, 10),
    asOf: asOf.toISOString().slice(0, 10),
    remainingAmount: remaining,
    outstanding: owing.map((row) => ({
      installmentId: row.id,
      installmentNumber: row.installmentNumber,
      dueDate: row.dueDate.toISOString().slice(0, 10),
      remainingAmount: Number(row.remainingAmount),
    })),
    penalty: {
      perDay: penalty.perDay,
      overdueSince,
      days: penalty.days,
      amount: penalty.amount,
      applicable: penalty.amount > 0,
      alreadyCharged: adj.alreadyCharged.toNumber(),
    },
    earlyPayment: {
      applicable: early.reason === null && targets.length > 0,
      daysEarly: early.daysEarly,
      minDaysEarly: adj.settings.earlyPaymentMinDays,
      amount: targets.reduce((sum, t) => sum.plus(t.amount), D(0)).toNumber() || early.amount.toNumber(),
      targetInstallmentNumbers: targets.map((t) => t.installmentNumber),
      reason: early.reason ?? undefined,
    },
  };
}

export async function recordPayment(
  prisma: PrismaClient,
  input: EngineRecordPaymentInput,
  ctx: InstallmentEngineContext,
) {
  if (input.amount <= 0) throw new Error('Amount must be positive');
  const paymentDate = input.paymentDate ?? new Date();

  return prisma.$transaction(async (tx) => {
    const targetScheduleId = input.scheduleId ?? await resolveScheduleIdForInstallment(tx, input.installmentId, ctx.tenantId);
    const schedule = await tx.installmentSchedule.findFirst({
      where: { id: targetScheduleId, tenantId: ctx.tenantId },
      include: {
        sale: { select: { id: true, tenantId: true, shopId: true, saleNumber: true, customerId: true } },
        installments: {
          where: { parentInstallmentNumber: null, isClosed: false },
          orderBy: [{ dueDate: 'asc' }, { installmentNumber: 'asc' }],
        },
      },
    });
    if (!schedule) throw new Error('Installment schedule not found');

    // A specific EMI is used only when the collector deliberately chooses one.
    // The route's `:installmentId` just says which account was opened.
    if (
      input.explicitInstallmentId &&
      !schedule.installments.some((installment) => installment.id === input.explicitInstallmentId)
    ) {
      throw new Error('Installment does not belong to this schedule');
    }

    if (input.applyInterest) {
      await applyInterestInTx(tx, input.applyInterest.installmentId, {
        amount: input.applyInterest.appliedAmount,
        daysOverdue: input.applyInterest.daysOverdue,
        notes: input.applyInterest.notes ?? null,
      }, ctx);

      const target = schedule.installments.find((installment) => installment.id === input.applyInterest!.installmentId);
      if (target) {
        const amount = D(input.applyInterest.appliedAmount);
        target.amountDue = D(target.amountDue).plus(amount);
        target.remainingAmount = D(target.remainingAmount).plus(amount);
      }
    }

    const paymentDay = toDateOnly(paymentDate);

    // Where the money goes first: the chosen EMI, else the oldest one owing.
    // Penalty is added to it and an early-payment deduction is judged on it.
    const firstTargetId =
      input.explicitInstallmentId ??
      schedule.installments.find((installment) => D(installment.remainingAmount).gt(0))?.id;
    const sourceInstallmentId = firstTargetId;

    // --- Late penalty (opt-in) ---------------------------------------------
    // Per SALE: the sale's ₹/day for each day it has had an overdue EMI and
    // not yet been charged — never per late EMI, never taken from the client.
    // It is added to the EMI that receives money first, so it is collected in
    // this same entry.
    if (input.applyPenalty && firstTargetId) {
      const adj = await loadAdjustmentContext(tx, firstTargetId, ctx.tenantId);
      if (adj.installment.scheduleId !== schedule.id) {
        throw new Error('Installment does not belong to this schedule');
      }
      const penalty = computeLatePenalty({
        perDay: adj.perDay,
        oldestUnpaidDueDate: adj.oldestUnpaidDueDate,
        asOf: paymentDay,
        chargedThrough: adj.chargedThrough,
      });
      if (penalty.amount > 0) {
        await applyInterestInTx(tx, firstTargetId, {
          amount: penalty.amount,
          daysOverdue: penalty.days,
          chargedThrough: paymentDay,
          perDay: penalty.perDay,
          notes: `Late penalty ₹${penalty.perDay}/day × ${penalty.days} day${penalty.days === 1 ? '' : 's'}`,
        }, ctx);
        const target = schedule.installments.find((installment) => installment.id === firstTargetId);
        if (target) {
          target.amountDue = D(target.amountDue).plus(penalty.amount);
          target.remainingAmount = D(target.remainingAmount).plus(penalty.amount);
        }
      }
    }

    // --- Early-payment deduction (opt-in) ----------------------------------
    // Reduce the LAST installment(s) before allocating, so that when the EMI
    // being paid IS the last one, the collector collects the reduced amount.
    let deductionPlan: Awaited<ReturnType<typeof planDeductionTargets>> = [];
    let deductionDaysEarly = 0;
    if (input.applyEarlyPaymentDeduction) {
      if (!sourceInstallmentId) throw new Error('Pick the EMI being paid early');
      const adj = await loadAdjustmentContext(tx, sourceInstallmentId, ctx.tenantId);
      if (adj.installment.scheduleId !== schedule.id) {
        throw new Error('Installment does not belong to this schedule');
      }
      const early = await earlyDeductionBlocker(tx, adj, paymentDay, ctx.tenantId);
      if (early.reason) throw new Error(`Early-payment deduction not available: ${early.reason}`);

      deductionPlan = await planDeductionTargets(tx, schedule.id, ctx.tenantId, early.amount);
      deductionDaysEarly = early.daysEarly;

      for (const step of deductionPlan) {
        const target = schedule.installments.find((installment) => installment.id === step.installmentId);
        if (!target) throw new Error('Deduction target not found in this schedule');
        const amountDue = D(target.amountDue).minus(step.amount);
        const remainingAmount = D(target.remainingAmount).minus(step.amount);
        const status = computeInstallmentStatus({ ...target, remainingAmount }, paymentDate);
        await tx.installment.update({
          where: { id: target.id },
          data: { amountDue, remainingAmount, status },
        });
        target.amountDue = amountDue;
        target.remainingAmount = remainingAmount;
        target.status = status;
      }
    }

    const activeInstallments = schedule.installments.filter((installment) => D(installment.remainingAmount).gt(0));
    if (activeInstallments.length === 0) throw new Error('Schedule is already fully paid');

    const allocation = allocatePayment(input.amount, activeInstallments, input.explicitInstallmentId);
    const paymentIds: string[] = [];

    for (const line of allocation.lines) {
      const installment = activeInstallments.find((item) => item.id === line.installmentId);
      if (!installment) throw new Error('Target installment not found in this schedule');

      const payment = await tx.installmentPayment.create({
        data: {
          tenantId: ctx.tenantId,
          installmentId: line.installmentId,
          amount: line.amount,
          paymentMode: input.paymentMode,
          paymentDate,
          collectedBy: input.collectedBy ?? ctx.actorUserId,
          referenceNumber: input.referenceNumber ?? null,
          notes: input.notes ?? null,
        },
      });
      paymentIds.push(payment.id);

      const amountPaid = D(installment.amountPaid).plus(line.amount);
      const remainingAmount = D(installment.remainingAmount).minus(line.amount);
      const status = computeInstallmentStatus({ ...installment, amountPaid, remainingAmount }, paymentDate);

      await tx.installment.update({
        where: { id: installment.id },
        data: { amountPaid, remainingAmount, status },
      });

      installment.amountPaid = amountPaid;
      installment.remainingAmount = remainingAmount;
      installment.status = status;

      await tx.installmentRollLog.create({
        data: {
          tenantId: ctx.tenantId,
          scheduleId: schedule.id,
          installmentId: installment.id,
          eventType: 'payment_recorded',
          eventDate: paymentDate,
          displayMessage: `Payment of ₹${line.amount.toFixed(2)} recorded for EMI #${installment.installmentNumber}.`,
          metadata: { paymentId: payment.id, amount: line.amount.toString() },
          actorUserId: ctx.actorUserId,
        },
      });
    }

    // A deduction is earned by paying the EMI in full, early. If this payment
    // left a balance on it, undo everything by failing the transaction.
    if (deductionPlan.length > 0) {
      const source = schedule.installments.find((installment) => installment.id === sourceInstallmentId);
      if (!source || D(source.remainingAmount).gt(0)) {
        throw new Error(
          'The early-payment deduction needs this EMI paid in full. Collect the full amount or untick the deduction.',
        );
      }
      for (const step of deductionPlan) {
        const rebate = await tx.installmentRebate.create({
          data: {
            tenantId: ctx.tenantId,
            scheduleId: schedule.id,
            installmentId: step.installmentId,
            sourceInstallmentId: sourceInstallmentId!,
            paymentIds,
            amount: step.amount,
            daysEarly: deductionDaysEarly,
            appliedBy: ctx.actorUserId,
            notes: `EMI paid ${deductionDaysEarly} days early`,
          },
        });
        await tx.installmentRollLog.create({
          data: {
            tenantId: ctx.tenantId,
            scheduleId: schedule.id,
            installmentId: step.installmentId,
            eventType: 'early_payment_deduction',
            eventDate: paymentDay,
            displayMessage: `Early-payment deduction of ₹${step.amount.toFixed(2)} taken off EMI #${step.installmentNumber}.`,
            metadata: {
              rebateId: rebate.id,
              sourceInstallmentId,
              amount: step.amount.toString(),
              daysEarly: deductionDaysEarly,
            },
            actorUserId: ctx.actorUserId,
          },
        });
      }
    }

    if (allocation.unallocated.gt(0)) {
      await tx.installmentSchedule.update({
        where: { id: schedule.id },
        data: { creditBalance: { increment: allocation.unallocated } },
      });
      await tx.installmentRollLog.create({
        data: {
          tenantId: ctx.tenantId,
          scheduleId: schedule.id,
          eventType: 'credit_added',
          eventDate: paymentDate,
          displayMessage: `Credit balance increased by ₹${allocation.unallocated.toFixed(2)}.`,
          metadata: { amount: allocation.unallocated.toString() },
          actorUserId: ctx.actorUserId,
        },
      });
    }

    const remainingAfterPayment = schedule.installments.reduce(
      (sum, installment) => sum.plus(installment.remainingAmount),
      D(0),
    );
    if (remainingAfterPayment.lte(0)) {
      await tx.installmentSchedule.update({ where: { id: schedule.id }, data: { status: 'completed' } });
    }

    // A part payment with "the rest on <date>": the promise is saved in the
    // same transaction, so either both are recorded or neither is.
    let promise = null;
    if (input.promise) {
      const coveredIds = input.promise.coveredInstallmentIds?.length
        ? input.promise.coveredInstallmentIds
        : schedule.installments
          .filter((installment) => D(installment.remainingAmount).gt(0) && installment.dueDate <= paymentDay)
          .map((installment) => installment.id);
      const covered = schedule.installments.filter(
        (installment) => coveredIds.includes(installment.id) && D(installment.remainingAmount).gt(0),
      );
      if (covered.length === 0) throw new Error('Nothing left owing for the promise to cover');
      const owed = covered.reduce((sum, installment) => sum.plus(installment.remainingAmount), D(0));
      promise = await promisesService.createInTx(tx, {
        scheduleId: schedule.id,
        customerId: schedule.sale.customerId,
        coveredInstallmentIds: covered.map((installment) => installment.id),
        promisedDate: input.promise.promisedDate,
        promisedAmount: input.promise.promisedAmount ?? owed.toNumber(),
        notes: input.promise.notes ?? undefined,
      }, ctx);
    }

    return { paymentIds, creditAdded: allocation.unallocated.toNumber(), promise };
  });
}

export async function revertPayment(
  prisma: PrismaClient,
  paymentId: string,
  reason: string,
  ctx: InstallmentEngineContext,
) {
  return prisma.$transaction(async (tx) => {
    const payment = await tx.installmentPayment.findFirst({
      where: { id: paymentId, tenantId: ctx.tenantId },
      include: { installment: true },
    });
    if (!payment) throw new Error('Payment not found');

    const installment = payment.installment;
    const amountPaid = D(installment.amountPaid).minus(payment.amount);
    const remainingAmount = D(installment.remainingAmount).plus(payment.amount);
    const status = computeInstallmentStatus({ ...installment, amountPaid, remainingAmount }, new Date());

    await tx.installmentPayment.delete({ where: { id: payment.id } });
    await tx.installment.update({
      where: { id: installment.id },
      data: { amountPaid, remainingAmount, status },
    });

    // If this payment earned an early-payment deduction, the EMI is no longer
    // paid early — put the deducted amount back on the installment it came off.
    // Read after the update above, since the target may be this same EMI.
    const rebates = await tx.installmentRebate.findMany({
      where: { tenantId: ctx.tenantId, rolledBackAt: null, paymentIds: { has: payment.id } },
      include: { installment: true },
    });
    for (const rebate of rebates) {
      const target = rebate.installment;
      const restoredDue = D(target.amountDue).plus(rebate.amount);
      const restoredRemaining = D(target.remainingAmount).plus(rebate.amount);
      await tx.installment.update({
        where: { id: target.id },
        data: {
          amountDue: restoredDue,
          remainingAmount: restoredRemaining,
          status: computeInstallmentStatus({ ...target, remainingAmount: restoredRemaining }, new Date()),
        },
      });
      await tx.installmentRebate.update({
        where: { id: rebate.id },
        data: { rolledBackAt: new Date(), rolledBackBy: ctx.actorUserId, rollbackReason: `Payment reverted: ${reason}` },
      });
      await tx.installmentRollLog.create({
        data: {
          tenantId: ctx.tenantId,
          scheduleId: rebate.scheduleId,
          installmentId: target.id,
          eventType: 'early_payment_deduction_reversed',
          eventDate: new Date(),
          displayMessage: `Early-payment deduction of ₹${D(rebate.amount).toFixed(2)} put back on EMI #${target.installmentNumber} because its payment was reverted.`,
          metadata: { rebateId: rebate.id, paymentId: payment.id, amount: rebate.amount.toString() },
          actorUserId: ctx.actorUserId,
        },
      });
    }
    await tx.installmentSchedule.update({
      where: { id: installment.scheduleId },
      data: { status: 'active' },
    });
    await tx.installmentRollLog.create({
      data: {
        tenantId: ctx.tenantId,
        scheduleId: installment.scheduleId,
        installmentId: installment.id,
        eventType: 'payment_reverted',
        eventDate: new Date(),
        displayMessage: `Payment of ₹${payment.amount.toFixed(2)} reverted from EMI #${installment.installmentNumber}.`,
        metadata: { paymentId: payment.id, amount: payment.amount.toString(), reason },
        actorUserId: ctx.actorUserId,
      },
    });

    return { revertedPaymentId: payment.id };
  });
}

export async function applyInterest(
  prisma: PrismaClient,
  installmentId: string,
  input: { amount: number; daysOverdue?: number; notes?: string | null },
  ctx: InstallmentEngineContext,
) {
  return prisma.$transaction((tx) => applyInterestInTx(tx, installmentId, input, ctx));
}

async function applyInterestInTx(
  tx: Tx,
  installmentId: string,
  input: {
    amount: number;
    daysOverdue?: number;
    notes?: string | null;
    /** Last day this charge covers; the next charge starts the day after. */
    chargedThrough?: Date;
    /** Flat ₹/day rate used, when the charge came from the flat penalty rule. */
    perDay?: number;
  },
  ctx: InstallmentEngineContext,
) {
  if (input.amount <= 0) throw new Error('Amount must be positive');

  const installment = await tx.installment.findFirst({
    where: { id: installmentId, tenantId: ctx.tenantId },
    include: { schedule: { select: { id: true } } },
  });
  if (!installment) throw new Error('Installment not found');
  if (installment.status === InstallmentStatus.paid) throw new Error('Cannot apply interest to a fully-paid installment');

  const amount = D(input.amount).toDecimalPlaces(2);
  const daysOverdue = input.daysOverdue ?? computeDaysOverdue(installment.dueDate);
  if (daysOverdue <= 0) throw new Error('Installment is not overdue');

  const application = await tx.installmentInterestApplication.create({
    data: {
      tenantId: ctx.tenantId,
      installmentId: installment.id,
      scheduleId: installment.scheduleId,
      daysOverdue,
      // Legacy percentage column. Flat ₹/day charges record their rate in
      // `perDay` instead and leave this at 0.
      dailyRate: input.perDay !== undefined ? D(0) : D(0.01).div(30).toDecimalPlaces(6),
      perDay: input.perDay !== undefined ? D(input.perDay) : null,
      chargedThrough: toDateOnly(input.chargedThrough ?? new Date()),
      baseAmount: installment.remainingAmount,
      appliedAmount: amount,
      appliedBy: ctx.actorUserId,
      notes: input.notes ?? null,
    },
  });

  await tx.installment.update({
    where: { id: installment.id },
    data: {
      amountDue: { increment: amount },
      remainingAmount: { increment: amount },
      status: computeInstallmentStatus({ ...installment, remainingAmount: D(installment.remainingAmount).plus(amount) }),
    },
  });
  await tx.installmentRollLog.create({
    data: {
      tenantId: ctx.tenantId,
      scheduleId: installment.scheduleId,
      installmentId: installment.id,
      eventType: 'interest_applied',
      eventDate: new Date(),
      displayMessage: `Overdue interest of ₹${amount.toFixed(2)} applied to EMI #${installment.installmentNumber}.`,
      metadata: { applicationId: application.id, amount: amount.toString(), daysOverdue },
      actorUserId: ctx.actorUserId,
    },
  });

  return application;
}

export async function rollbackInterest(
  prisma: PrismaClient,
  applicationId: string,
  reason: string,
  ctx: InstallmentEngineContext,
) {
  return prisma.$transaction(async (tx) => {
    const application = await tx.installmentInterestApplication.findFirst({
      where: { id: applicationId, tenantId: ctx.tenantId },
      include: { installment: true },
    });
    if (!application) throw new Error('Interest application not found');
    if (application.rolledBackAt) throw new Error('Interest application is already rolled back');

    const installment = application.installment;
    const amountDue = D(installment.amountDue).minus(application.appliedAmount);
    if (D(installment.amountPaid).gt(amountDue)) {
      throw new Error('Cannot rollback interest below the amount already paid');
    }

    const remainingAmount = D(installment.remainingAmount).minus(application.appliedAmount);
    const status = computeInstallmentStatus({ ...installment, remainingAmount });

    await tx.installmentInterestApplication.update({
      where: { id: application.id },
      data: { rolledBackAt: new Date(), rolledBackBy: ctx.actorUserId, rollbackReason: reason },
    });
    await tx.installment.update({
      where: { id: installment.id },
      data: { amountDue, remainingAmount, status },
    });
    await tx.installmentRollLog.create({
      data: {
        tenantId: ctx.tenantId,
        scheduleId: installment.scheduleId,
        installmentId: installment.id,
        eventType: 'interest_rollback',
        eventDate: new Date(),
        displayMessage: `Overdue interest of ₹${application.appliedAmount.toFixed(2)} rolled back from EMI #${installment.installmentNumber}.`,
        metadata: { applicationId: application.id, amount: application.appliedAmount.toString(), reason },
        actorUserId: ctx.actorUserId,
      },
    });

    return { rolledBackApplicationId: application.id };
  });
}

async function resolveScheduleIdForInstallment(client: Client, installmentId: string | undefined, tenantId: string): Promise<string> {
  if (!installmentId) throw new Error('Installment or schedule is required');
  const installment = await client.installment.findFirst({
    where: { id: installmentId, tenantId },
    select: { scheduleId: true },
  });
  if (!installment) throw new Error('Installment not found');
  return installment.scheduleId;
}
