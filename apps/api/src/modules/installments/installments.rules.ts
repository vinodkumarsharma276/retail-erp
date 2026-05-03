/**
 * Installment Rule Engine (v2 — redistribution model)
 * ---------------------------------------------------------------------------
 * Pure functions that enforce the rolling-overdue installment rules.
 *
 * Rules:
 *   R1. markOverdueForToday — on the morning of (or after) dueDate, upcoming →
 *       overdue if nothing was paid that day; row keeps appearing daily.
 *
 *   R2. applyPartialWithPromise — customer pays (partial/zero) + commits a
 *       new date ≤ next primary's due date → create #N.(k+1) sub row with
 *       the remainder; current row becomes partially_paid / overdue.
 *
 *   R3. applyRedistribution — customer pays (partial/zero) + commits a new
 *       date > next primary's due date → distribute the chain's remainder
 *       equally across all future primaries that still owe; current chain's
 *       remainingAmount drops to zero but statuses stay (overdue /
 *       partially_paid). No "closed" flag is used.
 *
 *   R4. applyDailyRollover — when #N+1's due date arrives and the #N chain
 *       still owes money and no fresh promise was captured, redistribute
 *       automatically. Same math as R3.
 *
 *   R5. Sub-row day-of logic — sub rows behave exactly like primaries for
 *       R1/R2/R3 purposes. R4 only fires against the parent primary's
 *       aggregate remainder.
 *
 *   R6. syncScheduleAndSale — after every mutation, recompute schedule
 *       aggregates and sale.pendingAmount; if everything is settled, set
 *       sale.completedAt and schedule.status='completed'.
 *
 *   R7. distributeOverpayment — when a customer pays more than the current
 *       row's remaining, the excess is spread equally across every future
 *       primary that still owes money (amountDue *and* remainingAmount are
 *       reduced by the same delta). Symmetric counterpart of R4.
 */

import type { Prisma, PrismaClient } from '@prisma/client';

type Tx = Prisma.TransactionClient | PrismaClient;

function toDateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function formatDate(d: Date): string {
  return toDateOnly(d).toISOString().split('T')[0];
}

function formatINR(n: number): string {
  return `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Round to 2 decimals (paise) to keep sums exact. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Helper — load full chain view for a schedule
// ---------------------------------------------------------------------------

interface ChainRow {
  id: string;
  installmentNumber: number;
  parentInstallmentNumber: number | null;
  subSequence: number | null;
  dueDate: Date;
  amountDue: number;
  amountPaid: number;
  remainingAmount: number;
  status: string;
  isRescheduled: boolean;
}

async function loadChains(tx: Tx, scheduleId: string): Promise<ChainRow[]> {
  const rows = await tx.installment.findMany({
    where: { scheduleId },
    orderBy: [{ installmentNumber: 'asc' }, { subSequence: 'asc' }],
  });
  return rows.map((r) => ({
    id: r.id,
    installmentNumber: r.installmentNumber,
    parentInstallmentNumber: r.parentInstallmentNumber,
    subSequence: r.subSequence,
    dueDate: r.dueDate,
    amountDue: Number(r.amountDue),
    amountPaid: Number(r.amountPaid),
    remainingAmount: Number(r.remainingAmount),
    status: r.status,
    isRescheduled: r.isRescheduled,
  }));
}

/** Returns the set of rows (primary + sub rows) belonging to primary #N. */
function rowsForPrimary(chains: ChainRow[], primaryNumber: number): ChainRow[] {
  return chains.filter(
    (r) => (r.parentInstallmentNumber ?? r.installmentNumber) === primaryNumber,
  );
}

/** Primary rows only (no sub rows), sorted by installmentNumber. */
function primariesOnly(chains: ChainRow[]): ChainRow[] {
  return chains
    .filter((r) => r.parentInstallmentNumber === null)
    .sort((a, b) => a.installmentNumber - b.installmentNumber);
}

/** Aggregate remaining for primary #N across its primary + sub rows. */
function remainingForPrimary(chains: ChainRow[], primaryNumber: number): number {
  return rowsForPrimary(chains, primaryNumber).reduce(
    (sum, r) => sum + r.remainingAmount,
    0,
  );
}

// ---------------------------------------------------------------------------
// R6 — syncScheduleAndSale
// ---------------------------------------------------------------------------

/**
 * Recomputes derived values and persists them:
 *   - installment.remainingAmount (safety: amountDue − amountPaid, never < 0)
 *   - schedule.status: 'completed' when sum(remaining) == 0 across non-rescheduled rows
 *   - schedule.lastRolloverDate: set when rollover runs (passed in)
 *   - sale.pendingAmount: sum(remaining) across non-rescheduled rows
 *   - sale.completedAt: set (if null) when schedule becomes completed
 *
 * Writes a `schedule_completed` roll log when completion transitions.
 */
export async function syncScheduleAndSale(
  tx: Tx,
  scheduleId: string,
  actorUserId?: string,
): Promise<{ completed: boolean }> {
  const schedule = await tx.installmentSchedule.findUnique({
    where: { id: scheduleId },
    select: {
      id: true,
      status: true,
      saleId: true,
      sale: { select: { id: true, completedAt: true, saleNumber: true } },
    },
  });
  if (!schedule) return { completed: false };

  const rows = await tx.installment.findMany({
    where: { scheduleId, isRescheduled: false },
    select: { id: true, amountDue: true, amountPaid: true, remainingAmount: true },
  });

  const totalRemaining = round2(
    rows.reduce((s, r) => s + Number(r.remainingAmount), 0),
  );

  await tx.saleRecord.update({
    where: { id: schedule.saleId },
    data: { pendingAmount: totalRemaining },
  });

  const wasCompleted = schedule.status === 'completed';
  const nowCompleted = totalRemaining === 0;

  if (nowCompleted && !wasCompleted) {
    const completedAt = new Date();
    await tx.installmentSchedule.update({
      where: { id: scheduleId },
      data: { status: 'completed' },
    });
    await tx.saleRecord.update({
      where: { id: schedule.saleId },
      data: { completedAt: schedule.sale.completedAt ?? completedAt },
    });
    await tx.installmentRollLog.create({
      data: {
        scheduleId,
        eventType: 'schedule_completed',
        eventDate: toDateOnly(completedAt),
        actorUserId: actorUserId ?? null,
        displayMessage: `All installments settled. Sale ${schedule.sale.saleNumber} marked as completed.`,
        metadata: { scheduleId, saleId: schedule.saleId } as Prisma.InputJsonValue,
      },
    });
  } else if (!nowCompleted && wasCompleted) {
    // Reopened (e.g., through a correction). Clear completedAt.
    await tx.installmentSchedule.update({
      where: { id: scheduleId },
      data: { status: 'active' },
    });
    await tx.saleRecord.update({
      where: { id: schedule.saleId },
      data: { completedAt: null },
    });
  }

  return { completed: nowCompleted };
}

// ---------------------------------------------------------------------------
// R1 — markOverdueForToday
// ---------------------------------------------------------------------------

/**
 * For rows whose dueDate <= today with status 'upcoming' / 'due_today' and
 * remaining > 0, flip status to 'overdue'. Idempotent.
 *
 * Legacy: also promotes 'upcoming' → 'due_today' first for visibility; the
 * service's collection queries treat both 'due_today' and 'overdue' as live.
 */
export async function markOverdueForToday(
  tx: Tx,
  today: Date,
  scope: { scheduleId?: string; shopId?: string; shopIds?: string[] },
): Promise<number> {
  const todayDate = toDateOnly(today);

  const where: Prisma.InstallmentWhereInput = {
    dueDate: { lte: todayDate },
    status: { in: ['upcoming', 'due_today'] },
    isRescheduled: false,
    remainingAmount: { gt: 0 },
  };

  if (scope.scheduleId) {
    where.scheduleId = scope.scheduleId;
  } else if (scope.shopIds && scope.shopIds.length > 0) {
    where.schedule = { status: 'active', sale: { shopId: { in: scope.shopIds } } };
  } else if (scope.shopId) {
    where.schedule = { status: 'active', sale: { shopId: scope.shopId } };
  } else {
    where.schedule = { status: 'active' };
  }

  const rows = await tx.installment.findMany({
    where,
    select: { id: true, dueDate: true, scheduleId: true, installmentNumber: true, subSequence: true },
  });
  if (rows.length === 0) return 0;

  // Split into: rows whose dueDate === today → due_today, and rows whose
  // dueDate < today → overdue.
  const dueToday: string[] = [];
  const overdue: string[] = [];
  for (const r of rows) {
    if (toDateOnly(r.dueDate).getTime() === todayDate.getTime()) {
      dueToday.push(r.id);
    } else {
      overdue.push(r.id);
    }
  }

  if (dueToday.length > 0) {
    await tx.installment.updateMany({
      where: { id: { in: dueToday }, status: 'upcoming' },
      data: { status: 'due_today' },
    });
  }
  if (overdue.length > 0) {
    await tx.installment.updateMany({
      where: { id: { in: overdue } },
      data: { status: 'overdue' },
    });
  }

  return rows.length;
}

// ---------------------------------------------------------------------------
// R3 / R4 — redistribute a primary's chain remainder across future primaries
// ---------------------------------------------------------------------------

/**
 * Core redistribution helper. Given a primary #N whose chain still owes
 * `carryover` (computed from current rows), spread that amount equally
 * across future primaries (installmentNumber > N) that still have remaining > 0.
 *
 * On the source chain we set remainingAmount=0 on each row and update status:
 *   - amountPaid === 0           → 'overdue'
 *   - 0 < amountPaid < amountDue → 'partially_paid'
 *   - else already paid and untouched
 *
 * Writes a 'redistributed' roll log row with metadata.targets = [{id, delta}].
 * If there are no eligible future primaries this is a no-op.
 */
async function redistributePrimaryChain(
  tx: Tx,
  args: {
    scheduleId: string;
    primaryNumber: number;
    today: Date;
    actorUserId?: string;
    reason: 'auto_next_due' | 'promise_after_next';
    promisedDate?: Date;
    employeeNote?: string;
  },
): Promise<{ carryover: number; targets: { id: string; delta: number; installmentNumber: number }[] }> {
  const chains = await loadChains(tx, args.scheduleId);
  const primaries = primariesOnly(chains);
  const sourceChainRows = rowsForPrimary(chains, args.primaryNumber).filter(
    (r) => !r.isRescheduled,
  );
  const carryover = round2(
    sourceChainRows.reduce((sum, r) => sum + r.remainingAmount, 0),
  );
  if (carryover <= 0) {
    return { carryover: 0, targets: [] };
  }

  // Eligible targets: primaries with installmentNumber > N, not rescheduled,
  // with remainingAmount > 0 (or still upcoming).
  const targets = primaries.filter(
    (p) =>
      p.installmentNumber > args.primaryNumber &&
      !p.isRescheduled &&
      p.remainingAmount > 0,
  );

  if (targets.length === 0) {
    // Nothing to distribute into. Leave source as-is; caller should handle
    // (this means we're at the last primary or all future rows are closed/paid).
    return { carryover, targets: [] };
  }

  // Equal split with residue going to the last target so sum matches exactly.
  const perTarget = round2(carryover / targets.length);
  const distributed = round2(perTarget * targets.length);
  const residue = round2(carryover - distributed);

  const targetDeltas: { id: string; delta: number; installmentNumber: number }[] = [];
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const delta = i === targets.length - 1 ? round2(perTarget + residue) : perTarget;
    targetDeltas.push({ id: t.id, delta, installmentNumber: t.installmentNumber });
    await tx.installment.update({
      where: { id: t.id },
      data: {
        amountDue: { increment: delta },
        remainingAmount: { increment: delta },
      },
    });
  }

  // Zero out the source chain rows' remainingAmount, preserve paid & status.
  for (const r of sourceChainRows) {
    let newStatus: string = r.status;
    if (r.amountPaid === 0) newStatus = 'overdue';
    else if (r.amountPaid < r.amountDue) newStatus = 'partially_paid';
    else newStatus = 'paid';

    await tx.installment.update({
      where: { id: r.id },
      data: {
        remainingAmount: 0,
        status: newStatus as any,
      },
    });
  }

  const todayDate = toDateOnly(args.today);
  const lastTargetNum = targets[targets.length - 1].installmentNumber;
  const targetLabel = targets.length === 1
    ? `#${targets[0].installmentNumber}`
    : `#${targets[0].installmentNumber}..#${lastTargetNum}`;
  const message =
    args.reason === 'promise_after_next'
      ? `Customer promised to pay on ${formatDate(args.promisedDate!)}, which falls on/after the next ` +
        `installment's due date. ${formatINR(carryover)} from Installment #${args.primaryNumber} ` +
        `redistributed across ${targetLabel} (${formatINR(perTarget)} each).` +
        (args.employeeNote ? ` Note: ${args.employeeNote}` : '')
      : `Next installment's due date arrived while Installment #${args.primaryNumber} still owed ${formatINR(carryover)}. ` +
        `Amount redistributed across ${targetLabel} (${formatINR(perTarget)} each).`;

  await tx.installmentRollLog.create({
    data: {
      scheduleId: args.scheduleId,
      eventType: 'redistributed',
      eventDate: todayDate,
      actorUserId: args.actorUserId ?? null,
      displayMessage: message,
      metadata: {
        sourcePrimary: args.primaryNumber,
        reason: args.reason,
        carryover,
        perTarget,
        targets: targetDeltas,
        promisedDate: args.promisedDate ? formatDate(args.promisedDate) : null,
      } as Prisma.InputJsonValue,
    },
  });

  return { carryover, targets: targetDeltas };
}

// ---------------------------------------------------------------------------
// R7 — overpayment distribution (symmetric to R3/R4 but subtracts)
// ---------------------------------------------------------------------------

/**
 * Customer paid more than the source installment needed. Take the excess and
 * spread it across every future primary (installmentNumber > sourcePrimary)
 * that is not rescheduled and still has remainingAmount > 0.
 *
 * For each target: amountDue and remainingAmount are decremented by the same
 * delta (equal split; residue lands on the last target). If a target becomes
 * fully covered (remainingAmount hits 0 and amountPaid == amountDue), status
 * is flipped to 'paid'.
 *
 * Returns the amount successfully distributed. If no eligible targets exist,
 * returns 0 with an empty targets array — caller must decide whether that's
 * an error (we throw at the service layer).
 */
export async function distributeOverpayment(
  tx: Tx,
  args: {
    scheduleId: string;
    sourcePrimaryNumber: number;
    sourceInstallmentId: string;
    excess: number;
    today: Date;
    actorUserId?: string;
    paymentMode?: string;
    notes?: string;
    /**
     * When true (employee opted in), fully-cleared future installments
     * have their baked-in interest share waived — customer pays only
     * principal+file. When false (default), the excess is simply
     * decremented from future installments without any interest discount.
     */
    waiveInterest?: boolean;
  },
): Promise<{
  distributed: number;
  targets: { id: string; delta: number; installmentNumber: number; paidOff: boolean }[];
}> {
  const excess = round2(args.excess);
  if (excess <= 0) {
    return { distributed: 0, targets: [] };
  }
  const waiveInterest = args.waiveInterest === true;

  const chains = await loadChains(tx, args.scheduleId);
  const primaries = primariesOnly(chains);

  const targets = primaries.filter(
    (p) =>
      p.installmentNumber > args.sourcePrimaryNumber &&
      !p.isRescheduled &&
      p.remainingAmount > 0,
  );

  if (targets.length === 0) {
    return { distributed: 0, targets: [] };
  }

  // Look up the schedule's interest / file shares so we can offer early
  // closure with proper interest waiver. The waiver only kicks in when
  // `waiveInterest === true`; otherwise we apply the excess straight as a
  // partial decrement (legacy behavior).
  const schedule = await tx.installmentSchedule.findUnique({
    where: { id: args.scheduleId },
    select: {
      totalInterest: true,
      totalPrincipal: true,
      fileCharge: true,
      numInstallments: true,
    },
  });
  const totalInterest = Number(schedule?.totalInterest ?? 0);
  const fileCharge = Number(schedule?.fileCharge ?? 0);
  const principal = Number(schedule?.totalPrincipal ?? 0);
  const numInstallments = Math.max(1, schedule?.numInstallments ?? 1);
  const interestShare = round2(totalInterest / numInstallments);
  const fileShare = round2(fileCharge / numInstallments);
  const principalShare = round2(principal / numInstallments);
  const noInterestEmi = round2(principalShare + fileShare);

  const targetDeltas: {
    id: string;
    delta: number;
    installmentNumber: number;
    paidOff: boolean;
    interestWaived: number;
    closedEarly: boolean;
  }[] = [];

  let remaining = excess;
  let waivedInterestTotal = 0;

  if (waiveInterest) {
    // Greedy waiver path — close future installments early, waiving their
    // baked-in interest share, until the excess is exhausted.
    for (const t of targets) {
      if (remaining <= 0) break;
      if (
        interestShare > 0 &&
        remaining >= Math.min(noInterestEmi, t.remainingAmount) &&
        t.remainingAmount > 0
      ) {
        const closingCost = Math.min(noInterestEmi, t.remainingAmount);
        const interestPortionPresent = Math.min(interestShare, t.remainingAmount);
        const reductionToAmountDue = round2(closingCost + interestPortionPresent);
        const cappedReduction = Math.min(reductionToAmountDue, t.remainingAmount);
        const interestWaived = round2(cappedReduction - closingCost);

        await tx.installment.update({
          where: { id: t.id },
          data: {
            amountDue: { decrement: cappedReduction },
            amountPaid: { increment: closingCost },
            remainingAmount: { decrement: cappedReduction },
            status: 'paid' as any,
          },
        });

        remaining = round2(remaining - closingCost);
        waivedInterestTotal = round2(waivedInterestTotal + interestWaived);
        targetDeltas.push({
          id: t.id,
          delta: closingCost,
          installmentNumber: t.installmentNumber,
          paidOff: true,
          interestWaived,
          closedEarly: true,
        });
        continue;
      }
      // Not enough to close this one fully → fall through to partial.
      const delta = Math.min(remaining, t.remainingAmount);
      if (delta <= 0) break;
      const willBePaidOff = round2(t.remainingAmount - delta) <= 0;
      await tx.installment.update({
        where: { id: t.id },
        data: {
          amountDue: { decrement: delta },
          remainingAmount: { decrement: delta },
          status: willBePaidOff ? ('paid' as any) : (t.status as any),
        },
      });
      remaining = round2(remaining - delta);
      targetDeltas.push({
        id: t.id,
        delta,
        installmentNumber: t.installmentNumber,
        paidOff: willBePaidOff,
        interestWaived: 0,
        closedEarly: false,
      });
    }
  } else {
    // Default / no-waiver path: legacy equal-split behavior. Each future
    // installment receives the same delta (rounded), with the residue
    // landing on the last target. Mirrors the parent-chain redistribution
    // in R3/R4 so the customer experience is consistent.
    const perTarget = round2(remaining / targets.length);
    const distributed = round2(perTarget * targets.length);
    let residue = round2(remaining - distributed);
    let leftoverFromCap = 0;

    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      const isLast = i === targets.length - 1;
      const nominal = isLast
        ? round2(perTarget + residue + leftoverFromCap)
        : round2(perTarget + leftoverFromCap);
      leftoverFromCap = 0;
      // Cap delta at this target's remainingAmount; carry the rest into
      // the next iteration so total distribution stays exact.
      let delta = nominal;
      if (delta > t.remainingAmount) {
        leftoverFromCap = round2(delta - t.remainingAmount);
        delta = t.remainingAmount;
        if (isLast) residue = 0; // already absorbed below
      }
      if (delta <= 0) {
        if (!isLast) continue;
        break;
      }
      const willBePaidOff = round2(t.remainingAmount - delta) <= 0;
      await tx.installment.update({
        where: { id: t.id },
        data: {
          amountDue: { decrement: delta },
          remainingAmount: { decrement: delta },
          status: willBePaidOff ? ('paid' as any) : (t.status as any),
        },
      });
      targetDeltas.push({
        id: t.id,
        delta,
        installmentNumber: t.installmentNumber,
        paidOff: willBePaidOff,
        interestWaived: 0,
        closedEarly: false,
      });
    }
    remaining = leftoverFromCap;
  }

  // Any cash the customer paid beyond what was actually distributed remains
  // on the source row's amountPaid (the caller already incremented amountPaid
  // by the FULL cash amount). We deliberately do NOT touch amountDue here —
  // the contractual EMI for the source installment is preserved as the
  // original schedule value; the leftover is just the unallocated portion
  // of cash and is visible via the InstallmentPayment row(s).
  const leftover = remaining;

  const todayDate = toDateOnly(args.today);
  const lastTargetNum = targets[targets.length - 1].installmentNumber;
  const targetLabel =
    targets.length === 1
      ? `#${targets[0].installmentNumber}`
      : `#${targets[0].installmentNumber}..#${lastTargetNum}`;
  const distributedAmount = round2(excess - leftover);

  const message =
    `Overpayment of ${formatINR(excess)} on Installment #${args.sourcePrimaryNumber} ` +
    `applied to ${targetLabel}.` +
    (waivedInterestTotal > 0 ? ` ${formatINR(waivedInterestTotal)} future interest waived.` : '') +
    (leftover > 0 ? ` Unallocated excess ${formatINR(leftover)} kept on source row.` : '') +
    (args.notes ? ` Note: ${args.notes}` : '');

  await tx.installmentRollLog.create({
    data: {
      scheduleId: args.scheduleId,
      installmentId: args.sourceInstallmentId,
      eventType: 'redistributed',
      eventDate: todayDate,
      actorUserId: args.actorUserId ?? null,
      displayMessage: message,
      metadata: {
        sourcePrimary: args.sourcePrimaryNumber,
        reason: 'overpayment',
        excess,
        distributed: distributedAmount,
        leftover,
        interestWaived: waivedInterestTotal,
        principalShare,
        interestShare,
        fileShare,
        targets: targetDeltas,
        paymentMode: args.paymentMode ?? null,
      } as Prisma.InputJsonValue,
    },
  });

  return { distributed: distributedAmount, targets: targetDeltas };
}

// ---------------------------------------------------------------------------
// R4 — daily rollover (auto-redistribute when next primary's date arrives)
// ---------------------------------------------------------------------------

/**
 * For every active schedule in scope, iterate primaries in order:
 *   - If primary #N's chain has remainingAmount > 0 AND #N+1 exists AND
 *     #N+1.dueDate <= today → apply redistribution R4 to chain #N.
 *   - Repeat until no more redistributions are needed (at most once per
 *     primary). Idempotent across multiple same-day runs.
 */
export async function applyDailyRollover(
  tx: Tx,
  today: Date,
  scope: { scheduleId?: string; shopId?: string; shopIds?: string[] },
): Promise<{ redistributions: number }> {
  const todayDate = toDateOnly(today);

  const scheduleWhere: Prisma.InstallmentScheduleWhereInput = { status: 'active' };
  if (scope.scheduleId) scheduleWhere.id = scope.scheduleId;
  else if (scope.shopIds && scope.shopIds.length > 0)
    scheduleWhere.sale = { shopId: { in: scope.shopIds } };
  else if (scope.shopId) scheduleWhere.sale = { shopId: scope.shopId };

  const schedules = await tx.installmentSchedule.findMany({
    where: scheduleWhere,
    select: { id: true, lastRolloverDate: true },
  });

  let total = 0;
  for (const s of schedules) {
    // Skip if already processed today.
    if (s.lastRolloverDate && toDateOnly(s.lastRolloverDate).getTime() === todayDate.getTime()) {
      continue;
    }

    // Walk primaries; redistribute any #N whose chain has remaining > 0 and
    // whose #N+1 due date <= today.
    let iterationGuard = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      iterationGuard++;
      if (iterationGuard > 50) break; // safety

      const chains = await loadChains(tx, s.id);
      const primaries = primariesOnly(chains);

      const target = primaries.find((p, idx) => {
        const next = primaries[idx + 1];
        if (!next) return false;
        const chainRemaining = remainingForPrimary(chains, p.installmentNumber);
        return chainRemaining > 0 && toDateOnly(next.dueDate) <= todayDate;
      });

      if (!target) break;

      await redistributePrimaryChain(tx, {
        scheduleId: s.id,
        primaryNumber: target.installmentNumber,
        today: toDateOnly(next_primary_eventDate(chains, target.installmentNumber) ?? today),
        reason: 'auto_next_due',
      });
      total++;
    }

    await tx.installmentSchedule.update({
      where: { id: s.id },
      data: { lastRolloverDate: todayDate },
    });

    await syncScheduleAndSale(tx, s.id);
  }

  return { redistributions: total };
}

/** Returns the dueDate of the primary immediately following `primaryNumber`, if any. */
function next_primary_eventDate(chains: ChainRow[], primaryNumber: number): Date | null {
  const primaries = primariesOnly(chains);
  const idx = primaries.findIndex((p) => p.installmentNumber === primaryNumber);
  if (idx < 0 || idx + 1 >= primaries.length) return null;
  return primaries[idx + 1].dueDate;
}

// ---------------------------------------------------------------------------
// R2 / R3 — applyPartialWithPromise (called from recordPayment)
// ---------------------------------------------------------------------------

/**
 * Called when the customer has made a (possibly zero) payment on a specific
 * row and committed to a new date for the remainder.
 *
 * Branches:
 *   (a) promiseDate ≤ next primary's dueDate  → create sub #N.(k+1)
 *   (b) promiseDate >  next primary's dueDate → redistribute chain #N
 *
 * The caller already recorded the payment on the source row. This function
 * only arranges the chain.
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
  branch: 'sub_created' | 'redistributed';
  newSubId?: string;
  redistributeResult?: { carryover: number; targets: { id: string; delta: number; installmentNumber: number }[] };
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
      status: true,
    },
  });
  if (!source) throw new Error('Source installment not found');

  const primaryNumber = source.parentInstallmentNumber ?? source.installmentNumber;
  const todayDate = toDateOnly(args.today);
  const promiseDate = toDateOnly(args.newPromiseDate);

  // Find the next primary (installmentNumber > primaryNumber).
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

  // Branch (b): promise > next primary's due → redistribute.
  if (nextPrimary && promiseDate > toDateOnly(nextPrimary.dueDate)) {
    const result = await redistributePrimaryChain(tx, {
      scheduleId: source.scheduleId,
      primaryNumber,
      today: todayDate,
      actorUserId: args.actorUserId,
      reason: 'promise_after_next',
      promisedDate: promiseDate,
      employeeNote: args.employeeNote,
    });
    return { branch: 'redistributed', redistributeResult: result };
  }

  // Branch (a): create a fresh sub row #N.(k+1).
  // Find current highest subSequence on this chain.
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

  // Source becomes "partially_paid" or stays "overdue" — do NOT mark rescheduled.
  // Statuses: if the source is a sub row, it too carries its state.
  const newSourceStatus =
    Number(source.amountPaid) === 0
      ? 'overdue'
      : Number(source.amountPaid) < Number(source.amountDue)
        ? 'partially_paid'
        : 'paid';
  await tx.installment.update({
    where: { id: source.id },
    data: {
      // The source's remainingAmount moves to the new sub row; zero it here.
      remainingAmount: 0,
      status: newSourceStatus,
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
        `Customer committed ${formatDate(promiseDate)} for the remaining ${formatINR(args.remainderAfterPayment)} ` +
        `on Installment #${primaryNumber}. New sub-row #${primaryNumber}.${nextSubSeq} created.` +
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
 * Runs the full daily rule engine for a scope. Safe to call multiple times.
 *   1. applyDailyRollover — redistribute stale chains whose next primary has come due.
 *   2. markOverdueForToday — flip due-today / overdue status flags for visibility.
 *   3. syncScheduleAndSale — keep sale.pendingAmount and completion state in sync
 *      (called per-schedule inside applyDailyRollover too; this top-level call
 *      handles schedules that didn't redistribute but may still need recompute).
 */
export async function ensureRolledForToday(
  tx: Tx,
  today: Date,
  scope: { scheduleId?: string; shopId?: string; shopIds?: string[] },
): Promise<{ redistributions: number; markedOverdue: number }> {
  const { redistributions } = await applyDailyRollover(tx, today, scope);
  const markedOverdue = await markOverdueForToday(tx, today, scope);

  // For single-schedule scope also sync directly.
  if (scope.scheduleId) {
    await syncScheduleAndSale(tx, scope.scheduleId);
  }

  return { redistributions, markedOverdue };
}

// ---------------------------------------------------------------------------
// Backwards-compatible alias: service imports `markDueToday` historically.
// ---------------------------------------------------------------------------