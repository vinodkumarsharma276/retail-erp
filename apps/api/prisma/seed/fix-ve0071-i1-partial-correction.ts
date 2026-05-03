/**
 * Fix VE0071 installment #1 — incorrectly marked as 'paid' after a Modify
 * (correctPayment) that should have resulted in a partial payment.
 *
 * The old correctPayment code always set status='paid' and distributed the
 * shortfall to future rows. This script reverses that distribution and
 * restores the correct partially_paid state on installment #1.
 */

import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();
const r2 = (n: number) => Math.round(n * 100) / 100;

(async () => {
  // ── 1. Show all installments for VE0071 ───────────────────────────────
  const inst1 = await p.installment.findFirst({
    where: {
      schedule: { sale: { ledgerNumber: 'VE0071' } },
      installmentNumber: 1,
      parentInstallmentNumber: null,
    },
    include: {
      schedule: { select: { id: true } },
      payments: { orderBy: { paymentDate: 'desc' }, take: 1 },
    },
  });

  if (!inst1) throw new Error('Installment #1 not found for VE0071');

  const scheduleId = inst1.schedule.id;
  const amountDue = r2(Number(inst1.amountDue));
  const amountPaid = r2(Number(inst1.amountPaid));

  console.log('--- VE0071 Installment #1 BEFORE ---');
  console.log({ id: inst1.id, scheduleId, amountDue, amountPaid, remainingAmount: r2(Number(inst1.remainingAmount)), status: inst1.status });

  // Show all installments
  const allInsts = await p.installment.findMany({
    where: { scheduleId },
    orderBy: [{ installmentNumber: 'asc' }, { subSequence: 'asc' }],
    select: { id: true, installmentNumber: true, amountDue: true, amountPaid: true, remainingAmount: true, status: true },
  });
  console.log('\n--- All installments for VE0071 ---');
  allInsts.forEach(i => console.log(`  #${i.installmentNumber}  amountDue=${i.amountDue}  amountPaid=${i.amountPaid}  remaining=${i.remainingAmount}  status=${i.status}`));

  // ── 2. Find distribution logs sourced from installment #1 ─────────────
  const allCorrectionLogs = await p.installmentRollLog.findMany({
    where: {
      scheduleId,
      eventType: 'payment_corrected',
      installmentId: { not: inst1.id },
    },
    orderBy: { eventDate: 'desc' },
  });

  const distributionLogs = allCorrectionLogs.filter((log) => {
    const meta = log.metadata as Record<string, unknown>;
    return meta?.sourceInstallmentId === inst1.id;
  });

  console.log(`\nFound ${distributionLogs.length} distribution log(s) to undo:`);
  distributionLogs.forEach((log) => {
    const meta = log.metadata as Record<string, unknown>;
    console.log(`  installmentId=${log.installmentId}  delta=₹${meta.delta}`);
  });

  if (distributionLogs.length === 0) {
    console.log('\nNo distributions found — installment #1 data may already be correct. Checking...');
    if (amountPaid < amountDue) {
      console.log(`amountPaid (${amountPaid}) < amountDue (${amountDue}) but status=${inst1.status} — fixing status only.`);
    } else {
      console.log(`amountPaid (${amountPaid}) >= amountDue (${amountDue}) — installment is genuinely paid. No fix needed.`);
      await p.$disconnect();
      return;
    }
  }

  // ── 3. Find interest applied alongside the correction ─────────────────
  const interestApp = await p.installmentInterestApplication.findFirst({
    where: { installmentId: inst1.id, rolledBackAt: null },
    orderBy: { appliedAt: 'desc' },
  });
  const interestAmount = interestApp ? r2(Number(interestApp.appliedAmount)) : 0;
  console.log(`\nInterest alongside correction: ₹${interestAmount} (id=${interestApp?.id ?? 'none'})`);

  // ── 4. Run fix ─────────────────────────────────────────────────────────
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
      await tx.installmentRollLog.delete({ where: { id: log.id } });
      console.log(`  Undid ₹${delta} distribution on installment ${log.installmentId}`);
    }

    // Fix installment #1
    const newAmountDue = r2(amountDue + interestAmount);
    const newRemainingAmount = r2(newAmountDue - amountPaid);
    const newStatus = newRemainingAmount <= 0 ? 'paid' : 'partially_paid';

    await tx.installment.update({
      where: { id: inst1.id },
      data: { amountDue: newAmountDue, remainingAmount: newRemainingAmount, status: newStatus },
    });

    console.log('\n--- FIX APPLIED ---');
    console.log({ newAmountDue, newRemainingAmount, newStatus });
  });

  // ── 5. Verify ─────────────────────────────────────────────────────────
  const after = await p.installment.findUnique({ where: { id: inst1.id } });
  console.log('\n--- VE0071 Installment #1 AFTER ---');
  console.log({ amountDue: r2(Number(after?.amountDue)), amountPaid: r2(Number(after?.amountPaid)), remainingAmount: r2(Number(after?.remainingAmount)), status: after?.status });

  await p.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
