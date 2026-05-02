/**
 * Clean up stale "interest applied" rows on installment #12 of
 * SALE-VE-20250501-001 left over from earlier testing of the (now-fixed)
 * Apply Interest button. Rolls each row back through the same service path
 * normal users would, so audit trails are properly recorded.
 */
import { PrismaClient } from '@prisma/client';
import { installmentsService } from '../../src/modules/installments/installments.service.js';

const p = new PrismaClient();

(async () => {
  const sale = await p.saleRecord.findFirst({
    where: { saleNumber: 'SALE-VE-20250501-001' },
    include: {
      installmentSchedule: {
        include: {
          installments: { where: { installmentNumber: 12 } },
          interestApplications: { where: { rolledBackAt: null } },
        },
      },
    },
  });
  if (!sale) {
    console.log('Sale not found');
    return;
  }
  const owner = await p.user.findFirst({
    where: { username: 'vinod_owner' },
    select: { id: true },
  });
  if (!owner) {
    console.log('vinod_owner not found');
    return;
  }
  const apps = sale.installmentSchedule!.interestApplications;
  console.log(`Found ${apps.length} active interest application(s) to roll back.`);
  for (const a of apps) {
    console.log(`  Rolling back ${a.id} (₹${String(a.appliedAmount)})`);
    await installmentsService.rollbackInterestApplication(
      a.id,
      { reason: 'Test-data cleanup: stale Apply-Interest entries from pre-fix dialog' },
      owner.id,
    );
  }
  // Verify
  const after = await p.installment.findFirst({
    where: { scheduleId: sale.installmentSchedule!.id, installmentNumber: 12 },
    select: { amountDue: true, remainingAmount: true, status: true },
  });
  console.log('After cleanup, installment #12:', {
    amountDue: String(after?.amountDue),
    remainingAmount: String(after?.remainingAmount),
    status: after?.status,
  });
  await p.$disconnect();
})();
