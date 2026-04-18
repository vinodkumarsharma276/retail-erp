import type { PrismaClient, InstallmentSchedule } from '@prisma/client';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Bulk installments payment-history seed.
//
// For each self_finance InstallmentSchedule, simulate realistic payment
// progression based on schedule age:
//   - Older schedules (>9 months):   60-90% of past-due EMIs paid
//   - Mid-age schedules (3-9 months): 40-70% of past-due EMIs paid
//   - Newer schedules (<3 months):    0-40% of past-due EMIs paid
//
// For paid installments: creates one InstallmentPayment, sets status = 'paid'.
// Some past-due remain unpaid → status = 'overdue' (already set by sales seed).
// ---------------------------------------------------------------------------

function rand(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

export async function seedInstallments(
  prisma: PrismaClient,
  _sales: unknown,
): Promise<InstallmentSchedule[]> {
  const schedules = await prisma.installmentSchedule.findMany({
    include: {
      installments: { orderBy: { installmentNumber: 'asc' } },
      sale: { select: { shopId: true, saleDate: true, ledgerNumber: true } },
    },
  });
  if (schedules.length === 0) return [];

  // Skip if payments already exist
  const existingPayments = await prisma.installmentPayment.count();
  if (existingPayments > 100) return schedules;

  // Find a collector (employee) per shop
  const shopCollectorMap: Record<string, string | null> = {};

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const paymentRows: any[] = [];
  const installmentUpdates: Array<{ id: string; data: any }> = [];

  let seedBase = 20000;

  for (const schedule of schedules) {
    const scheduleAgeDays = Math.floor(
      (today.getTime() - new Date(schedule.sale.saleDate).getTime()) / (1000 * 60 * 60 * 24),
    );

    let paidRatio: number;
    if (scheduleAgeDays > 270) paidRatio = 0.6 + rand(seedBase++) * 0.3;
    else if (scheduleAgeDays > 90) paidRatio = 0.4 + rand(seedBase++) * 0.3;
    else paidRatio = rand(seedBase++) * 0.4;

    // Ensure collector resolved (cached per shop)
    if (!(schedule.sale.shopId in shopCollectorMap)) {
      const shop = await prisma.shop.findUnique({ where: { id: schedule.sale.shopId } });
      if (shop) {
        const emp = await prisma.user.findUnique({
          where: { username: `${shop.code.toLowerCase()}_emp1` },
        });
        shopCollectorMap[schedule.sale.shopId] = emp?.id ?? null;
      }
    }
    const collectorId = shopCollectorMap[schedule.sale.shopId];

    for (const inst of schedule.installments) {
      const dueTime = new Date(inst.dueDate).getTime();
      const isPastDue = dueTime <= today.getTime();
      if (!isPastDue) continue; // upcoming stays upcoming

      const shouldPay = rand(seedBase++) < paidRatio;
      if (!shouldPay) {
        // Leave as overdue/due_today (already set)
        continue;
      }

      // Payment date: between dueDate - 2 and dueDate + 14 (some on time, some late)
      const dayOffset = Math.floor(rand(seedBase++) * 16) - 2;
      const paymentDate = new Date(inst.dueDate);
      paymentDate.setDate(paymentDate.getDate() + dayOffset);
      if (paymentDate.getTime() > today.getTime()) paymentDate.setTime(today.getTime());

      const modes = ['cash', 'upi', 'bank_transfer'] as const;
      const mode = modes[Math.floor(rand(seedBase++) * modes.length)];

      paymentRows.push({
        id: randomUUID(),
        installmentId: inst.id,
        amount: inst.amountDue,
        paymentMode: mode,
        paymentDate,
        collectedBy: collectorId,
        referenceNumber: `COLL-${pad(seedBase, 8)}`,
      });

      installmentUpdates.push({
        id: inst.id,
        data: {
          amountPaid: inst.amountDue,
          remainingAmount: 0,
          status: 'paid',
        },
      });
    }
  }

  console.log(`  Inserting ${paymentRows.length} installment payments...`);
  const CHUNK = 500;
  for (let i = 0; i < paymentRows.length; i += CHUNK) {
    await prisma.installmentPayment.createMany({ data: paymentRows.slice(i, i + CHUNK) });
  }

  // Apply installment updates in batches
  console.log(`  Updating ${installmentUpdates.length} installment statuses...`);
  for (const u of installmentUpdates) {
    await prisma.installment.update({ where: { id: u.id }, data: u.data });
  }

  return schedules;
}
