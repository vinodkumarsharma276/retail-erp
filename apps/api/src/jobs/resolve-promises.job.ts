import { InstallmentPromiseStatus, Prisma, PrismaClient } from '@prisma/client';

const D = (value: Prisma.Decimal | number | string | null | undefined) => new Prisma.Decimal(value ?? 0);

export async function runResolvePromisesJob(prisma: PrismaClient, logger: { info: (...args: unknown[]) => void; error: (...args: unknown[]) => void }) {
  const tenants = await prisma.tenant.findMany({
    where: { status: 'active' },
    select: { id: true, slug: true },
  });

  for (const tenant of tenants) {
    try {
      const count = await resolvePromisesForTenant(prisma, tenant.id);
      if (count > 0) logger.info({ tenant: tenant.slug, count }, 'Resolved installment promises');
    } catch (error) {
      logger.error({ tenant: tenant.slug, error }, 'Failed to resolve installment promises');
    }
  }
}

async function resolvePromisesForTenant(prisma: PrismaClient, tenantId: string): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const promises = await prisma.installmentPromise.findMany({
    where: { tenantId, status: InstallmentPromiseStatus.pending, promisedDate: { lt: today } },
    select: {
      id: true,
      scheduleId: true,
      promisedAmount: true,
      promisedDate: true,
      coveredInstallmentIds: true,
      createdAt: true,
    },
  });

  for (const promise of promises) {
    await prisma.$transaction(async (tx) => {
      // Only money paid ON OR BEFORE the promised date keeps a promise. The
      // old `paymentDate < today` also counted late payments whenever this
      // job ran a day or two behind.
      const payments = await tx.installmentPayment.aggregate({
        where: {
          tenantId,
          installmentId: { in: promise.coveredInstallmentIds },
          createdAt: { gte: promise.createdAt },
          paymentDate: { lte: promise.promisedDate },
        },
        _sum: { amount: true },
      });

      const collected = D(payments._sum.amount);
      const promised = D(promise.promisedAmount);
      const status = collected.gte(promised)
        ? InstallmentPromiseStatus.kept
        : collected.gt(0)
          ? InstallmentPromiseStatus.partially_kept
          : InstallmentPromiseStatus.broken;

      await tx.installmentPromise.update({
        where: { id: promise.id },
        data: { status, resolvedAt: new Date(), collectedAmount: collected },
      });
      await tx.installmentRollLog.create({
        data: {
          tenantId,
          scheduleId: promise.scheduleId,
          eventType: `promise_${status}`,
          eventDate: today,
          displayMessage: `Promise resolved as ${status}. Collected ₹${collected.toFixed(2)} of ₹${promised.toFixed(2)}.`,
          metadata: {
            promiseId: promise.id,
            promisedAmount: promised.toString(),
            collectedAmount: collected.toString(),
            coveredInstallmentIds: promise.coveredInstallmentIds,
          },
        },
      });
    });
  }

  return promises.length;
}
