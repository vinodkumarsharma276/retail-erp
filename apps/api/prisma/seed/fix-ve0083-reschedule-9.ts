/**
 * One-off fix: convert the wrongly-created primary row for ledger VE0083's
 * installment #9 reschedule into a proper sub-row (#9.1).
 *
 * Background
 * ----------
 * Installment #9 (originally due 2026-05-12) was rescheduled to 2026-05-20.
 * Pre-fix behaviour created a *new* primary row also numbered #9 on the new
 * date and marked the original as `status='rescheduled' / isRescheduled=true`
 * — instead of creating a sub-row #9.1 below the still-visible original #9.
 *
 * This script:
 *   1. Locates the rescheduled chain for VE0083 / #9.
 *   2. Converts the new row into a sub-row (parentInstallmentNumber=9,
 *      subSequence=next available).
 *   3. Restores the original #9: clears `isRescheduled`, sets status to
 *      'overdue' (its actual state — past due, unpaid), zeroes
 *      remainingAmount (obligation moved to the sub-row), and rewrites the
 *      notes to record the reschedule.
 *   4. Replaces the 'rescheduled' roll log entry with a 'sub_created' entry
 *      matching what applyPartialWithPromise would emit going forward.
 *   5. Re-syncs the schedule via syncScheduleAndSale.
 *
 * Usage:
 *   cd apps/api
 *   npx tsx prisma/seed/fix-ve0083-reschedule-9.ts
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { syncScheduleAndSale } from '../../src/modules/installments/installments.rules.js';

const prisma = new PrismaClient();

const LEDGER = 'VE0083';
const PRIMARY_NUMBER = 9;

function formatINR(n: number): string {
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(d: Date): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    .toISOString()
    .split('T')[0];
}

async function main() {
  const sale = await prisma.saleRecord.findFirst({
    where: { ledgerNumber: LEDGER },
    select: { id: true, saleNumber: true, ledgerNumber: true },
  });
  if (!sale) {
    console.log(`No sale found for ledger ${LEDGER}`);
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

  // Locate the (wrongly-created) new primary row for #9: rescheduledFromId
  // points back to the original #9, parent is null, and it carries the new
  // due date.
  const newRow = await prisma.installment.findFirst({
    where: {
      scheduleId: schedule.id,
      installmentNumber: PRIMARY_NUMBER,
      parentInstallmentNumber: null,
      rescheduledFromId: { not: null },
      isRescheduled: false,
    },
    orderBy: { createdAt: 'desc' },
    include: {
      rescheduledFrom: {
        select: {
          id: true,
          installmentNumber: true,
          parentInstallmentNumber: true,
          subSequence: true,
          dueDate: true,
          amountDue: true,
          amountPaid: true,
          remainingAmount: true,
          status: true,
          isRescheduled: true,
          notes: true,
        },
      },
    },
  });

  if (!newRow || !newRow.rescheduledFrom) {
    console.log(`No wrongly-rescheduled #${PRIMARY_NUMBER} row found on ${LEDGER}.`);
    return;
  }

  const original = newRow.rescheduledFrom;

  // Sanity: original should currently be marked rescheduled.
  if (!original.isRescheduled) {
    console.log(
      `Source #${original.installmentNumber} (id=${original.id}) is not marked isRescheduled — nothing to do.`,
    );
    return;
  }

  // Compute next sub-sequence on the primary's chain (excluding the new row
  // we are about to convert).
  const existingSubs = await prisma.installment.findMany({
    where: {
      scheduleId: schedule.id,
      parentInstallmentNumber: PRIMARY_NUMBER,
      id: { not: newRow.id },
    },
    orderBy: { subSequence: 'desc' },
    take: 1,
    select: { subSequence: true },
  });
  const nextSubSeq = (existingSubs[0]?.subSequence ?? 0) + 1;

  const fromDateStr = formatDate(original.dueDate);
  const toDateStr = formatDate(newRow.dueDate);
  const remainder = Number(newRow.amountDue);

  console.log('Fix plan:');
  console.log(`  Ledger:    ${LEDGER}`);
  console.log(`  Schedule:  ${schedule.id}`);
  console.log(`  Original:  #${original.installmentNumber} id=${original.id}`);
  console.log(`             due=${fromDateStr} amountDue=${original.amountDue} amountPaid=${original.amountPaid}`);
  console.log(`  New row:   #${newRow.installmentNumber} id=${newRow.id}`);
  console.log(`             due=${toDateStr} amountDue=${newRow.amountDue}`);
  console.log(`  -> will become sub-row #${PRIMARY_NUMBER}.${nextSubSeq}`);
  console.log();

  await prisma.$transaction(async (tx) => {
    // 1. Convert the new row to a sub-row.
    await tx.installment.update({
      where: { id: newRow.id },
      data: {
        parentInstallmentNumber: PRIMARY_NUMBER,
        subSequence: nextSubSeq,
        // Keep installmentNumber = PRIMARY_NUMBER so the label renders as
        // "#9.1" via formatInstallmentLabel.
        notes:
          newRow.notes ?? null,
      },
    });

    // 2. Restore the original row.
    //    - Clear isRescheduled / status='rescheduled'
    //    - The obligation now lives on the sub-row; original keeps
    //      remainingAmount = 0 (which is already the case after the buggy
    //      reschedule, but enforce it).
    //    - Status: if amountPaid === 0 -> 'overdue' (12/05 has passed), else
    //      'partially_paid'.
    const amountPaid = Number(original.amountPaid);
    const amountDue = Number(original.amountDue);
    const newSourceStatus: 'overdue' | 'partially_paid' | 'paid' =
      amountPaid === 0
        ? 'overdue'
        : amountPaid < amountDue
          ? 'partially_paid'
          : 'paid';

    // Notes: include the reschedule date, preserving any pre-existing user
    // note from the original row. The old notes were either user-supplied or
    // the auto-string "Rescheduled to <newDate>"; rewrite them consistently.
    const existingNote = (original.notes ?? '').trim();
    const baseNote = `Rescheduled to ${toDateStr}.`;
    const restoredNote =
      existingNote && !existingNote.toLowerCase().startsWith('rescheduled to')
        ? `${baseNote} ${existingNote}`
        : baseNote;

    await tx.installment.update({
      where: { id: original.id },
      data: {
        isRescheduled: false,
        status: newSourceStatus,
        remainingAmount: 0,
        notes: restoredNote,
      },
    });

    // 3. Replace the 'rescheduled' roll log entries for the original with a
    //    'sub_created' entry matching applyPartialWithPromise output.
    await tx.installmentRollLog.deleteMany({
      where: {
        scheduleId: schedule.id,
        installmentId: original.id,
        eventType: 'rescheduled',
      },
    });

    await tx.installmentRollLog.create({
      data: {
        scheduleId: schedule.id,
        installmentId: newRow.id,
        eventType: 'sub_created',
        eventDate: newRow.createdAt,
        actorUserId: null,
        displayMessage:
          `Customer committed ${toDateStr} for the remaining ${formatINR(remainder)} ` +
          `on Installment #${PRIMARY_NUMBER}. New sub-row #${PRIMARY_NUMBER}.${nextSubSeq} created. ` +
          `(Backfilled from prior 'rescheduled' event.)`,
        metadata: {
          parentInstallmentId: original.id,
          parentNumber: PRIMARY_NUMBER,
          newSubId: newRow.id,
          subSequence: nextSubSeq,
          remainder,
          newDueDate: toDateStr,
          backfilled: true,
          originalDueDate: fromDateStr,
        } as Prisma.InputJsonValue,
      },
    });

    // 4. Re-sync schedule + sale aggregates.
    await syncScheduleAndSale(tx, schedule.id);
  });

  console.log('Done. Verifying:');
  const after = await prisma.installment.findMany({
    where: { scheduleId: schedule.id, OR: [{ installmentNumber: PRIMARY_NUMBER }, { parentInstallmentNumber: PRIMARY_NUMBER }] },
    orderBy: [{ installmentNumber: 'asc' }, { subSequence: 'asc' }],
    select: {
      id: true,
      installmentNumber: true,
      parentInstallmentNumber: true,
      subSequence: true,
      dueDate: true,
      amountDue: true,
      amountPaid: true,
      remainingAmount: true,
      status: true,
      isRescheduled: true,
      notes: true,
    },
  });
  for (const r of after) {
    const label =
      r.parentInstallmentNumber != null && r.subSequence != null
        ? `#${r.parentInstallmentNumber}.${r.subSequence}`
        : `#${r.installmentNumber}`;
    console.log(
      `  ${label.padEnd(6)} due=${formatDate(r.dueDate)} amountDue=${r.amountDue} ` +
        `paid=${r.amountPaid} remaining=${r.remainingAmount} status=${r.status} ` +
        `isResched=${r.isRescheduled} notes=${JSON.stringify(r.notes)}`,
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
