import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const r = await p.installment.updateMany({
    where: {
      schedule: { sale: { ledgerNumber: 'VE0010' } },
      installmentNumber: 4,
    },
    data: { amountDue: 4473.6, remainingAmount: 0, status: 'paid' },
  });
  console.log('Updated rows:', r.count);
  const after = await p.installment.findFirst({
    where: {
      schedule: { sale: { ledgerNumber: 'VE0010' } },
      installmentNumber: 4,
    },
  });
  console.log('AFTER:', {
    amountDue: String(after?.amountDue),
    amountPaid: String(after?.amountPaid),
    remaining: String(after?.remainingAmount),
    status: after?.status,
  });
  await p.$disconnect();
})();
