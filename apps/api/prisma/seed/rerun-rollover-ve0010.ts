/**
 * Re-runs the installment rollover engine for ledger VE0010's schedule
 * after clearing today's lastRolloverDate marker. Use this once to apply
 * the post-revertPayment rollover behavior to schedules that were reverted
 * BEFORE the fix landed.
 */
import { PrismaClient } from '@prisma/client';
import { ensureRolledForToday } from '../../src/modules/installments/installments.rules.js';

const p = new PrismaClient();

(async () => {
  const sale = await p.saleRecord.findFirst({
    where: { ledgerNumber: 'VE0010' },
    include: { installmentSchedule: { select: { id: true } } },
  });
  if (!sale?.installmentSchedule) {
    console.log('No schedule for VE0010');
    return;
  }
  const scheduleId = sale.installmentSchedule.id;
  console.log(`Forcing rollover re-run for schedule ${scheduleId}…`);

  const result = await p.$transaction(async (tx) => {
    await tx.installmentSchedule.update({
      where: { id: scheduleId },
      data: { lastRolloverDate: null },
    });
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return ensureRolledForToday(tx, today, { scheduleId });
  });
  console.log('Rollover result:', result);

  // Print the updated installments
  const updated = await p.installment.findMany({
    where: { scheduleId },
    orderBy: [{ installmentNumber: 'asc' }, { subSequence: 'asc' }],
  });
  console.log('UPDATED INSTALLMENTS:');
  for (const i of updated) {
    console.log(
      `  #${i.installmentNumber}${i.subSequence ? '.' + i.subSequence : ''}`,
      'due', i.dueDate.toISOString().slice(0, 10),
      'amountDue', String(i.amountDue),
      'rem', String(i.remainingAmount),
      'status', i.status,
      i.isClosed ? 'CLOSED' : '',
      i.isRescheduled ? 'RESCHED' : '',
    );
  }
  await p.$disconnect();
})();
