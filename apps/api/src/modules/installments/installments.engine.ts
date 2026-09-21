import { InstallmentStatus, type PaymentMode, Prisma, type PrismaClient } from '@prisma/client';
import { computeEarlyPaymentDeduction, computeLatePenalty } from '@retailerp/shared-utils';
import type { PaymentPreview } from '@retailerp/shared-types';
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
}

// ---------------------------------------------------------------------------
// Shared context for the two discretionary adjustments
// ---------------------------------------------------------------------------

async function loadAdjustmentContext(client: Client, installmentId: string, tenantId: string) {
  const installment = await client.installment.findFirst({
    where: { id: installmentId, tenantId },
    include: {
      interestApplications: {
        where: { rolledBackAt: null },
        select: { appliedAmount: true, appliedAt: true, chargedThrough: true },
      },
      schedule: {
        select: {
          id: true,
          totalInterest: true,
          numInstallments: true,
          sale: { select: { penaltyPerDay: true } },
          tenant: { select: { settings: true } },
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

  // The last day an earlier penalty already covered. Legacy charges predate
  // `chargedThrough`, so their applied date stands in for it.
  let chargedThrough: Date | null = null;
  for (const app of installment.interestApplications) {
    const covered = app.chargedThrough ?? toDateOnly(app.appliedAt);
    if (!chargedThrough || covered > chargedThrough) chargedThrough = covered;
  }
  const alreadyCharged = installment.interestApplications.reduce(
    (sum, app) => sum.plus(app.appliedAmount),
    D(0),
  );

  return { installment, settings, perDay, chargedThrough, alreadyCharged };
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
  input: { paymentDate?: Date },
  ctx: { tenantId: string },
): Promise<PaymentPreview> {
  const asOf = toDateOnly(input.paymentDate ?? new Date());
  const adj = await loadAdjustmentContext(prisma, installmentId, ctx.tenantId);
  const { installment } = adj;
  const remaining = Number(installment.remainingAmount);

  const penalty = computeLatePenalty({
    perDay: adj.perDay,
    dueDate: installment.dueDate,
    asOf,
    remainingAmount: remaining,
    chargedThrough: adj.chargedThrough,
  });

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
    penalty: {
      perDay: penalty.perDay,
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
        sale: { select: { id: true, tenantId: true, shopId: true, saleNumber: true } },
        installments: {
          where: { parentInstallmentNumber: null, isClosed: false },
          orderBy: [{ dueDate: 'asc' }, { installmentNumber: 'asc' }],
        },
      },
    });
    if (!schedule) throw new Error('Installment schedule not found');

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

    // The EMI the collector is paying. Both adjustments below are about it.
    const sourceInstallmentId = input.explicitInstallmentId ?? input.installmentId;
    const paymentDay = toDateOnly(paymentDate);

    // --- Late penalty (opt-in) ---------------------------------------------
    // Worked out here from the sale's ₹/day rate, never taken from the client,
    // and only for days not already charged.
    if (input.applyPenalty && sourceInstallmentId) {
      const adj = await loadAdjustmentContext(tx, sourceInstallmentId, ctx.tenantId);
      if (adj.installment.scheduleId !== schedule.id) {
        throw new Error('Installment does not belong to this schedule');
      }
      const penalty = computeLatePenalty({
        perDay: adj.perDay,
        dueDate: adj.installment.dueDate,
        asOf: paymentDay,
        remainingAmount: Number(adj.installment.remainingAmount),
        chargedThrough: adj.chargedThrough,
      });
      if (penalty.amount > 0) {
        await applyInterestInTx(tx, sourceInstallmentId, {
          amount: penalty.amount,
          daysOverdue: penalty.days,
          chargedThrough: paymentDay,
          perDay: penalty.perDay,
          notes: `Late penalty ₹${penalty.perDay}/day × ${penalty.days} day${penalty.days === 1 ? '' : 's'}`,
        }, ctx);
        const target = schedule.installments.find((installment) => installment.id === sourceInstallmentId);
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

    const allocation = allocatePayment(input.amount, activeInstallments, input.explicitInstallmentId ?? input.installmentId);
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

    return { paymentIds, creditAdded: allocation.unallocated.toNumber() };
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
