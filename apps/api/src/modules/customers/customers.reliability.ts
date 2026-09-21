import { InstallmentPromiseStatus } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { ReliabilityMetrics } from '@retailerp/shared-types';

export async function computeCustomerReliability(
  prisma: PrismaClient,
  customerId: string,
  tenantId: string,
  windowDays = 365,
): Promise<ReliabilityMetrics | null> {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, tenantId },
    select: { id: true },
  });
  if (!customer) return null;

  const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const [promises, installments, payments] = await Promise.all([
    prisma.installmentPromise.findMany({
      where: { tenantId, customerId, createdAt: { gte: windowStart } },
      select: { status: true, coveredInstallmentIds: true },
    }),
    prisma.installment.findMany({
      where: { tenantId, schedule: { sale: { customerId } } },
      select: { status: true, remainingAmount: true },
    }),
    prisma.installmentPayment.findMany({
      where: {
        tenantId,
        paymentDate: { gte: windowStart },
        installment: { schedule: { sale: { customerId } } },
      },
      select: {
        paymentDate: true,
        installment: { select: { dueDate: true } },
      },
    }),
  ]);

  // Cancelled promises were shop mistakes, not the customer's word.
  const promisesMade = promises.filter((promise) => promise.status !== InstallmentPromiseStatus.cancelled).length;
  const promisesKept = promises.filter((promise) => promise.status === InstallmentPromiseStatus.kept).length;
  const promisesPartiallyKept = promises.filter((promise) => promise.status === InstallmentPromiseStatus.partially_kept).length;
  const brokenPromises = promises.filter((promise) => promise.status === InstallmentPromiseStatus.broken);
  const promisesBroken = brokenPromises.length;
  const promisesBrokenEmiCount = brokenPromises.reduce(
    (sum, promise) => sum + promise.coveredInstallmentIds.length,
    0,
  );

  const activeOverdueEmiCount = installments.filter(
    (installment) => installment.status === 'overdue' || installment.status === 'partially_paid',
  ).length;
  const totalOutstanding = installments.reduce(
    (sum, installment) => sum + Number(installment.remainingAmount),
    0,
  );

  const dpdValues = payments.map((payment) => {
    const due = new Date(payment.installment.dueDate);
    const paid = new Date(payment.paymentDate);
    due.setHours(0, 0, 0, 0);
    paid.setHours(0, 0, 0, 0);
    return Math.max(0, Math.floor((paid.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)));
  });
  const avgDpdAtPayment = dpdValues.length > 0
    ? dpdValues.reduce((sum, value) => sum + value, 0) / dpdValues.length
    : null;

  const riskBand: ReliabilityMetrics['riskBand'] =
    promisesBrokenEmiCount >= 3 || activeOverdueEmiCount >= 3
      ? 'high'
      : promisesBrokenEmiCount >= 1 || activeOverdueEmiCount >= 1
        ? 'medium'
        : 'low';

  return {
    customerId,
    promisesMade,
    promisesKept,
    promisesPartiallyKept,
    promisesBroken,
    promisesBrokenEmiCount,
    activeOverdueEmiCount,
    totalOutstanding,
    avgDpdAtPayment,
    riskBand,
  };
}
