/**
 * Inspect the duplicate 6.1 rows on VE0072 and mark the Apr 28 one as
 * rescheduled (so it's hidden from the active list).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const sale = await prisma.saleRecord.findFirst({
    where: { ledgerNumber: 'VE0072' },
    select: { id: true },
  });
  if (!sale) return;
  const schedule = await prisma.installmentSchedule.findFirst({
    where: { saleId: sale.id },
    select: { id: true },
  });
  if (!schedule) return;

  const rows = await prisma.installment.findMany({
    where: {
      scheduleId: schedule.id,
      parentInstallmentNumber: 6,
      subSequence: 1,
    },
    orderBy: { dueDate: 'asc' },
    select: {
      id: true,
      dueDate: true,
      status: true,
      isRescheduled: true,
      rescheduledFromId: true,
      amountDue: true,
      amountPaid: true,
      remainingAmount: true,
    },
  });

  console.log('VE0072 #6.1 rows:');
  for (const r of rows) {
    console.log(
      `  ${r.id} | ${r.dueDate.toISOString().split('T')[0]} | status=${r.status} | isRescheduled=${r.isRescheduled} | from=${r.rescheduledFromId ?? '-'} | paid=${r.amountPaid} remaining=${r.remainingAmount}`,
    );
  }

  // The Apr 23 row's rescheduledFromId points to the old Apr 28 row.
  // Ensure the Apr 28 row is marked rescheduled.
  const aprTwentyThree = rows.find(
    (r) => r.dueDate.toISOString().split('T')[0] === '2026-04-23',
  );
  const aprTwentyEight = rows.find(
    (r) => r.dueDate.toISOString().split('T')[0] === '2026-04-28',
  );

  if (!aprTwentyEight) {
    console.log('No Apr 28 row found.');
    return;
  }
  if (aprTwentyThree && aprTwentyThree.rescheduledFromId !== aprTwentyEight.id) {
    console.log(
      'Apr 23 row does not link to Apr 28 row via rescheduledFromId. Aborting to be safe.',
    );
    return;
  }
  if (Number(aprTwentyEight.amountPaid) > 0) {
    console.log(
      'Apr 28 row has payments; will NOT delete. Only marking rescheduled.',
    );
  }

  await prisma.installment.update({
    where: { id: aprTwentyEight.id },
    data: {
      isRescheduled: true,
      status: 'rescheduled',
    },
  });

  console.log(`Marked Apr 28 row ${aprTwentyEight.id} as rescheduled.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
