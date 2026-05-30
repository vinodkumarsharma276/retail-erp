import { InstallmentPromiseStatus, type PrismaClient } from '@prisma/client';

function rand(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export async function seedPromises(prisma: PrismaClient) {
  const existing = await prisma.installmentPromise.count();
  if (existing > 0) return [];

  const schedules = await prisma.installmentSchedule.findMany({
    where: { sale: { saleType: 'self_finance' } },
    include: {
      sale: { select: { customerId: true, shopId: true, shop: { select: { code: true } } } },
      installments: {
        where: { remainingAmount: { gt: 0 }, dueDate: { lte: new Date() } },
        orderBy: [{ dueDate: 'asc' }, { installmentNumber: 'asc' }],
      },
    },
    take: 300,
  });

  const created = [];
  let seed = 41000;
  for (const schedule of schedules) {
    if (schedule.installments.length === 0) continue;
    if (rand(seed++) > 0.3) continue;

    const emp = await prisma.user.findUnique({
      where: { tenantId_username: { tenantId: schedule.tenantId, username: `${schedule.sale.shop.code.toLowerCase()}_emp1` } },
      select: { id: true },
    });
    if (!emp) continue;

    const countRoll = rand(seed++);
    const coveredCount = countRoll < 0.7 ? 1 : countRoll < 0.95 ? 2 : Math.min(3, schedule.installments.length);
    const covered = schedule.installments.slice(0, coveredCount);
    const promisedAmount = covered.reduce((sum, installment) => sum + Number(installment.remainingAmount), 0);

    const statusRoll = rand(seed++);
    const status = statusRoll < 0.4
      ? InstallmentPromiseStatus.pending
      : statusRoll < 0.7
        ? InstallmentPromiseStatus.kept
        : statusRoll < 0.9
          ? InstallmentPromiseStatus.broken
          : InstallmentPromiseStatus.partially_kept;
    const promisedDate = status === InstallmentPromiseStatus.pending
      ? addDays(new Date(), 3 + Math.floor(rand(seed++) * 15))
      : addDays(new Date(), -3 - Math.floor(rand(seed++) * 20));
    const collectedAmount = status === InstallmentPromiseStatus.kept
      ? promisedAmount
      : status === InstallmentPromiseStatus.partially_kept
        ? Math.round(promisedAmount / 2)
        : 0;

    const promise = await prisma.installmentPromise.create({
      data: {
        tenantId: schedule.tenantId,
        scheduleId: schedule.id,
        customerId: schedule.sale.customerId,
        coveredInstallmentIds: covered.map((installment) => installment.id),
        promisedDate,
        promisedAmount,
        status,
        createdBy: emp.id,
        resolvedAt: status === InstallmentPromiseStatus.pending ? null : promisedDate,
        collectedAmount,
        notes: status === InstallmentPromiseStatus.pending ? 'Seed pending collection promise' : 'Seed resolved promise',
      },
    });
    created.push(promise);
  }

  return created;
}
