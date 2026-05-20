/**
 * Read-only diagnostic for ledger VE0083 — dumps the current schedule state
 * (installments + recent roll-log entries) so we can understand what went
 * wrong when paying / reverting installment #8.
 *
 * Usage:
 *   cd apps/api
 *   npx tsx prisma/seed/inspect-ve0083.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const LEDGER = 'VE0083';

function formatDate(d: Date | null | undefined): string {
  if (!d) return '—';
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    .toISOString()
    .split('T')[0];
}

async function main() {
  const sale = await prisma.saleRecord.findFirst({
    where: { ledgerNumber: LEDGER },
    select: { id: true, saleNumber: true, ledgerNumber: true, pendingAmount: true, completedAt: true },
  });
  if (!sale) {
    console.log(`No sale for ${LEDGER}`);
    return;
  }
  const schedule = await prisma.installmentSchedule.findFirst({
    where: { saleId: sale.id },
  });
  if (!schedule) {
    console.log(`No schedule for ${LEDGER}`);
    return;
  }
  console.log('Sale:', sale);
  console.log('Schedule:', schedule);
  console.log();

  const insts = await prisma.installment.findMany({
    where: { scheduleId: schedule.id },
    orderBy: [{ installmentNumber: 'asc' }, { subSequence: 'asc' }],
    include: {
      payments: { orderBy: { createdAt: 'asc' } },
    },
  });
  console.log('=== Installments ===');
  for (const i of insts) {
    const label =
      i.parentInstallmentNumber != null && i.subSequence != null
        ? `#${i.parentInstallmentNumber}.${i.subSequence}`
        : `#${i.installmentNumber}`;
    console.log(
      `${label.padEnd(6)} due=${formatDate(i.dueDate)} due=${i.amountDue}` +
        ` paid=${i.amountPaid} rem=${i.remainingAmount} status=${i.status.padEnd(15)}` +
        ` isResched=${i.isRescheduled} rescheduledFromId=${i.rescheduledFromId ?? '—'}` +
        ` notes=${JSON.stringify(i.notes)}`,
    );
    for (const p of i.payments) {
      console.log(
        `         payment id=${p.id.slice(0, 8)} amount=${p.amount} mode=${p.paymentMode}` +
          ` date=${formatDate(p.paymentDate)} createdAt=${p.createdAt.toISOString()} notes=${JSON.stringify(p.notes)}`,
      );
    }
  }

  console.log();
  console.log('=== Roll log (last 40, newest first) ===');
  const logs = await prisma.installmentRollLog.findMany({
    where: { scheduleId: schedule.id },
    orderBy: [{ eventDate: 'desc' }, { createdAt: 'desc' }],
    take: 40,
    include: { actor: { select: { fullName: true, username: true } } },
  });
  for (const l of logs) {
    console.log(
      `${l.eventDate.toISOString().slice(0, 10)} ${l.eventType.padEnd(22)} ` +
        `actor=${l.actor?.fullName ?? l.actor?.username ?? '—'} ` +
        `instId=${l.installmentId?.slice(0, 8) ?? '—'} ` +
        `\n   msg=${l.displayMessage}` +
        `\n   meta=${JSON.stringify(l.metadata)}`,
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
