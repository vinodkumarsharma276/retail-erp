import type { PrismaClient, SaleRecord, InstallmentSchedule } from '@prisma/client';

export async function seedInstallments(
  prisma: PrismaClient,
  sales: SaleRecord[],
): Promise<InstallmentSchedule[]> {
  if (sales.length === 0) {
    return [];
  }

  const selfFinanceSaleIds = sales
    .filter((s) => s.saleType === 'self_finance')
    .map((s) => s.id);

  if (selfFinanceSaleIds.length === 0) {
    return [];
  }

  const schedules = await prisma.installmentSchedule.findMany({
    where: { saleId: { in: selfFinanceSaleIds } },
    include: {
      installments: {
        orderBy: { installmentNumber: 'asc' },
      },
      sale: {
        select: {
          saleNumber: true,
          shopId: true,
          ledgerNumber: true,
        },
      },
    },
  });

  // Find VHA employee user (vha_emp1) for collection recording
  const vhaEmp = await prisma.user.findUnique({
    where: { username: 'vha_emp1' },
  });

  // Find VE employee user (ve_emp1) for collection recording
  const veEmp = await prisma.user.findUnique({
    where: { username: 've_emp1' },
  });

  for (const schedule of schedules) {
    // Determine which schedule this is by checking the sale's ledger number
    const isAmitSchedule = schedule.sale.ledgerNumber === 'VHA-2026-001'; // Amit's 12-month (VHA)
    const isMohitSchedule = schedule.sale.ledgerNumber === 'VE-2026-002'; // Mohit's 6-month (VE)

    // Check if we already have any payments (idempotent seeding)
    const existingPayments = await prisma.installmentPayment.findFirst({
      where: { installment: { scheduleId: schedule.id } },
    });
    if (existingPayments) {
      continue; // Already seeded payment history
    }

    if (isAmitSchedule && schedule.installments.length >= 3) {
      const inst1 = schedule.installments[0]; // Installment #1
      const inst2 = schedule.installments[1]; // Installment #2
      const inst3 = schedule.installments[2]; // Installment #3

      // --- Installment #1: Fully paid (cash, collected by vha_emp1) ---
      await prisma.installment.update({
        where: { id: inst1.id },
        data: {
          amountPaid: inst1.amountDue,
          remainingAmount: 0,
          status: 'paid',
          notes: 'Paid in full on due date.',
        },
      });

      await prisma.installmentPayment.create({
        data: {
          installmentId: inst1.id,
          amount: Number(inst1.amountDue),
          paymentMode: 'cash',
          paymentDate: inst1.dueDate,
          collectedBy: vhaEmp?.id ?? null,
          referenceNumber: null,
          notes: 'Collected on time by employee visit.',
        },
      });

      // --- Installment #2: Partially paid + rescheduled remainder ---
      const partialAmount = Math.round(Number(inst2.amountDue) * 0.6); // 60% paid
      const remainderAmount = Number(inst2.amountDue) - partialAmount;

      await prisma.installment.update({
        where: { id: inst2.id },
        data: {
          amountPaid: partialAmount,
          remainingAmount: remainderAmount,
          status: 'partially_paid',
          notes: `Partial payment of ${partialAmount}. Remaining ${remainderAmount} rescheduled.`,
        },
      });

      await prisma.installmentPayment.create({
        data: {
          installmentId: inst2.id,
          amount: partialAmount,
          paymentMode: 'cash',
          paymentDate: inst2.dueDate,
          collectedBy: vhaEmp?.id ?? null,
          referenceNumber: null,
          notes: `Partial payment. Customer promised remainder on rescheduled date.`,
        },
      });

      // Create rescheduled installment for the remainder — 5 days after original due date
      const rescheduledDate = new Date(inst2.dueDate);
      rescheduledDate.setDate(rescheduledDate.getDate() + 5);

      await prisma.installment.create({
        data: {
          scheduleId: schedule.id,
          installmentNumber: inst2.installmentNumber,
          dueDate: rescheduledDate,
          amountDue: remainderAmount,
          amountPaid: 0,
          remainingAmount: remainderAmount,
          status: 'upcoming',
          isRescheduled: false,
          rescheduledFromId: inst2.id,
          notes: `Remainder from partial payment on installment #${inst2.installmentNumber}. Original due: ${new Date(inst2.dueDate).toISOString().split('T')[0]}.`,
        },
      });

      // --- Installment #3: Overdue ---
      await prisma.installment.update({
        where: { id: inst3.id },
        data: {
          status: 'overdue',
          notes: 'Customer did not pay on due date. Follow up required.',
        },
      });

      // Create employee collection assignment for VHA schedule
      if (vhaEmp) {
        const existingAssignment = await prisma.employeeCollectionAssignment.findFirst({
          where: { employeeId: vhaEmp.id, scheduleId: schedule.id },
        });
        if (!existingAssignment) {
          await prisma.employeeCollectionAssignment.create({
            data: {
              employeeId: vhaEmp.id,
              scheduleId: schedule.id,
              shopId: schedule.sale.shopId,
              isActive: true,
            },
          });
        }
      }
    }

    if (isMohitSchedule && schedule.installments.length >= 1) {
      const inst1 = schedule.installments[0]; // Installment #1

      // --- Installment #1: Fully paid (UPI, collected by ve_emp1) ---
      await prisma.installment.update({
        where: { id: inst1.id },
        data: {
          amountPaid: inst1.amountDue,
          remainingAmount: 0,
          status: 'paid',
          notes: 'Paid in full via UPI.',
        },
      });

      await prisma.installmentPayment.create({
        data: {
          installmentId: inst1.id,
          amount: Number(inst1.amountDue),
          paymentMode: 'upi',
          paymentDate: inst1.dueDate,
          collectedBy: veEmp?.id ?? null,
          referenceNumber: 'UPI-VE-202604-001',
          notes: 'Collected via UPI during employee visit.',
        },
      });

      // Create employee collection assignment for VE schedule
      if (veEmp) {
        const existingAssignment = await prisma.employeeCollectionAssignment.findFirst({
          where: { employeeId: veEmp.id, scheduleId: schedule.id },
        });
        if (!existingAssignment) {
          await prisma.employeeCollectionAssignment.create({
            data: {
              employeeId: veEmp.id,
              scheduleId: schedule.id,
              shopId: schedule.sale.shopId,
              isActive: true,
            },
          });
        }
      }
    }
  }

  // Re-fetch to return updated schedules
  const updatedSchedules = await prisma.installmentSchedule.findMany({
    where: { saleId: { in: selfFinanceSaleIds } },
  });

  return updatedSchedules;
}
