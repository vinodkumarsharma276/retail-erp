/**
 * One-off fix: backfill parentInstallmentNumber + subSequence on installments
 * that were created by a reschedule of a sub-row, before the fix landed.
 *
 * Scoped to ledger VE0072 only.
 *
 * Usage:
 *   npx tsx prisma/seed/fix-ve0072-reschedule.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const ledgerNumber = 'VE0072';

  const sale = await prisma.saleRecord.findFirst({
    where: { ledgerNumber },
    select: { id: true, saleNumber: true, ledgerNumber: true },
  });

  if (!sale) {
    console.log(`No sale found for ledger ${ledgerNumber}`);
    return;
  }

  const schedule = await prisma.installmentSchedule.findFirst({
    where: { saleId: sale.id },
    select: { id: true },
  });

  if (!schedule) {
    console.log(`No schedule for sale ${sale.saleNumber}`);
    return;
  }

  // Find installments on this schedule that were rescheduled from a sub-row
  // but lost their parent/subSequence markers.
  const candidates = await prisma.installment.findMany({
    where: {
      scheduleId: schedule.id,
      rescheduledFromId: { not: null },
      parentInstallmentNumber: null,
    },
    include: {
      rescheduledFrom: {
        select: {
          id: true,
          installmentNumber: true,
          parentInstallmentNumber: true,
          subSequence: true,
          dueDate: true,
        },
      },
    },
  });

  console.log(`Found ${candidates.length} candidate row(s) on ${ledgerNumber}`);

  let fixed = 0;
  for (const inst of candidates) {
    const src = inst.rescheduledFrom;
    if (!src) continue;
    if (src.parentInstallmentNumber == null || src.subSequence == null) {
      console.log(
        `  #${inst.installmentNumber} (${inst.dueDate.toISOString().split('T')[0]}) — source was a primary row, skipping`,
      );
      continue;
    }

    await prisma.installment.update({
      where: { id: inst.id },
      data: {
        parentInstallmentNumber: src.parentInstallmentNumber,
        subSequence: src.subSequence,
      },
    });

    console.log(
      `  fixed ${inst.id}: now #${src.parentInstallmentNumber}.${src.subSequence} ` +
        `on ${inst.dueDate.toISOString().split('T')[0]} ` +
        `(was rescheduled from #${src.parentInstallmentNumber}.${src.subSequence} on ${src.dueDate.toISOString().split('T')[0]})`,
    );
    fixed++;
  }

  console.log(`\nDone. Fixed ${fixed} row(s) on ${ledgerNumber}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
