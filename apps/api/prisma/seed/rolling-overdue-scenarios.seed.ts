import { InstallmentPromiseStatus, Prisma, type PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  copy.setDate(copy.getDate() + days);
  return copy;
}

async function collectorForShop(prisma: PrismaClient, tenantId: string, shopCode: string) {
  const user = await prisma.user.findUnique({
    where: { tenantId_username: { tenantId, username: `${shopCode.toLowerCase()}_emp1` } },
    select: { id: true },
  });
  return user?.id ?? null;
}

async function resetSchedule(prisma: PrismaClient, scheduleId: string) {
  const installments = await prisma.installment.findMany({
    where: { scheduleId },
    orderBy: [{ installmentNumber: 'asc' }],
  });
  const ids = installments.map((installment) => installment.id);
  await prisma.installmentPayment.deleteMany({ where: { installmentId: { in: ids } } });
  await prisma.installmentInterestApplication.deleteMany({ where: { installmentId: { in: ids } } });
  await prisma.installmentPromise.deleteMany({ where: { scheduleId } });
  await prisma.installmentRollLog.deleteMany({ where: { scheduleId } });
  await prisma.installment.deleteMany({ where: { scheduleId, parentInstallmentNumber: { not: null } } });

  const primaries = installments.filter((installment) => installment.parentInstallmentNumber === null);
  for (const installment of primaries) {
    await prisma.installment.update({
      where: { id: installment.id },
      data: {
        amountPaid: 0,
        remainingAmount: installment.amountDue,
        status: installment.dueDate < new Date() ? 'overdue' : 'upcoming',
        isClosed: false,
        isRescheduled: false,
        rescheduledFromId: null,
        notes: null,
      },
    });
  }
  await prisma.installmentSchedule.update({ where: { id: scheduleId }, data: { status: 'active', creditBalance: 0 } });
  return primaries;
}

export async function seedRollingOverdueScenarios(prisma: PrismaClient): Promise<{ scheduleIds: string[] }> {
  const schedules = await prisma.installmentSchedule.findMany({
    where: { numInstallments: { gte: 4 }, sale: { saleType: 'self_finance' } },
    include: {
      sale: { select: { customerId: true, shop: { select: { code: true } } } },
    },
    take: 5,
    orderBy: { createdAt: 'asc' },
  });
  if (schedules.length < 5) return { scheduleIds: [] };

  const scheduleIds: string[] = [];
  for (let index = 0; index < schedules.length; index++) {
    const schedule = schedules[index];
    const installments = await resetSchedule(prisma, schedule.id);
    const collector = await collectorForShop(prisma, schedule.tenantId, schedule.sale.shop.code);
    const [first, second, third] = installments;
    if (!first || !second || !third || !collector) continue;

    if (index === 0) {
      for (const installment of installments.slice(0, 3)) {
        await prisma.installmentPayment.create({
          data: {
            id: randomUUID(),
            tenantId: schedule.tenantId,
            installmentId: installment.id,
            amount: installment.amountDue,
            paymentMode: 'upi',
            paymentDate: addDays(installment.dueDate, -1),
            collectedBy: collector,
            referenceNumber: `PATTERN-B-A-${installment.installmentNumber}`,
          },
        });
        await prisma.installment.update({ where: { id: installment.id }, data: { amountPaid: installment.amountDue, remainingAmount: 0, status: 'paid' } });
      }
    } else if (index === 1) {
      await prisma.installment.update({ where: { id: first.id }, data: { dueDate: addDays(new Date(), -12), status: 'overdue' } });
    } else if (index === 2) {
      await prisma.installment.updateMany({ where: { id: { in: [first.id, second.id] } }, data: { status: 'overdue' } });
      await prisma.installmentPromise.create({
        data: {
          tenantId: schedule.tenantId,
          scheduleId: schedule.id,
          customerId: schedule.sale.customerId,
          coveredInstallmentIds: [first.id, second.id],
          promisedDate: addDays(new Date(), 5),
          promisedAmount: new Prisma.Decimal(first.remainingAmount).plus(second.remainingAmount),
          status: InstallmentPromiseStatus.pending,
          createdBy: collector,
          notes: 'Seed scenario: one promise covering two overdue EMIs',
        },
      });
    } else if (index === 3) {
      await prisma.installment.update({ where: { id: first.id }, data: { status: 'overdue' } });
      await prisma.installmentPromise.create({
        data: {
          tenantId: schedule.tenantId,
          scheduleId: schedule.id,
          customerId: schedule.sale.customerId,
          coveredInstallmentIds: [first.id],
          promisedDate: addDays(new Date(), -10),
          promisedAmount: first.remainingAmount,
          status: InstallmentPromiseStatus.broken,
          createdBy: collector,
          resolvedAt: addDays(new Date(), -9),
          notes: 'Seed scenario: broken promise',
        },
      });
      await prisma.installmentPromise.create({
        data: {
          tenantId: schedule.tenantId,
          scheduleId: schedule.id,
          customerId: schedule.sale.customerId,
          coveredInstallmentIds: [first.id],
          promisedDate: addDays(new Date(), 4),
          promisedAmount: first.remainingAmount,
          status: InstallmentPromiseStatus.pending,
          createdBy: collector,
          notes: 'Seed scenario: fresh promise after broken promise',
        },
      });
    } else {
      const interest = new Prisma.Decimal(first.remainingAmount).mul(1).div(100).toDecimalPlaces(2);
      await prisma.installmentInterestApplication.create({
        data: {
          tenantId: schedule.tenantId,
          installmentId: first.id,
          scheduleId: schedule.id,
          daysOverdue: 30,
          dailyRate: new Prisma.Decimal(0.01).div(30).toDecimalPlaces(6),
          baseAmount: first.remainingAmount,
          appliedAmount: interest,
          appliedBy: collector,
          notes: 'Seed scenario: discretionary penalty applied',
        },
      });
      const paid = new Prisma.Decimal(first.remainingAmount).plus(interest).div(2).toDecimalPlaces(2);
      await prisma.installment.update({
        where: { id: first.id },
        data: {
          amountDue: { increment: interest },
          amountPaid: paid,
          remainingAmount: new Prisma.Decimal(first.remainingAmount).plus(interest).minus(paid),
          status: 'partially_paid',
        },
      });
      await prisma.installmentPayment.create({
        data: {
          id: randomUUID(),
          tenantId: schedule.tenantId,
          installmentId: first.id,
          amount: paid,
          paymentMode: 'cash',
          paymentDate: new Date(),
          collectedBy: collector,
          referenceNumber: 'PATTERN-B-E-PARTIAL',
        },
      });
      await prisma.installmentPromise.create({
        data: {
          tenantId: schedule.tenantId,
          scheduleId: schedule.id,
          customerId: schedule.sale.customerId,
          coveredInstallmentIds: [first.id],
          promisedDate: addDays(new Date(), 7),
          promisedAmount: new Prisma.Decimal(first.remainingAmount).plus(interest).minus(paid),
          status: InstallmentPromiseStatus.pending,
          createdBy: collector,
          notes: 'Seed scenario: promise for post-penalty balance',
        },
      });
    }

    scheduleIds.push(schedule.id);
  }

  return { scheduleIds };
}
