/**
 * One-off: correct VE0010 #4 amountDue / amountPaid so the UI reflects the
 * actual ₹6,000 cash collected (was capped to ₹4,473.60 by the old service
 * before the fix landed).
 */
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

(async () => {
  const sale = await p.saleRecord.findFirst({
    where: { ledgerNumber: 'VE0010' },
    include: {
      installmentSchedule: {
        include: {
          installments: {
            where: { installmentNumber: 4 },
            include: { payments: true },
          },
        },
      },
    },
  });
  if (!sale) {
    console.log('VE0010 not found');
    return;
  }
  const inst = sale.installmentSchedule!.installments[0];
  if (!inst) {
    console.log('Installment #4 not found');
    return;
  }
  const totalCash = inst.payments.reduce((s, x) => s + Number(x.amount), 0);
  const newAmountDue = totalCash;
  console.log('BEFORE:', {
    amountDue: String(inst.amountDue),
    amountPaid: String(inst.amountPaid),
    remaining: String(inst.remainingAmount),
    totalCash,
  });
  await p.installment.update({
    where: { id: inst.id },
    data: {
      amountDue: newAmountDue,
      amountPaid: totalCash,
      remainingAmount: 0,
      status: 'paid',
    },
  });
  const after = await p.installment.findUnique({ where: { id: inst.id } });
  console.log('AFTER:', {
    amountDue: String(after?.amountDue),
    amountPaid: String(after?.amountPaid),
    remaining: String(after?.remainingAmount),
    status: after?.status,
  });
  await p.$disconnect();
})();
