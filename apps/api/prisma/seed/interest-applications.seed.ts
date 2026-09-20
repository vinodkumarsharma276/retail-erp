import { Prisma, type PrismaClient } from '@prisma/client';

function rand(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

function daysOverdue(dueDate: Date): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)));
}

export async function seedInterestApplications(prisma: PrismaClient) {
  const existing = await prisma.installmentInterestApplication.count();
  if (existing > 0) return [];

  const installments = await prisma.installment.findMany({
    where: { status: { in: ['overdue', 'partially_paid'] }, remainingAmount: { gt: 0 } },
    include: {
      schedule: {
        select: {
          id: true,
          tenantId: true,
          sale: { select: { shop: { select: { code: true } } } },
        },
      },
    },
    take: 500,
  });

  const apps = [];
  let seed = 51000;
  for (const installment of installments) {
    if (rand(seed++) > 0.2) continue;
    const emp = await prisma.user.findUnique({
      where: {
        tenantId_username: {
          tenantId: installment.tenantId,
          username: `${installment.schedule.sale.shop.code.toLowerCase()}_emp1`,
        },
      },
      select: { id: true },
    });
    if (!emp) continue;

    const overdueDays = daysOverdue(installment.dueDate);
    if (overdueDays <= 0) continue;

    const suggested = new Prisma.Decimal(installment.remainingAmount)
      .mul(1)
      .div(100)
      .div(30)
      .mul(overdueDays)
      .toDecimalPlaces(2);
    const custom = new Prisma.Decimal(50 + Math.floor(rand(seed++) * 150));
    const amount = rand(seed++) < 0.75 ? suggested : custom;
    const rolledBack = rand(seed++) < 0.05;

    const app = await prisma.$transaction(async (tx) => {
      const created = await tx.installmentInterestApplication.create({
        data: {
          tenantId: installment.tenantId,
          installmentId: installment.id,
          scheduleId: installment.scheduleId,
          daysOverdue: overdueDays,
          dailyRate: new Prisma.Decimal(0.01).div(30).toDecimalPlaces(6),
          baseAmount: installment.remainingAmount,
          appliedAmount: amount,
          appliedBy: emp.id,
          notes: 'Seed discretionary penalty',
          rolledBackAt: rolledBack ? new Date() : null,
          rolledBackBy: rolledBack ? emp.id : null,
          rollbackReason: rolledBack ? 'Seed rollback example' : null,
        },
      });

      if (!rolledBack) {
        await tx.installment.update({
          where: { id: installment.id },
          data: { amountDue: { increment: amount }, remainingAmount: { increment: amount } },
        });
      }

      return created;
    });
    apps.push(app);
  }

  return apps;
}
