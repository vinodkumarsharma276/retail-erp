import { InstallmentStatus, type PaymentMode, Prisma, type PrismaClient } from '@prisma/client';
import { allocatePayment } from './installments.allocator.js';
import { computeDaysOverdue, computeInstallmentStatus } from './installments.derivations.js';

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
  applyInterest?: {
    installmentId: string;
    appliedAmount: number;
    daysOverdue?: number;
    notes?: string | null;
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
  input: { amount: number; daysOverdue?: number; notes?: string | null },
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
      dailyRate: D(0.01).div(30).toDecimalPlaces(6),
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
