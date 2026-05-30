/**
 * One-off correction for VE0030.
 *
 * Bug repro (see chat history 2026-05-30):
 *   1. Rollover on 2026-05-29 absorbed parent #4's remaining ₹4,073.50
 *      into #5 and #6 (+₹2,036.75 each). #4.remainingAmount → 0.
 *   2. User reverted the ₹5,000 payment on #4 and applied ₹234.40 of
 *      overdue interest in the same action.
 *   3. Revert path restored #4.amountDue to ₹9,307.90 and re-redistributed
 *      ALL ₹9,307.90 into #5 / #6 (+₹4,653.95 each) WITHOUT first un-doing
 *      the prior 2026-05-29 absorption. Result: ₹4,073.50 is counted twice
 *      in #5 + #6 (₹2,036.75 per row).
 *
 * Current state of VE0030's primaries #5 and #6:
 *   amountDue = remainingAmount = 20,300.95 each → sum 40,601.90
 * Correct state (totalPayable + interest = 36,294 + 234.40 = 36,528.40):
 *   amountDue = remainingAmount = 18,264.20 each → sum 36,528.40
 * Decrement to apply: 2,036.75 per row.
 *
 * Script is idempotent — refuses to run if values are already at/below the
 * expected corrected amount.
 */

import { Prisma, PrismaClient } from '@prisma/client';

const p = new PrismaClient();
const r2 = (n: number) => Math.round(n * 100) / 100;

const LEDGER = 'VE0030';
const EXPECTED_OVER_PER_ROW = 2036.75;
const EXPECTED_CURRENT_AMOUNT = 20300.95;
const EXPECTED_CORRECTED_AMOUNT = 18264.2;

(async () => {
  const sale = await p.saleRecord.findFirst({
    where: { ledgerNumber: LEDGER },
    include: { installmentSchedule: true },
  });
  if (!sale || !sale.installmentSchedule) {
    throw new Error(`No sale/schedule found for ledger ${LEDGER}`);
  }
  const scheduleId = sale.installmentSchedule.id;
  const tenantId = sale.installmentSchedule.tenantId;

  const rows = await p.installment.findMany({
    where: {
      scheduleId,
      parentInstallmentNumber: null,
      installmentNumber: { in: [5, 6] },
    },
    orderBy: { installmentNumber: 'asc' },
  });
  if (rows.length !== 2) {
    throw new Error(`Expected 2 primary rows (#5, #6) — got ${rows.length}`);
  }

  console.log('--- BEFORE ---');
  for (const r of rows) {
    console.log(
      `  #${r.installmentNumber}: amountDue=${r.amountDue} rem=${r.remainingAmount} status=${r.status}`,
    );
  }

  for (const r of rows) {
    const due = r2(Number(r.amountDue));
    if (Math.abs(due - EXPECTED_CURRENT_AMOUNT) > 0.01) {
      throw new Error(
        `Refusing to run — #${r.installmentNumber}.amountDue=${due} does not match the expected ` +
          `pre-correction value ${EXPECTED_CURRENT_AMOUNT}. Either the bug has already been corrected, ` +
          `or the row has been modified by another action since the chat-reported state.`,
      );
    }
  }

  await p.$transaction(async (tx) => {
    for (const r of rows) {
      await tx.installment.update({
        where: { id: r.id },
        data: {
          amountDue: { decrement: EXPECTED_OVER_PER_ROW },
          remainingAmount: { decrement: EXPECTED_OVER_PER_ROW },
        },
      });
    }

    await tx.installmentRollLog.create({
      data: {
        tenantId,
        scheduleId,
        eventType: 'manual_correction',
        eventDate: new Date(),
        actorUserId: null,
        displayMessage:
          `Manual correction: revert-payment on #4 double-counted ₹4,073.50 ` +
          `(the amount previously absorbed from #4 on 2026-05-29 was not un-absorbed before ` +
          `re-redistribution). Decremented #5 and #6 by ₹2,036.75 each so that ` +
          `sum equals totalPayable + interest = ₹36,528.40.`,
        metadata: {
          script: 'fix-ve0030-revert-double-count',
          ledger: LEDGER,
          decrementPerRow: EXPECTED_OVER_PER_ROW,
          rows: rows.map((r) => r.id),
          before: rows.map((r) => ({
            installmentNumber: r.installmentNumber,
            amountDue: Number(r.amountDue),
            remainingAmount: Number(r.remainingAmount),
          })),
          after: rows.map((r) => ({
            installmentNumber: r.installmentNumber,
            amountDue: EXPECTED_CORRECTED_AMOUNT,
            remainingAmount: EXPECTED_CORRECTED_AMOUNT,
          })),
        } as Prisma.InputJsonValue,
      },
    });
  });

  const after = await p.installment.findMany({
    where: { id: { in: rows.map((r) => r.id) } },
    orderBy: { installmentNumber: 'asc' },
  });
  console.log('\n--- AFTER ---');
  for (const r of after) {
    console.log(
      `  #${r.installmentNumber}: amountDue=${r.amountDue} rem=${r.remainingAmount} status=${r.status}`,
    );
  }

  const sumRem = after.reduce((a, r) => a + Number(r.remainingAmount), 0);
  console.log(`\nSum of #5 + #6 remaining = ₹${sumRem.toFixed(2)}`);
  console.log(`Expected outstanding      = ₹36,528.40 (36,294 totalPayable + 234.40 interest)`);

  await p.$disconnect();
})();
