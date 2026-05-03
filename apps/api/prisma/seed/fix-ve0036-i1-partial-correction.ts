/**
 * Fix VE0036 installment #1 — incorrectly marked as 'paid' after a Modify
 * (correctPayment) that resulted in a partial payment.
 *
 * Root cause: correctPayment always set status='paid' regardless of whether
 * correctAmount < amountDue.
 *
 * This script:
 * 1. Finds installment #1 for VE0036.
 * 2. Reads any 'payment_corrected' roll-log entries that distributed the
 *    shortfall to other rows (identified by metadata.sourceInstallmentId).
 * 3. Undoes those distributions (decrements amountDue + remainingAmount).
 * 4. If an interest application was recorded alongside the correction (and
 *    not yet rolled back), moves it from the distributed amount onto this
 *    installment's amountDue.
 * 5. Fixes installment #1: remainingAmount = amountDue - amountPaid,
 *    status = 'partially_paid'.
 */

import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();
const r2 = (n: number) => Math.round(n * 100) / 100;

(async () => {
  // ── 1. Find installment #1 for VE0036 ─────────────────────────────────
  const inst1 = await p.installment.findFirst({
    where: {
      schedule: { sale: { ledgerNumber: 'VE0036' } },
      installmentNumber: 1,
      parentInstallmentNumber: null,
    },
    include: {
      schedule: { select: { id: true } },
      payments: { orderBy: { paymentDate: 'desc' }, take: 1 },
    },
  });

  if (!inst1) throw new Error('Installment #1 not found for VE0036');

  const amountDue = r2(Number(inst1.amountDue));
  const amountPaid = r2(Number(inst1.amountPaid));

  console.log('--- VE0036 Installment #1 BEFORE ---');
  console.log({
    id: inst1.id,
    scheduleId: inst1.schedule.id,
    amountDue,
    amountPaid,
    remainingAmount: r2(Number(inst1.remainingAmount)),
    status: inst1.status,
  });

  // ── 2. Find distribution logs sourced from this installment ───────────
  const allCorrectionLogs = await p.installmentRollLog.findMany({
    where: {
      scheduleId: inst1.schedule.id,
      eventType: 'payment_corrected',
      installmentId: { not: inst1.id }, // destinations, not the source log
    },
    orderBy: { eventDate: 'desc' },
  });

  // Filter by metadata.sourceInstallmentId === inst1.id
  const distributionLogs = allCorrectionLogs.filter((log) => {
    const meta = log.metadata as Record<string, unknown>;
    return meta?.sourceInstallmentId === inst1.id;
  });

  console.log(`\nFound ${distributionLogs.length} distribution log(s) to undo:`);
  distributionLogs.forEach((log) => {
    const meta = log.metadata as Record<string, unknown>;
    console.log(`  installmentId=${log.installmentId}  delta=₹${meta.delta}`);
  });

  // ── 3. Find any interest application made alongside this correction ────
  // The interest was included in the distribution, not added to amountDue.
  // We need to add it to amountDue and remove it from the distributed amounts.
  const interestApp = await p.installmentInterestApplication.findFirst({
    where: {
      installmentId: inst1.id,
      rolledBackAt: null,
      // Only ones linked to a correction (have appliedAlongsideCorrection in notes or created same day)
    },
    orderBy: { appliedAt: 'desc' },
  });

  const interestAmount = interestApp ? r2(Number(interestApp.appliedAmount)) : 0;
  console.log(`\nInterest application alongside correction: ₹${interestAmount} (id=${interestApp?.id ?? 'none'})`);

  // ── 4. Run fix in a transaction ────────────────────────────────────────
  await p.$transaction(async (tx) => {
    // Undo distributions to other rows
    for (const log of distributionLogs) {
      const meta = log.metadata as Record<string, unknown>;
      const delta = r2(Number(meta.delta));

      await tx.installment.update({
        where: { id: log.installmentId! },
        data: {
          amountDue: { decrement: delta },
          remainingAmount: { decrement: delta },
        },
      });

      // Remove the distribution log entry
      await tx.installmentRollLog.delete({ where: { id: log.id } });
      console.log(`  Undid ₹${delta} distribution on installment ${log.installmentId}`);
    }

    // Fix installment #1: interest (if any) stays on amountDue here
    const newAmountDue = r2(amountDue + interestAmount);
    const newRemainingAmount = r2(newAmountDue - amountPaid);
    const newStatus = newRemainingAmount <= 0 ? 'paid' : 'partially_paid';

    await tx.installment.update({
      where: { id: inst1.id },
      data: {
        amountDue: newAmountDue,
        remainingAmount: newRemainingAmount,
        status: newStatus,
      },
    });

    // Update the source log message to reflect the correction
    await tx.installmentRollLog.updateMany({
      where: {
        scheduleId: inst1.schedule.id,
        installmentId: inst1.id,
        eventType: 'payment_corrected',
      },
      data: {
        displayMessage: `[Fixed] Payment on installment #1 corrected. AmountPaid=₹${amountPaid}. Shortfall ₹${newRemainingAmount} remains on this installment (status: ${newStatus}).`,
      },
    });

    console.log('\n--- FIX APPLIED ---');
    console.log({ newAmountDue, newRemainingAmount, newStatus });
  });

  // ── 5. Verify ─────────────────────────────────────────────────────────
  const after = await p.installment.findUnique({ where: { id: inst1.id } });
  console.log('\n--- VE0036 Installment #1 AFTER ---');
  console.log({
    amountDue: r2(Number(after?.amountDue)),
    amountPaid: r2(Number(after?.amountPaid)),
    remainingAmount: r2(Number(after?.remainingAmount)),
    status: after?.status,
  });

  await p.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
