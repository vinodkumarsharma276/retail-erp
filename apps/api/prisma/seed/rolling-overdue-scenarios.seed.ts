import type { PrismaClient, InstallmentSchedule } from '@prisma/client';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Rolling-overdue scenario seed.
//
// After the bulk installments seed runs, pick 5 distinct schedules and craft
// them into the 5 canonical states so that demo + UI testing can exercise
// every branch of the rule engine:
//
//   A. Happy path        — first few installments paid on time, rest upcoming.
//   B. Primary overdue + active sub-row (#2 rescheduled, #2.1 due_today).
//   C. Chain absorbed    — #2 closed, amount merged into #3.
//   D. Partial + promise — partial payment on #1, new sub #1.1 promised future.
//   E. Current due_today — primary #N is today's collection.
//
// All scenarios emit matching InstallmentRollLog rows so the timeline UI and
// customer reliability summary have realistic audit history.
// ---------------------------------------------------------------------------

const INR = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function toDateOnly(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, days: number): Date {
  const x = toDateOnly(d);
  x.setDate(x.getDate() + days);
  return x;
}

function fmtDate(d: Date): string {
  return toDateOnly(d).toISOString().slice(0, 10);
}

async function resetSchedule(prisma: PrismaClient, scheduleId: string) {
  // Wipe payments + roll log + any sub-rows, then reset primary installments.
  const installments = await prisma.installment.findMany({
    where: { scheduleId },
    orderBy: [{ installmentNumber: 'asc' }, { subSequence: 'asc' }],
  });
  const ids = installments.map((i) => i.id);
  await prisma.installmentPayment.deleteMany({ where: { installmentId: { in: ids } } });
  await prisma.installmentRollLog.deleteMany({ where: { scheduleId } });
  // Delete sub-rows first (they reference parent numbering only, no FK)
  await prisma.installment.deleteMany({
    where: { scheduleId, parentInstallmentNumber: { not: null } },
  });
  // Reset the primary rows
  const primaries = installments.filter((i) => i.parentInstallmentNumber === null);
  for (const p of primaries) {
    await prisma.installment.update({
      where: { id: p.id },
      data: {
        amountPaid: 0,
        remainingAmount: p.amountDue,
        status: 'upcoming',
        isClosed: false,
        isRescheduled: false,
        rescheduledFromId: null,
        notes: null,
      },
    });
  }
  await prisma.installmentSchedule.update({
    where: { id: scheduleId },
    data: { status: 'active' },
  });
  return primaries;
}

interface ShopCollector {
  shopId: string;
  collectorId: string | null;
}

async function getCollector(
  prisma: PrismaClient,
  shopId: string,
  cache: Map<string, ShopCollector>,
): Promise<string | null> {
  if (cache.has(shopId)) return cache.get(shopId)!.collectorId;
  const shop = await prisma.shop.findUnique({ where: { id: shopId } });
  let collectorId: string | null = null;
  if (shop) {
    const emp = await prisma.user.findUnique({
      where: { username: `${shop.code.toLowerCase()}_emp1` },
    });
    collectorId = emp?.id ?? null;
  }
  cache.set(shopId, { shopId, collectorId });
  return collectorId;
}

export async function seedRollingOverdueScenarios(
  _prisma: PrismaClient,
): Promise<{ scheduleIds: string[] }> {
  // The rolling-overdue rule engine was rewritten to use redistribution
  // instead of chain-absorption. The old scenarios (A–E) no longer map to
  // the new semantics. Scenarios are now intended to be driven by user
  // interaction (record payment with promise date, etc.) rather than seeded
  // statically. This seed is intentionally a no-op until it's rewritten.
  return { scheduleIds: [] };
}
/* eslint-disable @typescript-eslint/no-unused-vars */
// Retaining the legacy implementation below for reference; it is unreachable.
async function _legacySeedRollingOverdueScenarios(
  prisma: PrismaClient,
): Promise<{ scheduleIds: string[] }> {
  // Pick 5 self_finance schedules with >=4 installments, from different sales.
  const candidates = await prisma.installmentSchedule.findMany({
    where: { numInstallments: { gte: 4 }, sale: { saleType: 'self_finance' } },
    include: {
      sale: { select: { id: true, shopId: true, customerId: true, ledgerNumber: true } },
      installments: { orderBy: [{ installmentNumber: 'asc' }, { subSequence: 'asc' }] },
    },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });
  if (candidates.length < 5) {
    console.log('  Scenario seed: not enough candidate schedules, skipping.');
    return { scheduleIds: [] };
  }

  const today = toDateOnly(new Date());
  const used = new Set<string>();

  // Scenario E needs a schedule whose primary #1 falls today or within the
  // last 3 days so it can reasonably be shown as due_today/overdue without
  // rewriting the real due date.
  const schE = candidates.find((c) => {
    const p1 = c.installments.find((i) => i.installmentNumber === 1 && i.parentInstallmentNumber === null);
    if (!p1) return false;
    const p1Due = toDateOnly(new Date(p1.dueDate)).getTime();
    const windowStart = addDays(today, -3).getTime();
    return p1Due >= windowStart && p1Due <= today.getTime();
  });
  if (!schE) {
    console.log('  Scenario seed: no schedule with primary #1 due in last 3 days found, skipping.');
    return { scheduleIds: [] };
  }
  used.add(schE.sale.customerId);

  // Scenario C needs a schedule whose primary #3 falls today or within the
  // last 14 days — the window during which Rule C would organically fire when
  // #2 is still unpaid. The absorption event is dated on p3's due date.
  const schC = candidates.find((c) => {
    if (c.id === schE.id) return false;
    if (used.has(c.sale.customerId)) return false;
    const p3 = c.installments.find((i) => i.installmentNumber === 3 && i.parentInstallmentNumber === null);
    if (!p3) return false;
    const p3Due = toDateOnly(new Date(p3.dueDate)).getTime();
    const windowStart = addDays(today, -14).getTime();
    return p3Due >= windowStart && p3Due <= today.getTime();
  });
  if (!schC) {
    console.log('  Scenario seed: no schedule with primary #3 due in last 14 days found, skipping.');
    return { scheduleIds: [] };
  }
  used.add(schC.sale.customerId);

  // The other 3 can be any other distinct-customer schedules.
  const others: typeof candidates = [];
  for (const c of candidates) {
    if (c.id === schE.id || c.id === schC.id) continue;
    if (used.has(c.sale.customerId)) continue;
    used.add(c.sale.customerId);
    others.push(c);
    if (others.length === 3) break;
  }
  if (others.length < 3) {
    console.log('  Scenario seed: not enough distinct customers, skipping.');
    return { scheduleIds: [] };
  }

  const [schA, schB, schD] = others;
  const collectorCache = new Map<string, ShopCollector>();
  const scheduleIds: string[] = [];

  // ---------------- Scenario A: Happy path ----------------
  {
    const primaries = await resetSchedule(prisma, schA.id);
    const collector = await getCollector(prisma, schA.sale.shopId, collectorCache);
    // Pay first 2 installments on time
    for (let i = 0; i < Math.min(2, primaries.length); i++) {
      const inst = primaries[i];
      const payDate = addDays(new Date(inst.dueDate), -1); // a day early
      await prisma.installmentPayment.create({
        data: {
          installmentId: inst.id,
          amount: inst.amountDue,
          paymentMode: 'upi',
          paymentDate: payDate,
          collectedBy: collector,
          referenceNumber: `DEMO-A-${i + 1}`,
        },
      });
      await prisma.installment.update({
        where: { id: inst.id },
        data: { amountPaid: inst.amountDue, remainingAmount: 0, status: 'paid' },
      });
      await prisma.installmentRollLog.create({
        data: {
          scheduleId: schA.id,
          installmentId: inst.id,
          eventType: 'installment_due',
          eventDate: inst.dueDate,
          displayMessage: `Installment #${inst.installmentNumber} (${INR(Number(inst.amountDue))}) became due.`,
        },
      });
      await prisma.installmentRollLog.create({
        data: {
          scheduleId: schA.id,
          installmentId: inst.id,
          eventType: 'payment_recorded',
          eventDate: payDate,
          displayMessage: `Installment #${inst.installmentNumber} fully paid ${INR(Number(inst.amountDue))} via UPI.`,
          actorUserId: collector,
          metadata: { amount: Number(inst.amountDue), mode: 'upi' },
        },
      });
    }
    scheduleIds.push(schA.id);
  }

  // ---------------- Scenario B: Primary overdue + active sub ----------------
  // Flow: #1 paid on time, #2 became due → partial payment with future promise
  // (creates #2.1) → #2.1 promise date was today → sub is due_today; primary
  // #2 remains `rescheduled` with remaining carry.
  {
    const primaries = await resetSchedule(prisma, schB.id);
    const collector = await getCollector(prisma, schB.sale.shopId, collectorCache);
    if (primaries.length >= 3) {
      const p1 = primaries[0];
      const p2 = primaries[1];

      // #1 paid
      const p1Paid = addDays(new Date(p1.dueDate), 0);
      await prisma.installmentPayment.create({
        data: {
          installmentId: p1.id,
          amount: p1.amountDue,
          paymentMode: 'cash',
          paymentDate: p1Paid,
          collectedBy: collector,
          referenceNumber: 'DEMO-B-1',
        },
      });
      await prisma.installment.update({
        where: { id: p1.id },
        data: { amountPaid: p1.amountDue, remainingAmount: 0, status: 'paid' },
      });
      await prisma.installmentRollLog.create({
        data: {
          scheduleId: schB.id,
          installmentId: p1.id,
          eventType: 'payment_recorded',
          eventDate: p1Paid,
          displayMessage: `Installment #1 fully paid ${INR(Number(p1.amountDue))} in cash.`,
          actorUserId: collector,
          metadata: { amount: Number(p1.amountDue), mode: 'cash' },
        },
      });

      // #2 partial (say 40%)
      const p2Due = Number(p2.amountDue);
      const partialAmt = Math.round(p2Due * 0.4 * 100) / 100;
      const remainder = Math.round((p2Due - partialAmt) * 100) / 100;
      const partialDate = addDays(new Date(p2.dueDate), 3);
      await prisma.installmentPayment.create({
        data: {
          installmentId: p2.id,
          amount: partialAmt,
          paymentMode: 'cash',
          paymentDate: partialDate,
          collectedBy: collector,
          referenceNumber: 'DEMO-B-2a',
          notes: 'Partial; promised remainder later',
        },
      });
      await prisma.installment.update({
        where: { id: p2.id },
        data: {
          amountPaid: partialAmt,
          remainingAmount: remainder,
          status: 'rescheduled',
          isRescheduled: true,
          notes: 'Partial on due date; remainder rescheduled.',
        },
      });
      await prisma.installmentRollLog.create({
        data: {
          scheduleId: schB.id,
          installmentId: p2.id,
          eventType: 'partial_payment',
          eventDate: partialDate,
          displayMessage: `Partial payment ${INR(partialAmt)} recorded on #2. Remainder ${INR(remainder)} promised for ${fmtDate(today)}.`,
          actorUserId: collector,
          metadata: { partialAmount: partialAmt, remainder, promiseDate: fmtDate(today) },
        },
      });

      // Create sub #2.1 due today
      const subId = randomUUID();
      await prisma.installment.create({
        data: {
          id: subId,
          scheduleId: schB.id,
          installmentNumber: p2.installmentNumber,
          parentInstallmentNumber: p2.installmentNumber,
          subSequence: 1,
          dueDate: today,
          amountDue: remainder,
          amountPaid: 0,
          remainingAmount: remainder,
          status: 'due_today',
          rescheduledFromId: p2.id,
          notes: 'Auto-created by partial-with-promise.',
        },
      });
      await prisma.installmentRollLog.create({
        data: {
          scheduleId: schB.id,
          installmentId: subId,
          eventType: 'sub_created',
          eventDate: partialDate,
          displayMessage: `Sub-installment #${p2.installmentNumber}.1 (${INR(remainder)}) created, due ${fmtDate(today)}.`,
          actorUserId: collector,
          metadata: {
            parentInstallmentNumber: p2.installmentNumber,
            subSequence: 1,
            amount: remainder,
          },
        },
      });
      await prisma.installmentRollLog.create({
        data: {
          scheduleId: schB.id,
          installmentId: subId,
          eventType: 'installment_due',
          eventDate: today,
          displayMessage: `Sub-installment #${p2.installmentNumber}.1 (${INR(remainder)}) became due.`,
        },
      });
    }
    scheduleIds.push(schB.id);
  }

  // ---------------- Scenario C: Chain absorbed into next primary ----------------
  // #1 paid, #2 never collected, #3's due date arrived → Rule C absorbed #2
  // balance into #3. #2 status=overdue,isClosed=true. #3 amountDue bumped.
  {
    const primaries = await resetSchedule(prisma, schC.id);
    const collector = await getCollector(prisma, schC.sale.shopId, collectorCache);
    if (primaries.length >= 4) {
      const p1 = primaries[0];
      const p2 = primaries[1];
      const p3 = primaries[2];

      // #1 paid
      const p1Paid = addDays(new Date(p1.dueDate), 1);
      await prisma.installmentPayment.create({
        data: {
          installmentId: p1.id,
          amount: p1.amountDue,
          paymentMode: 'bank_transfer',
          paymentDate: p1Paid,
          collectedBy: collector,
          referenceNumber: 'DEMO-C-1',
        },
      });
      await prisma.installment.update({
        where: { id: p1.id },
        data: { amountPaid: p1.amountDue, remainingAmount: 0, status: 'paid' },
      });
      await prisma.installmentRollLog.create({
        data: {
          scheduleId: schC.id,
          installmentId: p1.id,
          eventType: 'payment_recorded',
          eventDate: p1Paid,
          displayMessage: `Installment #1 fully paid ${INR(Number(p1.amountDue))} via bank transfer.`,
          actorUserId: collector,
          metadata: { amount: Number(p1.amountDue), mode: 'bank_transfer' },
        },
      });

      // #2 chain absorbed — mark overdue + closed, carry to #3
      const carry = Number(p2.amountDue);
      await prisma.installment.update({
        where: { id: p2.id },
        data: {
          amountPaid: 0,
          remainingAmount: 0, // fully carried forward
          status: 'overdue',
          isClosed: true,
          notes: 'Chain absorbed into next primary on rollover.',
        },
      });

      // #3 absorbs the carry. Its natural dueDate is today or in the recent
      // past (enforced by the candidate picker). Status mirrors reality:
      //   dueDate == today → due_today;   dueDate < today → overdue.
      const newAmount = Number(p3.amountDue) + carry;
      const p3Due = toDateOnly(new Date(p3.dueDate));
      const isP3Today = p3Due.getTime() === today.getTime();
      await prisma.installment.update({
        where: { id: p3.id },
        data: {
          amountDue: newAmount,
          remainingAmount: newAmount,
          status: isP3Today ? 'due_today' : 'overdue',
          notes: `Absorbed remainder ${INR(carry)} from installment #${p2.installmentNumber}.`,
        },
      });

      await prisma.installmentRollLog.create({
        data: {
          scheduleId: schC.id,
          installmentId: p2.id,
          eventType: 'installment_due',
          eventDate: p2.dueDate,
          displayMessage: `Installment #${p2.installmentNumber} (${INR(carry)}) became due.`,
        },
      });
      await prisma.installmentRollLog.create({
        data: {
          scheduleId: schC.id,
          installmentId: p2.id,
          eventType: 'chain_absorbed',
          eventDate: p3Due,
          displayMessage: `Chain #${p2.installmentNumber} absorbed: ${INR(carry)} merged into #${p3.installmentNumber}. New total ${INR(newAmount)}.`,
          metadata: {
            carry,
            absorbedIntoInstallmentNumber: p3.installmentNumber,
            newAmountDue: newAmount,
          },
        },
      });
      await prisma.installmentRollLog.create({
        data: {
          scheduleId: schC.id,
          installmentId: p3.id,
          eventType: 'installment_due',
          eventDate: p3Due,
          displayMessage: `Installment #${p3.installmentNumber} (${INR(newAmount)}) became due.`,
        },
      });
    }
    scheduleIds.push(schC.id);
  }

  // ---------------- Scenario D: Partial with future promise ----------------
  // #1 had partial on due date, sub #1.1 promised 7 days in the future
  // (upcoming). Demonstrates the "sub_created" branch with a future promise.
  {
    const primaries = await resetSchedule(prisma, schD.id);
    const collector = await getCollector(prisma, schD.sale.shopId, collectorCache);
    if (primaries.length >= 2) {
      const p1 = primaries[0];
      const p1Due = Number(p1.amountDue);
      const partial = Math.round(p1Due * 0.6 * 100) / 100;
      const remainder = Math.round((p1Due - partial) * 100) / 100;
      const partialDate = addDays(today, -2);
      const promise = addDays(today, 7);

      await prisma.installmentPayment.create({
        data: {
          installmentId: p1.id,
          amount: partial,
          paymentMode: 'upi',
          paymentDate: partialDate,
          collectedBy: collector,
          referenceNumber: 'DEMO-D-1a',
          notes: 'Partial; promised remainder in 7 days',
        },
      });
      await prisma.installment.update({
        where: { id: p1.id },
        data: {
          amountPaid: partial,
          remainingAmount: remainder,
          status: 'rescheduled',
          isRescheduled: true,
          notes: 'Partial on due date; remainder rescheduled.',
        },
      });
      await prisma.installmentRollLog.create({
        data: {
          scheduleId: schD.id,
          installmentId: p1.id,
          eventType: 'partial_payment',
          eventDate: partialDate,
          displayMessage: `Partial payment ${INR(partial)} recorded on #1. Remainder ${INR(remainder)} promised for ${fmtDate(promise)}.`,
          actorUserId: collector,
          metadata: { partialAmount: partial, remainder, promiseDate: fmtDate(promise) },
        },
      });

      const subId = randomUUID();
      await prisma.installment.create({
        data: {
          id: subId,
          scheduleId: schD.id,
          installmentNumber: p1.installmentNumber,
          parentInstallmentNumber: p1.installmentNumber,
          subSequence: 1,
          dueDate: promise,
          amountDue: remainder,
          amountPaid: 0,
          remainingAmount: remainder,
          status: 'upcoming',
          rescheduledFromId: p1.id,
          notes: 'Auto-created by partial-with-promise.',
        },
      });
      await prisma.installmentRollLog.create({
        data: {
          scheduleId: schD.id,
          installmentId: subId,
          eventType: 'sub_created',
          eventDate: partialDate,
          displayMessage: `Sub-installment #${p1.installmentNumber}.1 (${INR(remainder)}) created, due ${fmtDate(promise)}.`,
          actorUserId: collector,
          metadata: {
            parentInstallmentNumber: p1.installmentNumber,
            subSequence: 1,
            amount: remainder,
          },
        },
      });
    }
    scheduleIds.push(schD.id);
  }

  // ---------------- Scenario E: Current due_today / recently overdue ----------------
  // Primary #1's natural date is today or within the last 3 days. Flip status
  // to match, emit installment_due event on that date. No date rewrite.
  {
    const primaries = await resetSchedule(prisma, schE.id);
    if (primaries.length >= 1) {
      const p1 = primaries[0];
      const p1Due = toDateOnly(new Date(p1.dueDate));
      const isToday = p1Due.getTime() === today.getTime();
      await prisma.installment.update({
        where: { id: p1.id },
        data: { status: isToday ? 'due_today' : 'overdue' },
      });
      await prisma.installmentRollLog.create({
        data: {
          scheduleId: schE.id,
          installmentId: p1.id,
          eventType: 'installment_due',
          eventDate: p1Due,
          displayMessage: `Installment #${p1.installmentNumber} (${INR(Number(p1.amountDue))}) became due.`,
        },
      });
    }
    scheduleIds.push(schE.id);
  }

  console.log(`  Rolling-overdue scenarios crafted for ${scheduleIds.length} schedules.`);
  return { scheduleIds };
}
