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

  // Oldest first. A chosen EMI is simply moved to the front; anything left
  // over after clearing it still goes to the rest, oldest first.
  const ordered = installments
    .filter((installment) => D(installment.remainingAmount).gt(0))
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());

  if (explicitInstallmentId) {
    const index = ordered.findIndex((installment) => installment.id === explicitInstallmentId);
    if (index === -1) throw new Error('Target installment not found in this schedule');
    ordered.unshift(...ordered.splice(index, 1));
  }

  for (const installment of ordered) {
    if (remaining.lte(0)) break;
    const amount = Prisma.Decimal.min(remaining, D(installment.remainingAmount));
    if (amount.gt(0)) lines.push({ installmentId: installment.id, amount });
    remaining = remaining.minus(amount);
  }

  return { lines, unallocated: remaining };
}
