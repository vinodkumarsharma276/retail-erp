import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

(async () => {
  const s = await p.saleRecord.findFirst({
    where: { saleNumber: 'SALE-VE-20250501-001' },
    include: {
      installmentSchedule: {
        include: {
          installments: {
            orderBy: [{ installmentNumber: 'asc' }, { subSequence: 'asc' }],
          },
          interestApplications: {
            include: {
              installment: {
                select: { installmentNumber: true, subSequence: true },
              },
            },
            orderBy: { appliedAt: 'desc' },
          },
          rollLogEvents: {
            orderBy: { createdAt: 'desc' },
            take: 20,
          },
        },
      },
    },
  });
  if (!s) {
    console.log('Sale not found');
    return;
  }
  console.log('SALE:', {
    id: s.id,
    sellingPrice: String(s.sellingPrice),
    downPayment: String(s.downPayment),
    interestRate: s.interestRate ? String(s.interestRate) : null,
    fileCharge: s.fileCharge ? String(s.fileCharge) : null,
    numInstallments: s.numInstallments,
    emiAmount: s.emiAmount ? String(s.emiAmount) : null,
  });
  const sc = s.installmentSchedule!;
  console.log('SCHEDULE:', {
    totalPrincipal: String(sc.totalPrincipal),
    totalInterest: String(sc.totalInterest),
    fileCharge: String(sc.fileCharge),
    totalPayable: String(sc.totalPayable),
    numInstallments: sc.numInstallments,
    emiAmount: String(sc.emiAmount),
    status: sc.status,
  });
  console.log('INSTALLMENTS:');
  for (const i of sc.installments) {
    console.log(
      `  #${i.installmentNumber}${i.subSequence ? '.' + i.subSequence : ''}`,
      'due', String(i.dueDate).slice(0, 10),
      'amountDue', String(i.amountDue),
      'paid', String(i.amountPaid),
      'rem', String(i.remainingAmount),
      'status', i.status,
      i.isClosed ? 'CLOSED' : '',
      i.isRescheduled ? 'RESCHED' : '',
    );
  }
  console.log('INTEREST APPLICATIONS:');
  for (const a of sc.interestApplications) {
    console.log(
      `  inst#${a.installment.installmentNumber}${a.installment.subSequence ? '.' + a.installment.subSequence : ''}`,
      'amount', String(a.appliedAmount),
      'days', a.daysOverdue,
      'appliedAt', a.appliedAt.toISOString().slice(0, 19),
      'rolledBackAt', a.rolledBackAt ? a.rolledBackAt.toISOString().slice(0, 19) : null,
    );
  }
  console.log('RECENT ROLL LOG:');
  for (const r of sc.rollLogEvents) {
    console.log(`  [${r.eventType}] ${r.createdAt.toISOString().slice(0, 19)} ${r.displayMessage.slice(0, 200)}`);
  }
  await p.$disconnect();
})();
