import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

(async () => {
  const sale = await p.saleRecord.findFirst({
    where: { ledgerNumber: 'VE0010' },
    include: {
      installmentSchedule: {
        include: {
          installments: {
            orderBy: [{ installmentNumber: 'asc' }, { subSequence: 'asc' }],
          },
          rollLogEvents: {
            orderBy: { createdAt: 'desc' },
            take: 30,
          },
        },
      },
    },
  });
  if (!sale) {
    console.log('No sale with ledger VE0010 found');
    return;
  }
  console.log('SALE:', {
    id: sale.id,
    saleNumber: sale.saleNumber,
    saleDate: sale.saleDate.toISOString().slice(0, 10),
    interestRate: sale.interestRate ? String(sale.interestRate) : null,
    numInstallments: sale.numInstallments,
    emiAmount: sale.emiAmount ? String(sale.emiAmount) : null,
  });
  const sc = sale.installmentSchedule!;
  console.log('SCHEDULE:', {
    id: sc.id,
    status: sc.status,
    lastRolloverDate: sc.lastRolloverDate
      ? sc.lastRolloverDate.toISOString().slice(0, 10)
      : null,
  });
  console.log('TODAY:', new Date().toISOString().slice(0, 10));
  console.log('INSTALLMENTS:');
  for (const i of sc.installments) {
    console.log(
      `  #${i.installmentNumber}${i.subSequence ? '.' + i.subSequence : ''}`,
      'due', i.dueDate.toISOString().slice(0, 10),
      'due', String(i.amountDue),
      'paid', String(i.amountPaid),
      'rem', String(i.remainingAmount),
      'status', i.status,
      i.isClosed ? 'CLOSED' : '',
      i.isRescheduled ? 'RESCHED' : '',
      i.parentInstallmentNumber !== null ? `parent#${i.parentInstallmentNumber}` : '',
    );
  }
  console.log('RECENT ROLL LOG (newest first):');
  for (const r of sc.rollLogEvents) {
    console.log(
      `  [${r.eventType}] ${r.createdAt.toISOString().slice(0, 19)} ${r.displayMessage.slice(0, 240)}`,
    );
  }
  await p.$disconnect();
})();
