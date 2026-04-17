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

  // Helper: get employee for a shop
  async function getEmployee(shopCode: string) {
    return prisma.user.findUnique({
      where: { username: `${shopCode.toLowerCase()}_emp1` },
    });
  }

  const veEmp = await getEmployee('VE');
  const neEmp = await getEmployee('NE');
  const vhaEmp = await getEmployee('VHA');
  const nheEmp = await getEmployee('NHE');

  // Map shop IDs to employees
  const shopIdToEmployee: Record<string, typeof veEmp> = {};
  for (const schedule of schedules) {
    const shopId = schedule.sale.shopId;
    if (!shopIdToEmployee[shopId]) {
      // Find which shop this belongs to
      if (veEmp) {
        const veShop = await prisma.userShop.findFirst({ where: { userId: veEmp.id, shopId } });
        if (veShop) shopIdToEmployee[shopId] = veEmp;
      }
      if (neEmp && !shopIdToEmployee[shopId]) {
        const neShop = await prisma.userShop.findFirst({ where: { userId: neEmp.id, shopId } });
        if (neShop) shopIdToEmployee[shopId] = neEmp;
      }
      if (vhaEmp && !shopIdToEmployee[shopId]) {
        const vhaShop = await prisma.userShop.findFirst({ where: { userId: vhaEmp.id, shopId } });
        if (vhaShop) shopIdToEmployee[shopId] = vhaEmp;
      }
      if (nheEmp && !shopIdToEmployee[shopId]) {
        const nheShop = await prisma.userShop.findFirst({ where: { userId: nheEmp.id, shopId } });
        if (nheShop) shopIdToEmployee[shopId] = nheEmp;
      }
    }
  }

  for (const schedule of schedules) {
    const ledger = schedule.sale.ledgerNumber;
    const emp = shopIdToEmployee[schedule.sale.shopId];

    // Check if we already have any payments (idempotent seeding)
    const existingPayments = await prisma.installmentPayment.findFirst({
      where: { installment: { scheduleId: schedule.id } },
    });
    if (existingPayments) {
      continue; // Already seeded payment history
    }

    // =====================================================================
    // HISTORICAL SALE H1: VE010 — Dec 2025, 9 months self-finance, nearly complete
    // EMI #1 (Jan 15): PAID on time, cash
    // EMI #2 (Feb 15): PAID on time, UPI
    // EMI #3 (Mar 15): PAID 5 days late (Mar 20), cash
    // EMI #4 (Apr 15): PARTIALLY PAID (60%), remainder rescheduled to Apr 22
    // EMI #5-9: UPCOMING
    // =====================================================================
    if (ledger === 'VE010' && schedule.installments.length >= 4) {
      const [inst1, inst2, inst3, inst4] = schedule.installments;

      // EMI #1: Paid on time (Jan 15 2026), cash
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
          paymentDate: inst1.dueDate, // Jan 15 2026
          collectedBy: emp?.id ?? null,
          notes: 'Collected on time by employee visit.',
        },
      });

      // EMI #2: Paid on time (Feb 15 2026), UPI
      await prisma.installment.update({
        where: { id: inst2.id },
        data: {
          amountPaid: inst2.amountDue,
          remainingAmount: 0,
          status: 'paid',
          notes: 'Paid in full via UPI on due date.',
        },
      });
      await prisma.installmentPayment.create({
        data: {
          installmentId: inst2.id,
          amount: Number(inst2.amountDue),
          paymentMode: 'upi',
          paymentDate: inst2.dueDate, // Feb 15 2026
          collectedBy: emp?.id ?? null,
          referenceNumber: 'UPI-VE-202602-010',
          notes: 'Paid via UPI.',
        },
      });

      // EMI #3: Paid 5 days late (Mar 20 2026), cash
      const inst3LateDate = new Date(inst3.dueDate);
      inst3LateDate.setDate(inst3LateDate.getDate() + 5);
      await prisma.installment.update({
        where: { id: inst3.id },
        data: {
          amountPaid: inst3.amountDue,
          remainingAmount: 0,
          status: 'paid',
          notes: 'Paid 5 days late on Mar 20.',
        },
      });
      await prisma.installmentPayment.create({
        data: {
          installmentId: inst3.id,
          amount: Number(inst3.amountDue),
          paymentMode: 'cash',
          paymentDate: inst3LateDate, // Mar 20 2026
          collectedBy: emp?.id ?? null,
          notes: 'Late payment collected via employee visit. 5 days overdue.',
        },
      });

      // EMI #4: Partially paid (60%) on Apr 15 2026, remainder rescheduled to Apr 22
      const partialAmount4 = Math.round(Number(inst4.amountDue) * 0.6);
      const remainder4 = Number(inst4.amountDue) - partialAmount4;

      await prisma.installment.update({
        where: { id: inst4.id },
        data: {
          amountPaid: partialAmount4,
          remainingAmount: remainder4,
          status: 'partially_paid',
          notes: `Partial payment of ${partialAmount4}. Remaining ${remainder4} rescheduled to Apr 22.`,
        },
      });
      await prisma.installmentPayment.create({
        data: {
          installmentId: inst4.id,
          amount: partialAmount4,
          paymentMode: 'cash',
          paymentDate: inst4.dueDate, // Apr 15 2026
          collectedBy: emp?.id ?? null,
          notes: 'Partial payment. Customer promised remainder on rescheduled date.',
        },
      });

      // Create rescheduled installment for the remainder — Apr 22 2026
      const rescheduledDate4 = new Date('2026-04-22');
      await prisma.installment.create({
        data: {
          scheduleId: schedule.id,
          installmentNumber: inst4.installmentNumber, // same number
          dueDate: rescheduledDate4,
          amountDue: remainder4,
          amountPaid: 0,
          remainingAmount: remainder4,
          status: 'upcoming',
          isRescheduled: false,
          rescheduledFromId: inst4.id,
          notes: `Remainder from partial payment on installment #${inst4.installmentNumber}. Original due: ${new Date(inst4.dueDate).toISOString().split('T')[0]}.`,
        },
      });

      // Create employee collection assignment
      if (emp) {
        const existingAssignment = await prisma.employeeCollectionAssignment.findFirst({
          where: { employeeId: emp.id, scheduleId: schedule.id },
        });
        if (!existingAssignment) {
          await prisma.employeeCollectionAssignment.create({
            data: {
              employeeId: emp.id,
              scheduleId: schedule.id,
              shopId: schedule.sale.shopId,
              isActive: true,
            },
          });
        }
      }
    }

    // =====================================================================
    // HISTORICAL SALE H2: NE010 — Jan 2026, 12 months self-finance, early stage
    // EMI #1 (Feb 10): PAID, cash
    // EMI #2 (Mar 10): PAID, UPI
    // EMI #3 (Apr 10): OVERDUE (not paid yet, 7 days overdue as of Apr 17)
    // EMI #4-12: UPCOMING
    // =====================================================================
    if (ledger === 'NE010' && schedule.installments.length >= 3) {
      const [inst1, inst2, inst3] = schedule.installments;

      // EMI #1: Paid on time (Feb 10 2026), cash
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
          paymentDate: inst1.dueDate, // Feb 10 2026
          collectedBy: emp?.id ?? null,
          notes: 'Collected on time.',
        },
      });

      // EMI #2: Paid on time (Mar 10 2026), UPI
      await prisma.installment.update({
        where: { id: inst2.id },
        data: {
          amountPaid: inst2.amountDue,
          remainingAmount: 0,
          status: 'paid',
          notes: 'Paid in full via UPI.',
        },
      });
      await prisma.installmentPayment.create({
        data: {
          installmentId: inst2.id,
          amount: Number(inst2.amountDue),
          paymentMode: 'upi',
          paymentDate: inst2.dueDate, // Mar 10 2026
          collectedBy: emp?.id ?? null,
          referenceNumber: 'UPI-NE-202603-010',
          notes: 'Paid via UPI on due date.',
        },
      });

      // EMI #3: OVERDUE (Apr 10 2026, not paid)
      await prisma.installment.update({
        where: { id: inst3.id },
        data: {
          status: 'overdue',
          notes: 'Customer did not pay on due date. Follow up required. 7+ days overdue.',
        },
      });

      // Create employee collection assignment
      if (emp) {
        const existingAssignment = await prisma.employeeCollectionAssignment.findFirst({
          where: { employeeId: emp.id, scheduleId: schedule.id },
        });
        if (!existingAssignment) {
          await prisma.employeeCollectionAssignment.create({
            data: {
              employeeId: emp.id,
              scheduleId: schedule.id,
              shopId: schedule.sale.shopId,
              isActive: true,
            },
          });
        }
      }
    }

    // =====================================================================
    // HISTORICAL SALE H3: NH010 — Feb 2026, 6 months self-finance
    // EMI #1 (Mar 20): PAID, cash
    // EMI #2 (Apr 20): UPCOMING (3 days from today Apr 17)
    // EMI #3-6: UPCOMING
    // =====================================================================
    if (ledger === 'NH010' && schedule.installments.length >= 2) {
      const [inst1] = schedule.installments;

      // EMI #1: Paid on time (Mar 20 2026), cash
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
          paymentDate: inst1.dueDate, // Mar 20 2026
          collectedBy: emp?.id ?? null,
          notes: 'Collected on time.',
        },
      });

      // EMI #2-6 remain as 'upcoming' — no action needed (already created as upcoming by sales seed)

      // Create employee collection assignment
      if (emp) {
        const existingAssignment = await prisma.employeeCollectionAssignment.findFirst({
          where: { employeeId: emp.id, scheduleId: schedule.id },
        });
        if (!existingAssignment) {
          await prisma.employeeCollectionAssignment.create({
            data: {
              employeeId: emp.id,
              scheduleId: schedule.id,
              shopId: schedule.sale.shopId,
              isActive: true,
            },
          });
        }
      }
    }

    // =====================================================================
    // ORIGINAL SALE VA001 — VHA, Amit's 12-month self-finance
    // (Original behavior: inst #1 paid, #2 partial + reschedule, #3 overdue)
    // =====================================================================
    if (ledger === 'VA001' && schedule.installments.length >= 3) {
      const [inst1, inst2, inst3] = schedule.installments;

      // Installment #1: Fully paid (cash, collected by vha_emp1)
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
          notes: 'Collected on time by employee visit.',
        },
      });

      // Installment #2: Partially paid + rescheduled remainder
      const partialAmount = Math.round(Number(inst2.amountDue) * 0.6);
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
          notes: 'Partial payment. Customer promised remainder on rescheduled date.',
        },
      });

      // Create rescheduled installment for remainder — 5 days after original due
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

      // Installment #3: Overdue
      await prisma.installment.update({
        where: { id: inst3.id },
        data: {
          status: 'overdue',
          notes: 'Customer did not pay on due date. Follow up required.',
        },
      });

      // Create employee collection assignment
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

    // =====================================================================
    // ORIGINAL SALE VE002 — VE, Mohit's 6-month self-finance
    // (Original behavior: inst #1 paid via UPI)
    // =====================================================================
    if (ledger === 'VE002' && schedule.installments.length >= 1) {
      const [inst1] = schedule.installments;

      // Installment #1: Fully paid (UPI, collected by ve_emp1)
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

      // Create employee collection assignment
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
