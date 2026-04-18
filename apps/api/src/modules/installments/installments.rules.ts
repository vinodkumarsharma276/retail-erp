/**
 * Installment Rule Engine
 * ---------------------------------------------------------------------------
 * Pure, idempotent functions that enforce the rolling-overdue installment
 * rules. Each function runs inside a Prisma transaction and writes to the
 * `installment_roll_log` table for auditability.
 *
 * Rules (see PLAN.md for full spec):
 *   A. markDueToday      — upcoming → due_today on the morning of dueDate.
 *   C. applyRuleC        — when primary N+1's dueDate arrives and the
 *                          previous chain (N + its subs) is still active,
 *                          close that chain (is_closed=true) and merge its
 *                          remainder into N+1's amountDue.
 *   D. applyPartialWithPromise
 *                        — record a partial payment + new promise date. If
 *                          newDate < N+1.dueDate, create/advance sub row.
 *                          Otherwise, close the chain and pre-merge into N+1.
 *
 * These functions are called from:
 *   - The list endpoints (lazy-on-read) for the scope being queried.
 *   - The admin manual run-rollover endpoint for ops/recovery.
 *   - The recordPayment flow (only Rule D).
 */

import type { Prisma, PrismaClient } from '@prisma/client';

type Tx = Prisma.TransactionClient | PrismaClient;

/** Strip time portion so date comparisons work reliably with @db.Date columns. */
function toDateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function formatDate(d: Date): string {
  return toDateOnly(d).toISOString().split('T')[0];
}

function formatINR(n: number): string {
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ---------------------------------------------------------------------------
// Rule A — markDueToday
// ---------------------------------------------------------------------------

/**
 * For all installments in the given scope whose dueDate <= today AND status
 * is still `upcoming`, flip them to `due_today`. Idempotent.
 *
 * Scope options:
 *   - scheduleId: only this schedule
 *   - shopId:     all active schedules in this shop (via sale.shopId)
 *   - undefined:  all active schedules (admin-only global sweep)
 */
export async function markDueToday(
  tx: Tx,
  today: Date,
  scope: { scheduleId?: string; shopId?: string },
): Promise<number> {
  const todayDate = toDateOnly(today);

  const where: Prisma.InstallmentWhereInput = {
    dueDate: { lte: todayDate },
    status: 'upcoming',
    isRescheduled: false,
    isClosed: false,
  };

  if (scope.scheduleId) {
    where.scheduleId = scope.scheduleId;
  } else if (scope.shopId) {
    where.schedule = {
      status: 'active',
      sale: { shopId: scope.shopId },
    };
  } else {
    where.schedule = { status: 'active' };
  }

  const toMark = await tx.installment.findMany({
    where,
    select: { id: true, scheduleId: true, installmentNumber: true, amountDue: true, dueDate: true },
  });

  if (toMark.length === 0) return 0;

  await tx.installment.updateMany({
    where: { id: { in: toMark.map((i) => i.id) } },
    data: { status: 'due_today' },
  });

  // Log one event per installment that just became due.
  await tx.installmentRollLog.createMany({
    data: toMark.map((i) => ({
      scheduleId: i.scheduleId,
      installmentId: i.id,
      eventType: 'installment_due',
      eventDate: toDateOnly(i.dueDate),
      displayMessage: `Installment #${i.installmentNumber} (${formatINR(Number(i.amountDue))}) became due.`,
      metadata: {
        installmentNumber: i.installmentNumber,
        amountDue: Number(i.amountDue),
      } as Prisma.InputJsonValue,
    })),
  });

  return toMark.length;
}

// ---------------------------------------------------------------------------
// Rule C — applyRuleC (absorb prior chain into next primary)
// ---------------------------------------------------------------------------

/**
 * For each primary installment N+1 whose dueDate has arrived, if primary N
 * (or its sub row) is still unpaid and not yet closed, we:
 *   1. Sum the remaining amount across N's active chain (N + any active sub).
 *   2. Add that carryover to N+1's amountDue and remainingAmount.
 *   3. Mark N and its subs as is_closed=true, status=overdue.
 *   4. Write a `chain_absorbed` roll log row.
 *
 * Idempotent: a chain with is_closed=true is skipped.
 */
export async function applyRuleC(
  tx: Tx,
  today: Date,
  scope: { scheduleId?: string; shopId?: string },
): Promise<number> {
  const todayDate = toDateOnly(today);

  // Find active "next primary" installments whose dueDate has arrived AND
  // whose schedule still has an earlier primary with an active/unclosed chain.
  const scheduleWhere: Prisma.InstallmentScheduleWhereInput = { status: 'active' };
  if (scope.scheduleId) {
    scheduleWhere.id = scope.scheduleId;
  } else if (scope.shopId) {
    scheduleWhere.sale = { shopId: scope.shopId };
  }

  const schedules = await tx.installmentSchedule.findMany({
    where: scheduleWhere,
    select: {
      id: true,
      installments: {
        where: { isRescheduled: false },
        orderBy: { installmentNumber: 'asc' },
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
          isClosed: true,
        },
      },
    },
  });

  let absorbedChains = 0;

  for (const schedule of schedules) {
    // Group installments by "chain" = primary installmentNumber.
    // A primary row has parentInstallmentNumber = null, subSequence = null.
    // Sub rows have parentInstallmentNumber = the primary's number.
    const chains = new Map<number, typeof schedule.installments>();
    for (const inst of schedule.installments) {
      const chainKey = inst.parentInstallmentNumber ?? inst.installmentNumber;
      const list = chains.get(chainKey) ?? [];
      list.push(inst);
      chains.set(chainKey, list);
    }

    const chainKeys = [...chains.keys()].sort((a, b) => a - b);

    for (let i = 0; i < chainKeys.length - 1; i++) {
      const currentKey = chainKeys[i];
      const nextKey = chainKeys[i + 1];
      const currentChain = chains.get(currentKey)!;
      const nextChain = chains.get(nextKey)!;

      // Next primary (parent row for that chain)
      const nextPrimary = nextChain.find(
        (inst) => inst.parentInstallmentNumber === null,
      );
      if (!nextPrimary) continue;

      // Rule C only fires on/after N+1's due date
      if (toDateOnly(nextPrimary.dueDate) > todayDate) continue;

      // Skip if current chain is already fully closed
      const activeRows = currentChain.filter(
        (inst) => !inst.isClosed && inst.status !== 'paid' && inst.status !== 'rescheduled',
      );
      if (activeRows.length === 0) continue;

      // Compute remaining to carry forward
      const carryover = activeRows.reduce(
        (sum, inst) => sum + Number(inst.remainingAmount),
        0,
      );
      if (carryover <= 0) continue;

      const daysOverdueFromPrimary =
        Math.floor(
          (todayDate.getTime() - toDateOnly(currentChain[0].dueDate).getTime()) /
            (1000 * 60 * 60 * 24),
        );

      // 1. Add carryover to next primary
      await tx.installment.update({
        where: { id: nextPrimary.id },
        data: {
          amountDue: { increment: carryover },
          remainingAmount: { increment: carryover },
        },
      });

      // 2. Close all active rows in the current chain
      await tx.installment.updateMany({
        where: { id: { in: activeRows.map((r) => r.id) } },
        data: {
          status: 'overdue',
          isClosed: true,
        },
      });

      // 3. Audit log
      const displayMessage =
        `Installment #${currentKey} chain closed. ${formatINR(carryover)} remaining was added to ` +
        `Installment #${nextPrimary.installmentNumber} (new total ${formatINR(Number(nextPrimary.amountDue) + carryover)}). ` +
        `Customer was ${daysOverdueFromPrimary} days overdue.`;

      await tx.installmentRollLog.create({
        data: {
          scheduleId: schedule.id,
          installmentId: nextPrimary.id,
          eventType: 'chain_absorbed',
          eventDate: todayDate,
          displayMessage,
          metadata: {
            closedChainIds: activeRows.map((r) => r.id),
            closedPrimaryNumber: currentKey,
            absorbedIntoId: nextPrimary.id,
            absorbedIntoNumber: nextPrimary.installmentNumber,
            amountCarried: carryover,
            daysOverdue: daysOverdueFromPrimary,
          } as Prisma.InputJsonValue,
        },
      });

      absorbedChains++;
    }
  }

  return absorbedChains;
}

// ---------------------------------------------------------------------------
// Rule D — applyPartialWithPromise (called from recordPayment)
// ---------------------------------------------------------------------------

/**
 * Record a partial payment with a new promise date. Branches:
 *   (a) newPromiseDate < nextPrimary.dueDate → create/advance a sub row
 *                                              (or create the first sub if none).
 *   (b) newPromiseDate >= nextPrimary.dueDate → close this chain and pre-merge
 *                                               remainder into nextPrimary.
 *
 * Caller (recordPayment) is responsible for:
 *   - Validating amountPaid < remainingAmount.
 *   - Creating the InstallmentPayment row.
 *   - Updating amountPaid/remainingAmount on the source installment.
 *
 * This function only handles the "what happens to the chain" side.
 *
 * Returns: { branch: 'sub_created' | 'sub_advanced' | 'absorbed', newSubId?, absorbedIntoId? }
 */
export async function applyPartialWithPromise(
  tx: Tx,
  args: {
    sourceInstallmentId: string;
    newPromiseDate: Date;
    remainderAfterPayment: number;
    actorUserId: string;
    employeeNote?: string;
    today: Date;
  },
): Promise<{
  branch: 'sub_created' | 'sub_advanced' | 'absorbed';
  newSubId?: string;
  absorbedIntoId?: string;
}> {
  const source = await tx.installment.findUnique({
    where: { id: args.sourceInstallmentId },
    select: {
      id: true,
      scheduleId: true,
      installmentNumber: true,
      parentInstallmentNumber: true,
      subSequence: true,
      dueDate: true,
      amountDue: true,
      amountPaid: true,
      remainingAmount: true,
    },
  });
  if (!source) throw new Error('Source installment not found');

  const primaryNumber = source.parentInstallmentNumber ?? source.installmentNumber;
  const todayDate = toDateOnly(args.today);
  const promiseDate = toDateOnly(args.newPromiseDate);

  // Find the next primary installment in this schedule (installmentNumber > primaryNumber,
  // parentInstallmentNumber = null, not rescheduled)
  const nextPrimary = await tx.installment.findFirst({
    where: {
      scheduleId: source.scheduleId,
      parentInstallmentNumber: null,
      installmentNumber: { gt: primaryNumber },
      isRescheduled: false,
    },
    orderBy: { installmentNumber: 'asc' },
    select: { id: true, installmentNumber: true, dueDate: true, amountDue: true },
  });

  // ---------- Branch (b): promise is on/after next primary → absorb ----------
  if (nextPrimary && promiseDate >= toDateOnly(nextPrimary.dueDate)) {
    // Close the entire current chain (primary + subs) and merge remainder into next primary.
    const chainRows = await tx.installment.findMany({
      where: {
        scheduleId: source.scheduleId,
        OR: [
          { installmentNumber: primaryNumber, parentInstallmentNumber: null },
          { parentInstallmentNumber: primaryNumber },
        ],
        isClosed: false,
        status: { notIn: ['paid', 'rescheduled'] },
      },
      select: { id: true, remainingAmount: true },
    });

    const carryover = chainRows.reduce((sum, r) => sum + Number(r.remainingAmount), 0);

    await tx.installment.update({
      where: { id: nextPrimary.id },
      data: {
        amountDue: { increment: carryover },
        remainingAmount: { increment: carryover },
      },
    });

    await tx.installment.updateMany({
      where: { id: { in: chainRows.map((r) => r.id) } },
      data: { status: 'overdue', isClosed: true },
    });

    await tx.installmentRollLog.create({
      data: {
        scheduleId: source.scheduleId,
        installmentId: nextPrimary.id,
        eventType: 'chain_absorbed',
        eventDate: todayDate,
        actorUserId: args.actorUserId,
        displayMessage:
          `Customer promised to pay on ${formatDate(promiseDate)} which falls on/after Installment ` +
          `#${nextPrimary.installmentNumber}'s due date (${formatDate(nextPrimary.dueDate)}). ` +
          `Installment #${primaryNumber} chain closed; ${formatINR(carryover)} added to Installment ` +
          `#${nextPrimary.installmentNumber} (new total ${formatINR(Number(nextPrimary.amountDue) + carryover)}).` +
          (args.employeeNote ? ` Note: ${args.employeeNote}` : ''),
        metadata: {
          closedChainIds: chainRows.map((r) => r.id),
          closedPrimaryNumber: primaryNumber,
          absorbedIntoId: nextPrimary.id,
          absorbedIntoNumber: nextPrimary.installmentNumber,
          amountCarried: carryover,
          promisedDate: formatDate(promiseDate),
        } as Prisma.InputJsonValue,
      },
    });

    return { branch: 'absorbed', absorbedIntoId: nextPrimary.id };
  }

  // ---------- Branch (a): promise is before next primary (or no next) → sub row ----------

  // If source is already a sub row, just advance its dueDate and amount.
  if (source.subSequence !== null && source.parentInstallmentNumber !== null) {
    await tx.installment.update({
      where: { id: source.id },
      data: {
        dueDate: promiseDate,
        amountDue: args.remainderAfterPayment,
        remainingAmount: args.remainderAfterPayment,
        status: promiseDate.getTime() === todayDate.getTime() ? 'due_today' : 'upcoming',
        notes: args.employeeNote ?? source.id,
      },
    });

    await tx.installmentRollLog.create({
      data: {
        scheduleId: source.scheduleId,
        installmentId: source.id,
        eventType: 'sub_created',
        eventDate: todayDate,
        actorUserId: args.actorUserId,
        displayMessage:
          `Customer made a partial payment. Remaining ${formatINR(args.remainderAfterPayment)} ` +
          `rescheduled to ${formatDate(promiseDate)} (Installment #${source.parentInstallmentNumber}.${source.subSequence}).` +
          (args.employeeNote ? ` Note: ${args.employeeNote}` : ''),
        metadata: {
          subInstallmentId: source.id,
          parentNumber: source.parentInstallmentNumber,
          subSequence: source.subSequence,
          remainder: args.remainderAfterPayment,
          newDueDate: formatDate(promiseDate),
        } as Prisma.InputJsonValue,
      },
    });

    return { branch: 'sub_advanced', newSubId: source.id };
  }

  // Source is a primary row → create the next sub (k+1). Find the highest subSequence so far.
  const existingSubs = await tx.installment.findMany({
    where: {
      scheduleId: source.scheduleId,
      parentInstallmentNumber: primaryNumber,
    },
    orderBy: { subSequence: 'desc' },
    take: 1,
    select: { subSequence: true },
  });
  const nextSubSeq = (existingSubs[0]?.subSequence ?? 0) + 1;

  // Mark the source primary as rescheduled (chain pointer).
  await tx.installment.update({
    where: { id: source.id },
    data: {
      isRescheduled: true,
      status: 'rescheduled',
    },
  });

  const newSub = await tx.installment.create({
    data: {
      scheduleId: source.scheduleId,
      installmentNumber: primaryNumber,
      parentInstallmentNumber: primaryNumber,
      subSequence: nextSubSeq,
      dueDate: promiseDate,
      amountDue: args.remainderAfterPayment,
      amountPaid: 0,
      remainingAmount: args.remainderAfterPayment,
      status: promiseDate.getTime() === todayDate.getTime() ? 'due_today' : 'upcoming',
      isRescheduled: false,
      rescheduledFromId: source.id,
      notes: args.employeeNote ?? null,
    },
  });

  await tx.installmentRollLog.create({
    data: {
      scheduleId: source.scheduleId,
      installmentId: newSub.id,
      eventType: 'sub_created',
      eventDate: todayDate,
      actorUserId: args.actorUserId,
      displayMessage:
        `Customer made a partial payment on Installment #${primaryNumber}. Remaining ` +
        `${formatINR(args.remainderAfterPayment)} rescheduled to ${formatDate(promiseDate)} ` +
        `as Installment #${primaryNumber}.${nextSubSeq}.` +
        (args.employeeNote ? ` Note: ${args.employeeNote}` : ''),
      metadata: {
        parentInstallmentId: source.id,
        parentNumber: primaryNumber,
        newSubId: newSub.id,
        subSequence: nextSubSeq,
        remainder: args.remainderAfterPayment,
        newDueDate: formatDate(promiseDate),
      } as Prisma.InputJsonValue,
    },
  });

  return { branch: 'sub_created', newSubId: newSub.id };
}

// ---------------------------------------------------------------------------
// Orchestrator — ensureRolledForToday
// ---------------------------------------------------------------------------

/**
 * Runs the full daily rule engine for a scope. Called lazily from list
 * endpoints and from the admin manual run-rollover endpoint.
 *
 * Order matters:
 *   1. applyRuleC first — absorb stale chains into their next primary (this
 *      may cause a row to transition to due_today naturally).
 *   2. markDueToday second — flip upcoming→due_today for anything now due.
 */
export async function ensureRolledForToday(
  tx: Tx,
  today: Date,
  scope: { scheduleId?: string; shopId?: string },
): Promise<{ chainsAbsorbed: number; markedDueToday: number }> {
  const chainsAbsorbed = await applyRuleC(tx, today, scope);
  const markedDueToday = await markDueToday(tx, today, scope);
  return { chainsAbsorbed, markedDueToday };
}
