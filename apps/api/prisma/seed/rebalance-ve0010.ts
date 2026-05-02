/**
 * Rebalance VE0010 #5 and #6 manually.
 *
 * Background: the old `distributeOverpayment` greedy path dumped the entire
 * ₹1,526.40 excess from the #4 over-payment onto #5 (the first available
 * target) instead of splitting equally. After the subsequent #2-revert R4
 * pass added ₹1,677.60 to each of #5/#6, the values landed lopsided:
 *   #5 = ₹4,624.80, #6 = ₹6,151.20  (sum ₹10,776.00)
 *
 * What it SHOULD have been with equal split:
 *   excess of ₹1,526.40 / 2 = ₹763.20 to each of #5 and #6 →
 *   #5 = 4,473.60 - 763.20 = 3,710.40
 *   #6 = 4,473.60 - 763.20 = 3,710.40
 * After #2-revert (+₹1,677.60 each):
 *   #5 = 5,388.00, #6 = 5,388.00 (sum ₹10,776.00 — preserved)
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
            where: { installmentNumber: { in: [5, 6] } },
            orderBy: { installmentNumber: 'asc' },
          },
        },
      },
    },
  });
  if (!sale?.installmentSchedule) {
    console.log('VE0010 schedule not found');
    return;
  }
  const insts = sale.installmentSchedule.installments;
  const i5 = insts.find((i) => i.installmentNumber === 5);
  const i6 = insts.find((i) => i.installmentNumber === 6);
  if (!i5 || !i6) {
    console.log('Installments 5/6 missing');
    return;
  }
  const sumBefore = Number(i5.amountDue) + Number(i6.amountDue);
  const target = Math.round((sumBefore / 2) * 100) / 100;

  console.log('BEFORE:');
  console.log(`  #5 amountDue=${String(i5.amountDue)} rem=${String(i5.remainingAmount)}`);
  console.log(`  #6 amountDue=${String(i6.amountDue)} rem=${String(i6.remainingAmount)}`);
  console.log(`  sum=${sumBefore} → target each=${target}`);

  await p.installment.update({
    where: { id: i5.id },
    data: { amountDue: target, remainingAmount: target },
  });
  await p.installment.update({
    where: { id: i6.id },
    data: { amountDue: target, remainingAmount: target },
  });

  // Add a roll-log marker so the change is auditable
  await p.installmentRollLog.create({
    data: {
      scheduleId: sale.installmentSchedule.id,
      eventType: 'manual_adjustment',
      eventDate: new Date(),
      displayMessage:
        'Manual rebalance: split current dues equally between #5 and #6 ' +
        '(was lopsided due to old greedy distribution before the equal-split fix).',
      metadata: {
        before: {
          '#5': Number(i5.amountDue),
          '#6': Number(i6.amountDue),
        },
        after: { '#5': target, '#6': target },
        sum: sumBefore,
      } as any,
    },
  });

  const after = await p.installment.findMany({
    where: { scheduleId: sale.installmentSchedule.id, installmentNumber: { in: [5, 6] } },
    orderBy: { installmentNumber: 'asc' },
  });
  console.log('AFTER:');
  for (const i of after) {
    console.log(`  #${i.installmentNumber} amountDue=${String(i.amountDue)} rem=${String(i.remainingAmount)} status=${i.status}`);
  }
  await p.$disconnect();
})();
