import { Prisma } from '@prisma/client';

const D = (value: Prisma.Decimal | number | string) => new Prisma.Decimal(value);

export interface AllocationLine {
  installmentId: string;
  amount: Prisma.Decimal;
}

export interface AllocationResult {
  lines: AllocationLine[];
  unallocated: Prisma.Decimal;
}

export function allocatePayment(
  paymentAmount: Prisma.Decimal | number | string,
  installments: Array<{ id: string; remainingAmount: Prisma.Decimal; dueDate: Date }>,
  explicitInstallmentId?: string,
): AllocationResult {
  let remaining = D(paymentAmount);
  const lines: AllocationLine[] = [];

  if (remaining.lte(0)) {
    return { lines, unallocated: D(0) };
  }

  if (explicitInstallmentId) {
    const target = installments.find((installment) => installment.id === explicitInstallmentId);
    if (!target) throw new Error('Target installment not found in this schedule');

    const amount = Prisma.Decimal.min(remaining, D(target.remainingAmount));
    if (amount.gt(0)) lines.push({ installmentId: target.id, amount });
    return { lines, unallocated: remaining.minus(amount) };
  }

  const ordered = installments
    .filter((installment) => D(installment.remainingAmount).gt(0))
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());

  for (const installment of ordered) {
    if (remaining.lte(0)) break;
    const amount = Prisma.Decimal.min(remaining, D(installment.remainingAmount));
    if (amount.gt(0)) lines.push({ installmentId: installment.id, amount });
    remaining = remaining.minus(amount);
  }

  return { lines, unallocated: remaining };
}
