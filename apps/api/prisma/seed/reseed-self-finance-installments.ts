/**
 * Re-seed installment payment history for self-finance sales.
 * ---------------------------------------------------------------------------
 * - Leaves sales, products, customers, schedule meta untouched.
 * - Wipes installment_roll_log, installment_payments, and sub-row installments
 *   for self-finance schedules only.
 * - Resets primary installments to their initial EMI amount / upcoming status.
 * - Picks 7 "showcase" schedules and deterministically builds one scenario
 *   each (A..G) using the real rule engine functions.
 * - For every other self-finance schedule, simulates random partial payments
 *   and then runs `ensureRolledForToday` so the data is engine-consistent.
 *
 * Run:   npx tsx prisma/seed/reseed-self-finance-installments.ts
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import {
  applyPartialWithPromise,
  ensureRolledForToday,
  syncScheduleAndSale,
} from '../../src/modules/installments/installments.rules';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Deterministic RNG — stable output across runs.
// ---------------------------------------------------------------------------
function rand(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

function toDateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// ---------------------------------------------------------------------------
// Step 1 — wipe installment state for self-finance schedules.
// ---------------------------------------------------------------------------
async function wipeSelfFinanceInstallments() {
  const scheduleIds = (
    await prisma.installmentSchedule.findMany({
      where: { sale: { saleType: 'self_finance' } },
      select: { id: true },
    })
  ).map((s) => s.id);

  if (scheduleIds.length === 0) {
    console.log('  No self-finance schedules found. Nothing to wipe.');
    return scheduleIds;
  }

  console.log(`  Wiping state for ${scheduleIds.length} self-finance schedules...`);

  // 1a. Delete roll logs for these schedules
  await prisma.installmentRollLog.deleteMany({
    where: { scheduleId: { in: scheduleIds } },
  });

  // 1b. Delete all payments for installments in these schedules
  await prisma.installmentPayment.deleteMany({
    where: { installment: { scheduleId: { in: scheduleIds } } },
  });

  // 1c. Delete sub-rows (parentInstallmentNumber IS NOT NULL)
  await prisma.installment.deleteMany({
    where: {
      scheduleId: { in: scheduleIds },
      parentInstallmentNumber: { not: null },
    },
  });

  // 1d. Reset every primary row back to its original EMI amount / upcoming.
  //     amountDue must equal schedule.emiAmount after this step.
  const schedules = await prisma.installmentSchedule.findMany({
    where: { id: { in: scheduleIds } },
    select: { id: true, emiAmount: true },
  });
  for (const s of schedules) {
    await prisma.installment.updateMany({
      where: { scheduleId: s.id, parentInstallmentNumber: null },
      data: {
        amountDue: s.emiAmount,
        amountPaid: 0,
        remainingAmount: s.emiAmount,
        status: 'upcoming',
        isRescheduled: false,
        rescheduledFromId: null,
        isClosed: false,
        notes: null,
      },
    });
  }

  // 1e. Reset schedule metadata
  await prisma.installmentSchedule.updateMany({
    where: { id: { in: scheduleIds } },
    data: { status: 'active', lastRolloverDate: null },
  });

  // 1f. Clear completedAt on every self-finance sale.
  await prisma.saleRecord.updateMany({
    where: { saleType: 'self_finance' },
    data: { completedAt: null, pendingAmount: 0 },
  });

  // Recompute pendingAmount from schedules (sum of remaining).
  for (const s of schedules) {
    const agg = await prisma.installment.aggregate({
      where: { scheduleId: s.id, isClosed: false },
      _sum: { remainingAmount: true },
    });
    const pending = Number(agg._sum.remainingAmount ?? 0);
    await prisma.saleRecord.update({
      where: { id: (await prisma.installmentSchedule.findUnique({ where: { id: s.id }, select: { saleId: true } }))!.saleId },
      data: { pendingAmount: pending },
    });
  }

  return scheduleIds;
}

// ---------------------------------------------------------------------------
// Helpers to record a payment against an installment and update the row.
// ---------------------------------------------------------------------------
async function recordFullPayment(params: {
  installmentId: string;
  paymentDate: Date;
  collectorId: string | null;
  refSeed: number;
}) {
  const inst = await prisma.installment.findUnique({
    where: { id: params.installmentId },
    select: { amountDue: true, amountPaid: true },
  });
  if (!inst) return;
  const due = Number(inst.amountDue);
  const alreadyPaid = Number(inst.amountPaid);
  const toPay = Number((due - alreadyPaid).toFixed(2));
  if (toPay <= 0) return;

  await prisma.installmentPayment.create({
    data: {
      id: randomUUID(),
      installmentId: params.installmentId,
      amount: toPay,
      paymentMode: 'cash',
      paymentDate: params.paymentDate,
      collectedBy: params.collectorId,
      referenceNumber: `SEED-${pad(params.refSeed, 8)}`,
    },
  });
  await prisma.installment.update({
    where: { id: params.installmentId },
    data: {
      amountPaid: due,
      remainingAmount: 0,
      status: 'paid',
    },
  });
}

async function recordPartialPayment(params: {
  installmentId: string;
  amount: number;
  paymentDate: Date;
  collectorId: string | null;
  refSeed: number;
}) {
  const inst = await prisma.installment.findUnique({
    where: { id: params.installmentId },
    select: { amountDue: true, amountPaid: true },
  });
  if (!inst) return;
  const alreadyPaid = Number(inst.amountPaid);
  const newPaid = Number((alreadyPaid + params.amount).toFixed(2));
  const due = Number(inst.amountDue);
  const remaining = Number((due - newPaid).toFixed(2));

  await prisma.installmentPayment.create({
    data: {
      id: randomUUID(),
      installmentId: params.installmentId,
      amount: params.amount,
      paymentMode: 'upi',
      paymentDate: params.paymentDate,
      collectedBy: params.collectorId,
      referenceNumber: `SEED-${pad(params.refSeed, 8)}`,
    },
  });
  await prisma.installment.update({
    where: { id: params.installmentId },
    data: {
      amountPaid: newPaid,
      remainingAmount: remaining > 0 ? remaining : 0,
      status: remaining <= 0 ? 'paid' : 'partially_paid',
    },
  });
}

// ---------------------------------------------------------------------------
// Scenario builders. Each receives a fresh schedule (primaries in upcoming
// state) and an "asOf" date (today). Each returns a short label for logging.
// ---------------------------------------------------------------------------
type SchedulePrimaries = {
  id: string;
  primaries: { id: string; installmentNumber: number; dueDate: Date; amountDue: number }[];
  collectorId: string | null;
  actorUserId: string;
  ledgerNumber: string;
};

async function scenarioCleanPayer(ctx: SchedulePrimaries, asOf: Date, seed: number) {
  // Pay every past-due EMI on time.
  const pastDue = ctx.primaries.filter((p) => p.dueDate.getTime() <= asOf.getTime());
  let s = seed;
  for (const p of pastDue) {
    await recordFullPayment({
      installmentId: p.id,
      paymentDate: p.dueDate,
      collectorId: ctx.collectorId,
      refSeed: s++,
    });
  }
  await ensureRolledForToday(prisma, asOf, { scheduleId: ctx.id });
  return `A. Clean payer — ${pastDue.length}/${ctx.primaries.length} EMIs paid on time`;
}

async function scenarioSingleOverdue(ctx: SchedulePrimaries, asOf: Date, seed: number) {
  // Pay all past-due EMIs EXCEPT the latest one (still unpaid, R1 only).
  const pastDue = ctx.primaries.filter((p) => p.dueDate.getTime() <= asOf.getTime());
  if (pastDue.length === 0) return 'B. Single overdue — schedule has no past-due EMIs, skipped';
  const toPay = pastDue.slice(0, -1);
  let s = seed;
  for (const p of toPay) {
    await recordFullPayment({
      installmentId: p.id,
      paymentDate: p.dueDate,
      collectorId: ctx.collectorId,
      refSeed: s++,
    });
  }
  await ensureRolledForToday(prisma, asOf, { scheduleId: ctx.id });
  return `B. Single overdue — latest EMI missed, not yet rolled`;
}

async function scenarioSubRowCreated(ctx: SchedulePrimaries, asOf: Date, seed: number) {
  // Pay older EMIs, then on the most-recent past-due primary:
  // customer did partial + promised a date before #N+1 → sub #N.1 is created.
  const pastDue = ctx.primaries.filter((p) => p.dueDate.getTime() <= asOf.getTime());
  if (pastDue.length < 2) return 'C. Sub-row — not enough past-due EMIs, skipped';

  const target = pastDue[pastDue.length - 1]; // most recent past-due primary
  const olderPaid = pastDue.slice(0, -1);
  let s = seed;
  for (const p of olderPaid) {
    await recordFullPayment({
      installmentId: p.id,
      paymentDate: p.dueDate,
      collectorId: ctx.collectorId,
      refSeed: s++,
    });
  }

  // Partial payment = 40% of EMI on the target.
  const partial = Math.round(target.amountDue * 0.4);
  await recordPartialPayment({
    installmentId: target.id,
    amount: partial,
    paymentDate: target.dueDate,
    collectorId: ctx.collectorId,
    refSeed: s++,
  });
  const remainder = Number((target.amountDue - partial).toFixed(2));

  // Promise date = today + 3 days (before next primary which is ~27 days away)
  const promiseDate = new Date(asOf.getTime() + 3 * 86400000);
  await applyPartialWithPromise(prisma, {
    sourceInstallmentId: target.id,
    newPromiseDate: promiseDate,
    remainderAfterPayment: remainder,
    actorUserId: ctx.actorUserId,
    employeeNote: 'Customer requested short extension',
    today: asOf,
  });
  await ensureRolledForToday(prisma, asOf, { scheduleId: ctx.id });
  return `C. Sub-row #N.1 — partial + promise before next primary`;
}

async function scenarioSubRowChain(ctx: SchedulePrimaries, asOf: Date, seed: number) {
  // Two successive promises on the same primary → #N.1 then #N.2.
  const pastDue = ctx.primaries.filter((p) => p.dueDate.getTime() <= asOf.getTime());
  if (pastDue.length < 2) return 'D. Sub-row chain — not enough past-due EMIs, skipped';

  const target = pastDue[pastDue.length - 1];
  let s = seed;
  for (const p of pastDue.slice(0, -1)) {
    await recordFullPayment({
      installmentId: p.id,
      paymentDate: p.dueDate,
      collectorId: ctx.collectorId,
      refSeed: s++,
    });
  }

  // First promise (5 days out) with partial 30%.
  const partial1 = Math.round(target.amountDue * 0.3);
  await recordPartialPayment({
    installmentId: target.id,
    amount: partial1,
    paymentDate: target.dueDate,
    collectorId: ctx.collectorId,
    refSeed: s++,
  });
  const remainder1 = Number((target.amountDue - partial1).toFixed(2));
  const promise1 = new Date(asOf.getTime() - 2 * 86400000); // 2 days ago (sub is already overdue)
  const r1 = await applyPartialWithPromise(prisma, {
    sourceInstallmentId: target.id,
    newPromiseDate: promise1,
    remainderAfterPayment: remainder1,
    actorUserId: ctx.actorUserId,
    employeeNote: 'Short extension agreed',
    today: new Date(target.dueDate.getTime() + 1 * 86400000),
  });

  // Second promise on the sub row (5 more days).
  if (r1.branch === 'sub_created' && r1.newSubId) {
    const promise2 = new Date(asOf.getTime() + 5 * 86400000);
    await applyPartialWithPromise(prisma, {
      sourceInstallmentId: r1.newSubId,
      newPromiseDate: promise2,
      remainderAfterPayment: remainder1, // customer paid nothing on promise1
      actorUserId: ctx.actorUserId,
      employeeNote: 'Customer pushed again',
      today: asOf,
    });
  }
  await ensureRolledForToday(prisma, asOf, { scheduleId: ctx.id });
  return `D. Sub-row chain #N.1 → #N.2 (two extensions)`;
}

async function scenarioRedistributedByPromise(ctx: SchedulePrimaries, asOf: Date, seed: number) {
  // Customer promises a date AFTER the next primary's due → R3 redistribution.
  const pastDue = ctx.primaries.filter((p) => p.dueDate.getTime() <= asOf.getTime());
  if (pastDue.length < 2 || ctx.primaries.length < pastDue.length + 2) {
    return 'E. Redistribute (promise) — insufficient installments, skipped';
  }

  const target = pastDue[pastDue.length - 1];
  const nextPrimary = ctx.primaries.find((p) => p.installmentNumber === target.installmentNumber + 1);
  if (!nextPrimary) return 'E. Redistribute (promise) — no next primary, skipped';

  let s = seed;
  for (const p of pastDue.slice(0, -1)) {
    await recordFullPayment({
      installmentId: p.id,
      paymentDate: p.dueDate,
      collectorId: ctx.collectorId,
      refSeed: s++,
    });
  }

  // Partial 20% + promise date > next primary's due.
  const partial = Math.round(target.amountDue * 0.2);
  await recordPartialPayment({
    installmentId: target.id,
    amount: partial,
    paymentDate: target.dueDate,
    collectorId: ctx.collectorId,
    refSeed: s++,
  });
  const remainder = Number((target.amountDue - partial).toFixed(2));
  const promiseDate = new Date(nextPrimary.dueDate.getTime() + 5 * 86400000);
  await applyPartialWithPromise(prisma, {
    sourceInstallmentId: target.id,
    newPromiseDate: promiseDate,
    remainderAfterPayment: remainder,
    actorUserId: ctx.actorUserId,
    employeeNote: 'Cannot pay before next EMI',
    today: asOf,
  });
  await ensureRolledForToday(prisma, asOf, { scheduleId: ctx.id });
  return `E. Redistributed (R3) — promise after next primary, carryover spread forward`;
}

async function scenarioDailyRollover(ctx: SchedulePrimaries, asOf: Date, seed: number) {
  // Realistic simulation: customer misses #2 entirely. Daily cron fires on
  // #3's due date and redistributes #2's amount across #3..#last. Then the
  // customer pays #3..#6 at the BUMPED amount (production behaviour).
  const pastDue = ctx.primaries.filter((p) => p.dueDate.getTime() <= asOf.getTime());
  if (pastDue.length < 3) return 'F. Daily rollover — insufficient past-due EMIs, skipped';

  const toSkip = pastDue[1]; // second oldest stays unpaid
  let s = seed;

  // Step 1: pay #1 (everything before the missed one) at original amount.
  for (const p of pastDue.slice(0, 1)) {
    await recordFullPayment({
      installmentId: p.id,
      paymentDate: p.dueDate,
      collectorId: ctx.collectorId,
      refSeed: s++,
    });
  }

  // Step 2: simulate the daily cron firing on #toSkip+1's due date.
  const nextPrimary = ctx.primaries.find((p) => p.installmentNumber === toSkip.installmentNumber + 1);
  if (nextPrimary) {
    await ensureRolledForToday(prisma, nextPrimary.dueDate, { scheduleId: ctx.id });
  }

  // Step 3: re-load primaries so we collect at the bumped amount.
  const refreshed = await prisma.installment.findMany({
    where: { scheduleId: ctx.id, parentInstallmentNumber: null },
    orderBy: { installmentNumber: 'asc' },
    select: { id: true, installmentNumber: true, dueDate: true, amountDue: true, remainingAmount: true },
  });

  // Step 4: pay the rest of pastDue (excluding toSkip) at the new amount.
  for (const p of pastDue.slice(2)) {
    const r = refreshed.find((x) => x.installmentNumber === p.installmentNumber);
    if (!r || Number(r.remainingAmount) <= 0) continue;
    await recordFullPayment({
      installmentId: r.id,
      paymentDate: new Date(r.dueDate),
      collectorId: ctx.collectorId,
      refSeed: s++,
    });
  }

  // Step 5: final rollover on today.
  await ensureRolledForToday(prisma, asOf, { scheduleId: ctx.id });
  return `F. Daily rollover (R4) — chain #${toSkip.installmentNumber} auto-redistributed across #${toSkip.installmentNumber + 1}..#last`;
}

async function scenarioNearCompletion(ctx: SchedulePrimaries, asOf: Date, seed: number) {
  // Pay every EMI except the last 2.
  const n = ctx.primaries.length;
  const toPay = ctx.primaries.slice(0, n - 2);
  let s = seed;
  for (const p of toPay) {
    const payDate = p.dueDate.getTime() > asOf.getTime() ? asOf : p.dueDate;
    await recordFullPayment({
      installmentId: p.id,
      paymentDate: payDate,
      collectorId: ctx.collectorId,
      refSeed: s++,
    });
  }
  await ensureRolledForToday(prisma, asOf, { scheduleId: ctx.id });
  return `G. Near completion — only last 2 EMIs pending`;
}

// ---------------------------------------------------------------------------
// Random-pay fallback for schedules that aren't showcases.
// ---------------------------------------------------------------------------
async function randomRealisticPay(ctx: SchedulePrimaries, asOf: Date, seed: number) {
  const ageDays = Math.floor(
    (asOf.getTime() - ctx.primaries[0].dueDate.getTime()) / 86400000,
  );
  let paidRatio: number;
  if (ageDays > 270) paidRatio = 0.6 + rand(seed) * 0.3;
  else if (ageDays > 90) paidRatio = 0.4 + rand(seed + 1) * 0.3;
  else paidRatio = rand(seed + 2) * 0.4;

  let s = seed + 3;
  const pastDue = ctx.primaries.filter((p) => p.dueDate.getTime() <= asOf.getTime());

  for (const p of pastDue) {
    // Simulate the daily cron firing on this primary's due date BEFORE the
    // customer pays. This lets R4 redistribute any stale sub row from the
    // previous primary (promise expired before #p's due date) across #p and
    // all later primaries — matching what production would do. Subsequent
    // `recordFullPayment` reads the bumped `amountDue` from the DB, so the
    // customer is credited with paying the redistributed amount, not the
    // original face value.
    await ensureRolledForToday(prisma, p.dueDate, { scheduleId: ctx.id });

    const shouldPay = rand(s++) < paidRatio;
    if (!shouldPay) continue;

    // 80% full payment, 20% partial with small promise (no carryover conflict).
    const roll = rand(s++);
    if (roll < 0.85) {
      const dayOffset = Math.floor(rand(s++) * 7) - 1; // -1..+5
      const payDate = new Date(p.dueDate);
      payDate.setDate(payDate.getDate() + dayOffset);
      if (payDate.getTime() > asOf.getTime()) payDate.setTime(asOf.getTime());
      await recordFullPayment({
        installmentId: p.id,
        paymentDate: payDate,
        collectorId: ctx.collectorId,
        refSeed: s++,
      });
    } else {
      // Partial 40-70% then same-chain promise 3-5 days out → sub row.
      // Re-read current amountDue from DB in case R4 already bumped it.
      const currentRow = await prisma.installment.findUnique({
        where: { id: p.id },
        select: { amountDue: true, amountPaid: true, remainingAmount: true },
      });
      const currentDue = Number(currentRow?.amountDue ?? p.amountDue);
      const currentRemaining = Number(currentRow?.remainingAmount ?? p.amountDue);
      if (currentRemaining <= 0) continue; // already covered by an earlier redistribution

      const pct = 0.4 + rand(s++) * 0.3;
      const partial = Math.round(currentRemaining * pct);
      await recordPartialPayment({
        installmentId: p.id,
        amount: partial,
        paymentDate: p.dueDate,
        collectorId: ctx.collectorId,
        refSeed: s++,
      });
      // Only create sub if there's a next primary far enough out.
      const next = ctx.primaries.find((x) => x.installmentNumber === p.installmentNumber + 1);
      if (next && next.dueDate.getTime() > p.dueDate.getTime() + 4 * 86400000) {
        const promise = new Date(p.dueDate.getTime() + 3 * 86400000);
        if (promise.getTime() < next.dueDate.getTime()) {
          try {
            await applyPartialWithPromise(prisma, {
              sourceInstallmentId: p.id,
              newPromiseDate: promise,
              remainderAfterPayment: Number((currentDue - Number(currentRow?.amountPaid ?? 0) - partial).toFixed(2)),
              actorUserId: ctx.actorUserId,
              today: p.dueDate,
            });
          } catch {
            // ignore — best-effort
          }
        }
      }
    }
  }
  await ensureRolledForToday(prisma, asOf, { scheduleId: ctx.id });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const asOf = toDateOnly(new Date());
  console.log(`\nRe-seeding self-finance installments (as of ${asOf.toISOString().slice(0, 10)})...\n`);

  // Actor user for roll-log rows (pick any owner, fall back to first admin).
  const actor =
    (await prisma.user.findFirst({ where: { username: 'vinod_owner' } })) ??
    (await prisma.user.findFirst({ where: { username: { contains: 'admin' } } }));
  if (!actor) throw new Error('No owner/admin user found');

  // Per-shop collector map
  const shops = await prisma.shop.findMany({ select: { id: true, code: true } });
  const shopCollector: Record<string, string | null> = {};
  for (const s of shops) {
    const emp = await prisma.user.findFirst({
      where: { username: `${s.code.toLowerCase()}_emp1` },
    });
    shopCollector[s.id] = emp?.id ?? null;
  }

  // Step 1: wipe
  const scheduleIds = await wipeSelfFinanceInstallments();
  if (scheduleIds.length === 0) return;

  // Step 2: load primaries for every schedule.
  const schedules = await prisma.installmentSchedule.findMany({
    where: { id: { in: scheduleIds } },
    include: {
      installments: { orderBy: { installmentNumber: 'asc' } },
      sale: { select: { id: true, shopId: true, ledgerNumber: true, saleDate: true } },
    },
  });

  // Sort by saleDate so showcase picks are stable.
  schedules.sort((a, b) => a.sale.saleDate.getTime() - b.sale.saleDate.getTime());

  // Pick 7 showcase schedules spread across the dataset (ages: older → newer).
  // Only pick schedules with at least 6 past-due primaries (so scenarios F/G have headroom).
  const eligible = schedules.filter(
    (s) =>
      s.installments.filter(
        (i) => i.parentInstallmentNumber === null && i.dueDate.getTime() <= asOf.getTime(),
      ).length >= 4,
  );

  if (eligible.length < 7) {
    console.warn(
      `  Only ${eligible.length} eligible schedules (need ≥7 with 4+ past-due EMIs). Picking what we can.`,
    );
  }

  // Spread picks evenly across eligible list.
  const pickIndices = [0.05, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9].map((p) =>
    Math.min(Math.floor(eligible.length * p), eligible.length - 1),
  );
  const picked = new Set<string>();
  const showcase: { schedule: typeof eligible[number]; idx: number }[] = [];
  for (let i = 0; i < Math.min(7, eligible.length); i++) {
    let idx = pickIndices[i];
    while (picked.has(eligible[idx]?.id) && idx < eligible.length - 1) idx++;
    const s = eligible[idx];
    if (!s || picked.has(s.id)) continue;
    picked.add(s.id);
    showcase.push({ schedule: s, idx: i });
  }

  const scenarios = [
    scenarioCleanPayer,
    scenarioSingleOverdue,
    scenarioSubRowCreated,
    scenarioSubRowChain,
    scenarioRedistributedByPromise,
    scenarioDailyRollover,
    scenarioNearCompletion,
  ];

  // Run showcases.
  const showcaseResults: { ledger: string; label: string }[] = [];
  let seed = 100000;
  for (const { schedule, idx } of showcase) {
    const primaries = schedule.installments
      .filter((i) => i.parentInstallmentNumber === null)
      .map((i) => ({
        id: i.id,
        installmentNumber: i.installmentNumber,
        dueDate: new Date(i.dueDate),
        amountDue: Number(i.amountDue),
      }));
    const ctx: SchedulePrimaries = {
      id: schedule.id,
      primaries,
      collectorId: shopCollector[schedule.sale.shopId] ?? null,
      actorUserId: actor.id,
      ledgerNumber: schedule.sale.ledgerNumber,
    };
    const label = await scenarios[idx](ctx, asOf, seed);
    seed += 1000;
    showcaseResults.push({ ledger: schedule.sale.ledgerNumber, label });
    await syncScheduleAndSale(prisma, schedule.id);
  }

  // Run random fallback on all non-showcase schedules.
  const nonShowcase = schedules.filter((s) => !picked.has(s.id));
  console.log(`  Applying random realistic payments to ${nonShowcase.length} schedules...`);
  for (const schedule of nonShowcase) {
    const primaries = schedule.installments
      .filter((i) => i.parentInstallmentNumber === null)
      .map((i) => ({
        id: i.id,
        installmentNumber: i.installmentNumber,
        dueDate: new Date(i.dueDate),
        amountDue: Number(i.amountDue),
      }));
    if (primaries.length === 0) continue;
    const ctx: SchedulePrimaries = {
      id: schedule.id,
      primaries,
      collectorId: shopCollector[schedule.sale.shopId] ?? null,
      actorUserId: actor.id,
      ledgerNumber: schedule.sale.ledgerNumber,
    };
    try {
      await randomRealisticPay(ctx, asOf, seed);
    } catch (err) {
      console.warn(`  [skip] schedule ${schedule.id}: ${(err as Error).message}`);
    }
    seed += 37;
    await syncScheduleAndSale(prisma, schedule.id);
  }

  // Final summary.
  console.log('\n================ SHOWCASE SCHEDULES ================');
  for (const r of showcaseResults) {
    console.log(`  ${r.ledger}  →  ${r.label}`);
  }
  console.log('====================================================\n');

  const totals = await prisma.$queryRaw<{ status: string; count: bigint }[]>(
    Prisma.sql`SELECT status, COUNT(*)::bigint AS count FROM installments
               WHERE schedule_id = ANY(${scheduleIds})
               GROUP BY status ORDER BY status`,
  );
  console.log('Installment status totals (self-finance):');
  for (const row of totals) console.log(`  ${row.status.padEnd(20)} ${row.count}`);

  const completedSales = await prisma.saleRecord.count({
    where: { saleType: 'self_finance', completedAt: { not: null } },
  });
  console.log(`\n  Self-finance sales marked completed: ${completedSales}`);
}

main()
  .catch((e) => {
    console.error('Re-seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
