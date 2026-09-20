import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

const LEDGER = process.argv[2] ?? 'VE0030';

function d(v: Date | null | undefined) {
  return v ? v.toISOString().slice(0, 10) : 'null';
}
function n(v: { toString(): string } | null | undefined) {
  return v == null ? 'null' : Number(v.toString()).toFixed(2);
}

(async () => {
  const sale = await p.saleRecord.findFirst({
    where: { ledgerNumber: LEDGER },
    include: {
      customer: { select: { name: true, customerCode: true } },
      shop: { select: { code: true, name: true } },
      installmentSchedule: {
        include: {
          installments: {
            orderBy: [{ installmentNumber: 'asc' }, { subSequence: 'asc' }],
            include: {
              payments: { orderBy: { paymentDate: 'asc' } },
              interestApplications: { orderBy: { appliedAt: 'asc' } },
              rescheduledFrom: { select: { installmentNumber: true, subSequence: true } },
            },
          },
          rollLogEvents: { orderBy: { createdAt: 'asc' } },
        },
      },
    },
  });

  if (!sale) {
    console.log(`No sale with ledger ${LEDGER} found`);
    return;
  }

  console.log('========== SALE ==========');
  console.log({
    ledger: sale.ledgerNumber,
    saleNumber: sale.saleNumber,
    saleDate: d(sale.saleDate),
    shop: sale.shop.code,
    customer: `${sale.customer?.customerCode ?? '?'} ${sale.customer?.name ?? ''}`,
    paymentType: sale.paymentType,
    financeType: sale.financeType,
    totalAmount: n(sale.totalAmount),
    paidAmount: n(sale.paidAmount),
    interestRate: sale.interestRate ? String(sale.interestRate) : null,
    numInstallments: sale.numInstallments,
    emiAmount: n(sale.emiAmount),
    fileCharge: n(sale.fileCharge),
  });

  const sc = sale.installmentSchedule;
  if (!sc) {
    console.log('No installment schedule for this sale');
    await p.$disconnect();
    return;
  }

  console.log('\n========== SCHEDULE ==========');
  console.log({
    id: sc.id,
    status: sc.status,
    totalPrincipal: n(sc.totalPrincipal),
    totalInterest: n(sc.totalInterest),
    fileCharge: n(sc.fileCharge),
    totalPayable: n(sc.totalPayable),
    numInstallments: sc.numInstallments,
    emiAmount: n(sc.emiAmount),
    startDate: d(sc.startDate),
    lastRolloverDate: d(sc.lastRolloverDate),
  });

  console.log('\nTODAY:', d(new Date()));

  // -------- consistency checks ----------
  const rows = sc.installments;
  const primary = rows.filter((r) => r.parentInstallmentNumber == null);
  const subs = rows.filter((r) => r.parentInstallmentNumber != null);

  const sumPrimaryDue = primary.reduce((a, r) => a + Number(r.amountDue), 0);
  const sumPrimaryPaid = primary.reduce((a, r) => a + Number(r.amountPaid), 0);
  const sumPrimaryRem = primary.reduce((a, r) => a + Number(r.remainingAmount), 0);
  const sumAllPaid = rows.reduce((a, r) => a + Number(r.amountPaid), 0);
  const sumAllRem = rows
    .filter((r) => !r.isClosed)
    .reduce((a, r) => a + Number(r.remainingAmount), 0);

  console.log('\n========== ROW COUNTS ==========');
  console.log({
    totalRows: rows.length,
    primary: primary.length,
    sub: subs.length,
    closed: rows.filter((r) => r.isClosed).length,
    rescheduled: rows.filter((r) => r.isRescheduled).length,
  });

  console.log('\n========== INSTALLMENTS ==========');
  for (const r of rows) {
    const tag = `#${r.installmentNumber}${r.subSequence ? '.' + r.subSequence : ''}`;
    const from = r.rescheduledFrom
      ? ` from#${r.rescheduledFrom.installmentNumber}${
          r.rescheduledFrom.subSequence ? '.' + r.rescheduledFrom.subSequence : ''
        }`
      : '';
    console.log(
      `  ${tag.padEnd(6)} due ${d(r.dueDate)}  due=${n(r.amountDue).padStart(10)}  paid=${n(
        r.amountPaid,
      ).padStart(10)}  rem=${n(r.remainingAmount).padStart(10)}  ${r.status.padEnd(10)}` +
        `${r.isClosed ? ' CLOSED' : ''}${r.isRescheduled ? ' RESCHED' : ''}${from}`,
    );
    for (const pay of r.payments) {
      console.log(
        `        pay ${d(pay.paymentDate)} amt=${n(pay.amount)} mode=${pay.paymentMode}${
          pay.notes ? ` notes="${pay.notes}"` : ''
        }`,
      );
    }
    for (const ia of r.interestApplications) {
      console.log(
        `        interest ${d(ia.appliedAt)} days=${ia.daysOverdue} rate=${ia.dailyRate} base=${n(
          ia.baseAmount,
        )} applied=${n(ia.appliedAmount)}${ia.rolledBackAt ? ' ROLLED_BACK' : ''}`,
      );
    }
  }

  console.log('\n========== AGGREGATES ==========');
  console.log({
    sumPrimaryDue: sumPrimaryDue.toFixed(2),
    scheduleTotalPayable: n(sc.totalPayable),
    deltaPrimaryDueVsTotal: (sumPrimaryDue - Number(sc.totalPayable)).toFixed(2),
    sumPrimaryPaid: sumPrimaryPaid.toFixed(2),
    sumPrimaryRem: sumPrimaryRem.toFixed(2),
    sumAllPaid: sumAllPaid.toFixed(2),
    sumAllRemActive: sumAllRem.toFixed(2),
  });

  // Per-row sanity: amountDue - amountPaid == remainingAmount
  console.log('\n========== ROW SANITY (due-paid vs remaining) ==========');
  let issues = 0;
  for (const r of rows) {
    const expected = Number(r.amountDue) - Number(r.amountPaid);
    const diff = expected - Number(r.remainingAmount);
    if (Math.abs(diff) > 0.005) {
      issues++;
      console.log(
        `  MISMATCH #${r.installmentNumber}${r.subSequence ? '.' + r.subSequence : ''}: due=${n(
          r.amountDue,
        )} paid=${n(r.amountPaid)} rem=${n(r.remainingAmount)} expected=${expected.toFixed(
          2,
        )} diff=${diff.toFixed(2)}`,
      );
    }
  }
  if (issues === 0) console.log('  OK — all rows balance.');

  // Payment totals per installment vs amountPaid
  console.log('\n========== PAYMENT TOTAL vs amountPaid ==========');
  issues = 0;
  for (const r of rows) {
    const paySum = r.payments.reduce((a, p) => a + Number(p.amount), 0);
    const diff = paySum - Number(r.amountPaid);
    if (Math.abs(diff) > 0.005) {
      issues++;
      console.log(
        `  MISMATCH #${r.installmentNumber}${r.subSequence ? '.' + r.subSequence : ''}: payments=${paySum.toFixed(
          2,
        )} amountPaid=${n(r.amountPaid)} diff=${diff.toFixed(2)}`,
      );
    }
  }
  if (issues === 0) console.log('  OK — payments match amountPaid.');

  console.log('\n========== ROLL LOG (oldest first) ==========');
  for (const r of sc.rollLogEvents) {
    console.log(
      `  ${r.createdAt.toISOString().slice(0, 19)} [${r.eventType}] eventDate=${d(
        r.eventDate,
      )}  ${r.displayMessage}`,
    );
  }

  await p.$disconnect();
})();
