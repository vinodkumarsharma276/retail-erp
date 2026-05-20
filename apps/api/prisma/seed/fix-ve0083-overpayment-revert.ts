/**
 * One-off fix for ledger VE0083 — undo the data corruption caused by the
 * "pay #8 then revert" sequence on 2026-05-17 / 2026-05-18 (before Bug 3
 * was fixed).
 *
 * What we need to undo
 * --------------------
 * On 2026-05-17 a payment of ₹4,824 on installment #8 triggered R7 with
 * `waiveExcessInterest=true`, greedily clearing #10 and #11:
 *   #10:  amountDue -= 2412.25 (1958.08 closing + 454.17 interest waived)
 *         amountPaid += 1958.08
 *         status='paid'
 *   #11:  same as #10
 *   #12:  amountDue -= 907.84, remainingAmount -= 907.84 (no status change)
 *
 * The payment was then reverted on 2026-05-18, which deleted the ₹4,824
 * payment row and restored #8 to (paid=0, rem=0, status=overdue) — but did
 * NOT reverse any of the R7 mutations above. Result: #10/#11 stuck as
 * "paid" with phantom amountPaid=1958.08 and a broken
 * (amountDue ≠ amountPaid + remainingAmount) invariant.
 *
 * This script:
 *   1. Locates the May-17 `redistributed` log entry (reason='overpayment',
 *      sourcePrimary=8) on VE0083's schedule.
 *   2. For each target in metadata.targets, restores:
 *        amountDue   += delta + interestWaived
 *        amountPaid  -= delta            (if closedEarly === true)
 *        remainingAmount := amountDue - amountPaid
 *        status      := recomputed
 *   3. Deletes that redistributed log entry.
 *   4. Writes a `data_repair` log entry summarising the fix.
 *   5. Resets schedule.lastRolloverDate = null and runs ensureRolledForToday
 *      so R4 re-evaluates the chain.
 *
 * Usage:
 *   cd apps/api
 *   npx tsx prisma/seed/fix-ve0083-overpayment-revert.ts
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { ensureRolledForToday } from '../../src/modules/installments/installments.rules.js';

const prisma = new PrismaClient();

const LEDGER = 'VE0083';
const SOURCE_PRIMARY = 8;

function toDateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function formatINR(n: number): string {
  return `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function main() {
  const sale = await prisma.saleRecord.findFirst({
    where: { ledgerNumber: LEDGER },
    select: { id: true, saleNumber: true },
  });
  if (!sale) {
    console.log(`No sale for ${LEDGER}`);
    return;
  }
  const schedule = await prisma.installmentSchedule.findFirst({
    where: { saleId: sale.id },
    select: { id: true },
  });
  if (!schedule) {
    console.log(`No schedule for ${LEDGER}`);
    return;
  }

  // Find the May-17 R7 overpayment redistribute log for sourcePrimary=8.
  const r7Log = await prisma.installmentRollLog.findFirst({
    where: {
      scheduleId: schedule.id,
      eventType: 'redistributed',
      AND: [
        { metadata: { path: ['reason'], equals: 'overpayment' } as any },
        { metadata: { path: ['sourcePrimary'], equals: SOURCE_PRIMARY } as any },
      ],
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!r7Log || !r7Log.metadata) {
    console.log(
      `No matching R7 overpayment log for ${LEDGER} sourcePrimary=#${SOURCE_PRIMARY}. ` +
        `Nothing to repair — already clean or already repaired.`,
    );
    return;
  }

  const meta = r7Log.metadata as Prisma.JsonObject;
  const targets = (meta.targets ?? []) as Array<{
    id: string;
    delta: number;
    installmentNumber: number;
    paidOff?: boolean;
    interestWaived?: number;
    closedEarly?: boolean;
  }>;
  if (targets.length === 0) {
    console.log('R7 log has no targets — nothing to restore.');
    return;
  }

  console.log(`Repairing ledger ${LEDGER} (schedule ${schedule.id})`);
  console.log(`R7 log id=${r7Log.id} eventDate=${r7Log.eventDate.toISOString()}`);
  console.log('Targets to restore:');
  for (const t of targets) {
    console.log(
      `  #${t.installmentNumber}  delta=${t.delta} interestWaived=${t.interestWaived ?? 0}` +
        ` closedEarly=${!!t.closedEarly} paidOff=${!!t.paidOff}`,
    );
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  await prisma.$transaction(async (tx) => {
    const repairSummary: Array<{
      installmentNumber: number;
      before: { amountDue: number; amountPaid: number; remainingAmount: number; status: string };
      after: { amountDue: number; amountPaid: number; remainingAmount: number; status: string };
    }> = [];

    for (const t of targets) {
      const row = await tx.installment.findUnique({ where: { id: t.id } });
      if (!row) continue;

      const delta = Number(t.delta);
      const interestWaived = Number(t.interestWaived ?? 0);
      const wasGreedy = !!t.closedEarly;
      const addToDue = delta + interestWaived;

      const restoredAmountDue = Number(row.amountDue) + addToDue;
      const restoredAmountPaid = wasGreedy
        ? Math.max(0, Number(row.amountPaid) - delta)
        : Number(row.amountPaid);
      const restoredRem = Math.max(0, restoredAmountDue - restoredAmountPaid);

      let newStatus: string;
      if (restoredAmountPaid >= restoredAmountDue && restoredAmountDue > 0) {
        newStatus = 'paid';
      } else if (restoredAmountPaid > 0) {
        newStatus = 'partially_paid';
      } else {
        const dueDay = toDateOnly(row.dueDate).getTime();
        const todayDay = toDateOnly(today).getTime();
        newStatus = dueDay < todayDay
          ? 'overdue'
          : dueDay === todayDay
            ? 'due_today'
            : 'upcoming';
      }

      repairSummary.push({
        installmentNumber: t.installmentNumber,
        before: {
          amountDue: Number(row.amountDue),
          amountPaid: Number(row.amountPaid),
          remainingAmount: Number(row.remainingAmount),
          status: row.status,
        },
        after: {
          amountDue: restoredAmountDue,
          amountPaid: restoredAmountPaid,
          remainingAmount: restoredRem,
          status: newStatus,
        },
      });

      await tx.installment.update({
        where: { id: row.id },
        data: {
          amountDue: restoredAmountDue,
          amountPaid: restoredAmountPaid,
          remainingAmount: restoredRem,
          status: newStatus as any,
        },
      });
    }

    // Replace the stale R7 log with a data_repair entry.
    await tx.installmentRollLog.delete({ where: { id: r7Log.id } });
    await tx.installmentRollLog.create({
      data: {
        scheduleId: schedule.id,
        installmentId: null,
        eventType: 'data_repair',
        eventDate: new Date(),
        actorUserId: null,
        displayMessage:
          `Data repair: reversed the 2026-05-17 R7 overpayment distribution from #${SOURCE_PRIMARY} ` +
          `that was orphaned by the 2026-05-18 payment revert. Restored ${repairSummary.length} ` +
          `target installment(s) on ledger ${LEDGER} to their pre-overpayment state.`,
        metadata: {
          ledger: LEDGER,
          scheduleId: schedule.id,
          sourcePrimary: SOURCE_PRIMARY,
          deletedR7LogId: r7Log.id,
          repairSummary,
        } as Prisma.InputJsonValue,
      },
    });

    // Re-sync sale + schedule aggregates and re-run rollover for today.
    await tx.installmentSchedule.update({
      where: { id: schedule.id },
      data: { lastRolloverDate: null },
    });
    await ensureRolledForToday(tx, today, { scheduleId: schedule.id });
  });

  console.log();
  console.log('Repair complete. Final state:');
  const after = await prisma.installment.findMany({
    where: { scheduleId: schedule.id },
    orderBy: [{ installmentNumber: 'asc' }, { subSequence: 'asc' }],
    select: {
      installmentNumber: true,
      parentInstallmentNumber: true,
      subSequence: true,
      dueDate: true,
      amountDue: true,
      amountPaid: true,
      remainingAmount: true,
      status: true,
    },
  });
  for (const r of after) {
    const label =
      r.parentInstallmentNumber != null && r.subSequence != null
        ? `#${r.parentInstallmentNumber}.${r.subSequence}`
        : `#${r.installmentNumber}`;
    console.log(
      `  ${label.padEnd(6)} due=${r.dueDate.toISOString().slice(0, 10)} ` +
        `amountDue=${formatINR(Number(r.amountDue))} ` +
        `paid=${formatINR(Number(r.amountPaid))} ` +
        `rem=${formatINR(Number(r.remainingAmount))} ` +
        `status=${r.status}`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
