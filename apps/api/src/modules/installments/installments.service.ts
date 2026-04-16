import { prisma } from '../../config/database.js';
import type { Prisma } from '@prisma/client';

export const installmentsService = {
  /**
   * List installment schedules for a shop, with optional status filter.
   * Shop-scoped via sale.shopId.
   */
  async listSchedules(
    shopId: string,
    filters: {
      skip: number;
      take: number;
      page: number;
      pageSize: number;
      status?: string;
    },
  ) {
    const where: Prisma.InstallmentScheduleWhereInput = {
      sale: { shopId },
    };

    if (filters.status) {
      where.status = filters.status;
    }

    const [schedules, totalItems] = await Promise.all([
      prisma.installmentSchedule.findMany({
        where,
        include: {
          sale: {
            select: {
              id: true,
              saleNumber: true,
              saleDate: true,
              totalAmount: true,
              downPayment: true,
              customer: {
                select: {
                  id: true,
                  name: true,
                  phone: true,
                  customerCode: true,
                },
              },
              product: {
                select: {
                  id: true,
                  brand: true,
                  modelNumber: true,
                  serialNumber: true,
                  category: { select: { id: true, name: true } },
                },
              },
              shop: {
                select: { id: true, name: true, code: true },
              },
            },
          },
          installments: {
            where: { isRescheduled: false },
            select: {
              id: true,
              status: true,
              amountPaid: true,
              amountDue: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: filters.skip,
        take: filters.take,
      }),
      prisma.installmentSchedule.count({ where }),
    ]);

    // Enrich with summary: paid count, overdue count, total collected
    const enriched = schedules.map((schedule) => {
      const paidCount = schedule.installments.filter((i) => i.status === 'paid').length;
      const overdueCount = schedule.installments.filter((i) => i.status === 'overdue').length;
      const totalCollected = schedule.installments.reduce(
        (sum, i) => sum + Number(i.amountPaid),
        0,
      );
      const { installments: _omit, ...rest } = schedule;
      return {
        ...rest,
        summary: {
          paidCount,
          overdueCount,
          totalInstallments: schedule.installments.length,
          totalCollected,
        },
      };
    });

    return { schedules: enriched, totalItems };
  },

  /**
   * Get all overdue installments for a shop.
   * Overdue = dueDate < today AND status NOT in [paid, rescheduled].
   */
  async getOverdue(shopId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const overdueInstallments = await prisma.installment.findMany({
      where: {
        dueDate: { lt: today },
        status: { notIn: ['paid', 'rescheduled'] },
        isRescheduled: false,
        schedule: {
          sale: { shopId },
          status: 'active',
        },
      },
      include: {
        schedule: {
          select: {
            id: true,
            emiAmount: true,
            totalPayable: true,
            sale: {
              select: {
                id: true,
                saleNumber: true,
                saleDate: true,
                customer: {
                  select: {
                    id: true,
                    name: true,
                    phone: true,
                    customerCode: true,
                    addressLine1: true,
                    city: true,
                  },
                },
                product: {
                  select: {
                    id: true,
                    brand: true,
                    modelNumber: true,
                    category: { select: { id: true, name: true } },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { dueDate: 'asc' },
    });

    // Enrich with days overdue
    return overdueInstallments.map((inst) => ({
      ...inst,
      daysOverdue: Math.floor(
        (today.getTime() - new Date(inst.dueDate).getTime()) / (1000 * 60 * 60 * 24),
      ),
    }));
  },

  /**
   * Get all installments due on a specific date for a shop.
   * This is THE daily collection list — the core feature for employees.
   * Optionally filter by assigned employee.
   */
  async getCollectionsForDate(
    shopId: string,
    date: string,
    employeeId?: string,
  ) {
    const targetDate = new Date(date);
    targetDate.setHours(0, 0, 0, 0);

    // Build the base where clause
    const where: Prisma.InstallmentWhereInput = {
      dueDate: targetDate,
      status: { notIn: ['paid', 'rescheduled'] },
      isRescheduled: false,
      schedule: {
        sale: { shopId },
        status: 'active',
      },
    };

    // If employeeId is provided, filter by assigned employee
    if (employeeId) {
      where.schedule = {
        ...where.schedule as object,
        collectionAssigns: {
          some: {
            employeeId,
            isActive: true,
          },
        },
      };
    }

    const collections = await prisma.installment.findMany({
      where,
      include: {
        schedule: {
          select: {
            id: true,
            emiAmount: true,
            numInstallments: true,
            totalPayable: true,
            sale: {
              select: {
                id: true,
                saleNumber: true,
                ledgerNumber: true,
                saleDate: true,
                totalAmount: true,
                downPayment: true,
                customer: {
                  select: {
                    id: true,
                    name: true,
                    phone: true,
                    customerCode: true,
                    addressLine1: true,
                    addressLine2: true,
                    city: true,
                    pincode: true,
                  },
                },
                product: {
                  select: {
                    id: true,
                    brand: true,
                    modelNumber: true,
                    serialNumber: true,
                    category: { select: { id: true, name: true } },
                  },
                },
                guarantor: {
                  select: {
                    id: true,
                    name: true,
                    phone: true,
                  },
                },
              },
            },
            collectionAssigns: {
              where: { isActive: true },
              select: {
                employee: {
                  select: { id: true, fullName: true, username: true },
                },
              },
            },
          },
        },
        payments: {
          orderBy: { paymentDate: 'desc' },
          select: {
            id: true,
            amount: true,
            paymentMode: true,
            paymentDate: true,
          },
        },
        // Include rescheduled-from info so we can show notes about rescheduled installments
        rescheduledFrom: {
          select: {
            id: true,
            installmentNumber: true,
            dueDate: true,
            amountDue: true,
            notes: true,
          },
        },
      },
      orderBy: [
        { schedule: { sale: { customer: { name: 'asc' } } } },
        { installmentNumber: 'asc' },
      ],
    });

    // Also find installments where a rescheduled version exists on a LATER date
    // but the original due date is today — these should show with a note
    const rescheduledNotes = await prisma.installment.findMany({
      where: {
        dueDate: targetDate,
        status: 'rescheduled',
        isRescheduled: true,
        schedule: {
          sale: { shopId },
          status: 'active',
        },
      },
      include: {
        rescheduledTo: {
          select: {
            id: true,
            dueDate: true,
            amountDue: true,
            status: true,
          },
        },
        schedule: {
          select: {
            id: true,
            sale: {
              select: {
                saleNumber: true,
                customer: {
                  select: { id: true, name: true, phone: true },
                },
              },
            },
          },
        },
      },
    });

    return { collections, rescheduledNotes };
  },

  /**
   * Full schedule detail with all installments, payments, and rescheduling chain.
   */
  async getScheduleDetail(scheduleId: string) {
    const schedule = await prisma.installmentSchedule.findUnique({
      where: { id: scheduleId },
      include: {
        sale: {
          select: {
            id: true,
            saleNumber: true,
            ledgerNumber: true,
            saleDate: true,
            saleType: true,
            totalAmount: true,
            downPayment: true,
            interestRate: true,
            fileCharge: true,
            numInstallments: true,
            emiAmount: true,
            customer: {
              select: {
                id: true,
                name: true,
                phone: true,
                customerCode: true,
                addressLine1: true,
                city: true,
                aadhaarNumber: true,
              },
            },
            product: {
              select: {
                id: true,
                brand: true,
                modelNumber: true,
                serialNumber: true,
                category: { select: { id: true, name: true } },
              },
            },
            guarantor: {
              select: {
                id: true,
                name: true,
                phone: true,
                customerCode: true,
                addressLine1: true,
                city: true,
              },
            },
            shop: {
              select: { id: true, name: true, code: true },
            },
          },
        },
        installments: {
          orderBy: [{ installmentNumber: 'asc' }, { createdAt: 'asc' }],
          include: {
            payments: {
              include: {
                collector: {
                  select: { id: true, username: true, fullName: true },
                },
              },
              orderBy: { paymentDate: 'desc' },
            },
            rescheduledFrom: {
              select: {
                id: true,
                installmentNumber: true,
                dueDate: true,
                amountDue: true,
              },
            },
            rescheduledTo: {
              select: {
                id: true,
                installmentNumber: true,
                dueDate: true,
                amountDue: true,
                status: true,
              },
            },
          },
        },
        collectionAssigns: {
          where: { isActive: true },
          select: {
            employee: {
              select: { id: true, fullName: true, username: true },
            },
          },
        },
      },
    });

    return schedule;
  },

  /**
   * Build a timeline view for a schedule showing chronological events:
   * - Schedule created
   * - Each installment due
   * - Payments made
   * - Rescheduling events
   */
  async getTimeline(scheduleId: string) {
    const schedule = await prisma.installmentSchedule.findUnique({
      where: { id: scheduleId },
      include: {
        sale: {
          select: {
            saleNumber: true,
            saleDate: true,
            customer: { select: { name: true } },
          },
        },
        installments: {
          orderBy: [{ installmentNumber: 'asc' }, { createdAt: 'asc' }],
          include: {
            payments: {
              include: {
                collector: {
                  select: { id: true, fullName: true },
                },
              },
              orderBy: { paymentDate: 'asc' },
            },
            rescheduledFrom: {
              select: {
                id: true,
                installmentNumber: true,
                dueDate: true,
              },
            },
          },
        },
      },
    });

    if (!schedule) {
      return null;
    }

    type TimelineEvent = {
      type: 'schedule_created' | 'installment_due' | 'payment' | 'rescheduled' | 'partial_payment' | 'completed';
      date: Date | string;
      installmentNumber?: number;
      installmentId?: string;
      amount?: number;
      amountDue?: number;
      remainingAmount?: number;
      paymentMode?: string;
      collectedBy?: string;
      rescheduledFromNumber?: number;
      rescheduledFromDate?: Date | string;
      newDate?: Date | string;
      status?: string;
      notes?: string;
    };

    const timeline: TimelineEvent[] = [];

    // 1. Schedule created
    timeline.push({
      type: 'schedule_created',
      date: schedule.createdAt,
      notes: `Installment schedule created for sale ${schedule.sale.saleNumber}. ${schedule.numInstallments} installments of ${Number(schedule.emiAmount)} each. Customer: ${schedule.sale.customer.name}.`,
    });

    // 2. Walk through each installment
    for (const inst of schedule.installments) {
      // If this installment was rescheduled FROM another, mark it as a reschedule event
      if (inst.rescheduledFrom) {
        timeline.push({
          type: 'rescheduled',
          date: inst.createdAt,
          installmentNumber: inst.installmentNumber,
          installmentId: inst.id,
          amountDue: Number(inst.amountDue),
          rescheduledFromNumber: inst.rescheduledFrom.installmentNumber,
          rescheduledFromDate: inst.rescheduledFrom.dueDate,
          newDate: inst.dueDate,
          notes: inst.notes ?? `Installment #${inst.rescheduledFrom.installmentNumber} rescheduled from ${new Date(inst.rescheduledFrom.dueDate).toISOString().split('T')[0]} to ${new Date(inst.dueDate).toISOString().split('T')[0]}`,
        });
      }

      // Installment due event (only for non-rescheduled originals or active rescheduled ones)
      if (!inst.isRescheduled) {
        timeline.push({
          type: 'installment_due',
          date: inst.dueDate,
          installmentNumber: inst.installmentNumber,
          installmentId: inst.id,
          amountDue: Number(inst.amountDue),
          remainingAmount: Number(inst.remainingAmount),
          status: inst.status,
        });
      }

      // Payment events
      for (const payment of inst.payments) {
        const isPartial = inst.status === 'partially_paid' || Number(payment.amount) < Number(inst.amountDue);
        timeline.push({
          type: isPartial ? 'partial_payment' : 'payment',
          date: payment.paymentDate,
          installmentNumber: inst.installmentNumber,
          installmentId: inst.id,
          amount: Number(payment.amount),
          paymentMode: payment.paymentMode,
          collectedBy: payment.collector?.fullName ?? undefined,
          notes: payment.notes ?? undefined,
        });
      }

      // If original was rescheduled, show the rescheduled event
      if (inst.isRescheduled && inst.status === 'rescheduled') {
        timeline.push({
          type: 'rescheduled',
          date: inst.updatedAt,
          installmentNumber: inst.installmentNumber,
          installmentId: inst.id,
          amountDue: Number(inst.amountDue),
          status: 'rescheduled',
          notes: inst.notes ?? `Installment #${inst.installmentNumber} was rescheduled`,
        });
      }
    }

    // 3. If schedule is completed
    if (schedule.status === 'completed') {
      timeline.push({
        type: 'completed',
        date: schedule.updatedAt,
        notes: 'All installments have been paid. Schedule completed.',
      });
    }

    // Sort by date
    timeline.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    return {
      scheduleId: schedule.id,
      saleNumber: schedule.sale.saleNumber,
      customerName: schedule.sale.customer.name,
      totalPayable: Number(schedule.totalPayable),
      numInstallments: schedule.numInstallments,
      emiAmount: Number(schedule.emiAmount),
      status: schedule.status,
      timeline,
    };
  },

  /**
   * Record a payment — handles ALL 3 scenarios in a single method.
   *
   * Scenario 1: full_payment — Mark installment as paid, create payment record
   * Scenario 2: reschedule — Mark original as rescheduled, create new installment on new date
   * Scenario 3: partial_reschedule — Record partial payment, create new installment for remainder
   *
   * After payment: check if ALL installments in the schedule are paid → update schedule status.
   */
  async recordPayment(
    installmentId: string,
    data: {
      scenario: 'full_payment' | 'reschedule' | 'partial_reschedule';
      amountPaid?: number;
      paymentMode?: string;
      newDate?: string;
      referenceNumber?: string;
      notes?: string;
    },
    userId: string,
  ) {
    // 1. Fetch installment with schedule
    const installment = await prisma.installment.findUnique({
      where: { id: installmentId },
      include: {
        schedule: {
          include: {
            sale: { select: { shopId: true, saleNumber: true } },
          },
        },
      },
    });

    if (!installment) {
      throw new Error('Installment not found');
    }

    if (installment.status === 'paid') {
      throw new Error('Installment is already fully paid');
    }

    if (installment.isRescheduled && installment.status === 'rescheduled') {
      throw new Error('Installment has been rescheduled. Pay the rescheduled installment instead.');
    }

    const remainingAmount = Number(installment.remainingAmount);
    const schedule = installment.schedule;

    // 2. Execute scenario in a transaction
    const result = await prisma.$transaction(async (tx) => {
      let paymentRecord = null;
      let newInstallment = null;

      if (data.scenario === 'full_payment') {
        // Validate amount
        const amount = data.amountPaid!;
        if (amount < remainingAmount) {
          throw new Error(
            `Amount ${amount} is less than remaining amount ${remainingAmount}. Use partial_reschedule scenario instead.`,
          );
        }

        // Mark installment as paid
        await tx.installment.update({
          where: { id: installmentId },
          data: {
            amountPaid: { increment: amount },
            remainingAmount: 0,
            status: 'paid',
            notes: data.notes ?? null,
          },
        });

        // Create payment record
        paymentRecord = await tx.installmentPayment.create({
          data: {
            installmentId,
            amount,
            paymentMode: data.paymentMode as any,
            paymentDate: new Date(),
            collectedBy: userId,
            referenceNumber: data.referenceNumber ?? null,
            notes: data.notes ?? null,
          },
        });
      } else if (data.scenario === 'reschedule') {
        const newDate = new Date(data.newDate!);

        // Mark original as rescheduled
        await tx.installment.update({
          where: { id: installmentId },
          data: {
            isRescheduled: true,
            status: 'rescheduled',
            notes: data.notes ?? `Rescheduled to ${data.newDate}`,
          },
        });

        // Create new installment on the new date
        newInstallment = await tx.installment.create({
          data: {
            scheduleId: schedule.id,
            installmentNumber: installment.installmentNumber,
            dueDate: newDate,
            amountDue: Number(installment.remainingAmount),
            amountPaid: 0,
            remainingAmount: Number(installment.remainingAmount),
            status: 'upcoming',
            isRescheduled: false,
            rescheduledFromId: installmentId,
            notes: data.notes ?? `Rescheduled from ${new Date(installment.dueDate).toISOString().split('T')[0]}. Original installment #${installment.installmentNumber}.`,
          },
        });
      } else if (data.scenario === 'partial_reschedule') {
        const amount = data.amountPaid!;
        const newDate = new Date(data.newDate!);

        if (amount >= remainingAmount) {
          throw new Error(
            `Partial amount ${amount} must be less than remaining amount ${remainingAmount}. Use full_payment scenario instead.`,
          );
        }

        const newRemainingAmount = remainingAmount - amount;

        // Update original installment with partial payment
        await tx.installment.update({
          where: { id: installmentId },
          data: {
            amountPaid: { increment: amount },
            remainingAmount: newRemainingAmount,
            status: 'partially_paid',
            notes: data.notes ?? `Partial payment of ${amount}. Remaining ${newRemainingAmount} rescheduled to ${data.newDate}.`,
          },
        });

        // Create payment record for the partial amount
        paymentRecord = await tx.installmentPayment.create({
          data: {
            installmentId,
            amount,
            paymentMode: data.paymentMode as any,
            paymentDate: new Date(),
            collectedBy: userId,
            referenceNumber: data.referenceNumber ?? null,
            notes: data.notes ?? `Partial payment. Remaining ${newRemainingAmount} rescheduled.`,
          },
        });

        // Create new installment for the remaining amount on the new date
        newInstallment = await tx.installment.create({
          data: {
            scheduleId: schedule.id,
            installmentNumber: installment.installmentNumber,
            dueDate: newDate,
            amountDue: newRemainingAmount,
            amountPaid: 0,
            remainingAmount: newRemainingAmount,
            status: 'upcoming',
            isRescheduled: false,
            rescheduledFromId: installmentId,
            notes: `Remainder from partial payment on installment #${installment.installmentNumber}. Original due: ${new Date(installment.dueDate).toISOString().split('T')[0]}.`,
          },
        });
      }

      // Check if ALL non-rescheduled installments in this schedule are now paid
      const unpaidCount = await tx.installment.count({
        where: {
          scheduleId: schedule.id,
          isRescheduled: false,
          status: { notIn: ['paid', 'rescheduled'] },
        },
      });

      if (unpaidCount === 0) {
        await tx.installmentSchedule.update({
          where: { id: schedule.id },
          data: { status: 'completed' },
        });
      }

      return { paymentRecord, newInstallment };
    });

    // Return updated installment with full details
    const updated = await prisma.installment.findUnique({
      where: { id: installmentId },
      include: {
        payments: {
          include: {
            collector: {
              select: { id: true, username: true, fullName: true },
            },
          },
          orderBy: { paymentDate: 'desc' },
        },
        rescheduledTo: {
          select: {
            id: true,
            installmentNumber: true,
            dueDate: true,
            amountDue: true,
            status: true,
          },
        },
        schedule: {
          select: {
            id: true,
            status: true,
            sale: {
              select: {
                saleNumber: true,
                customer: { select: { name: true, phone: true } },
              },
            },
          },
        },
      },
    });

    return {
      installment: updated,
      newInstallment: result.newInstallment,
      payment: result.paymentRecord,
    };
  },

  /**
   * Dedicated reschedule method (Scenario 2).
   * Creates new installment on the new date, marks original as rescheduled.
   */
  async reschedule(
    installmentId: string,
    data: { newDate: string; notes?: string },
  ) {
    const installment = await prisma.installment.findUnique({
      where: { id: installmentId },
      include: {
        schedule: {
          select: { id: true, status: true },
        },
      },
    });

    if (!installment) {
      throw new Error('Installment not found');
    }

    if (installment.status === 'paid') {
      throw new Error('Cannot reschedule a paid installment');
    }

    if (installment.isRescheduled && installment.status === 'rescheduled') {
      throw new Error('Installment has already been rescheduled');
    }

    const newDate = new Date(data.newDate);

    const result = await prisma.$transaction(async (tx) => {
      // Mark original as rescheduled
      await tx.installment.update({
        where: { id: installmentId },
        data: {
          isRescheduled: true,
          status: 'rescheduled',
          notes: data.notes ?? `Rescheduled to ${data.newDate}`,
        },
      });

      // Create new installment on new date
      const newInstallment = await tx.installment.create({
        data: {
          scheduleId: installment.schedule.id,
          installmentNumber: installment.installmentNumber,
          dueDate: newDate,
          amountDue: Number(installment.remainingAmount),
          amountPaid: 0,
          remainingAmount: Number(installment.remainingAmount),
          status: 'upcoming',
          isRescheduled: false,
          rescheduledFromId: installmentId,
          notes: data.notes ?? `Rescheduled from ${new Date(installment.dueDate).toISOString().split('T')[0]}. Original installment #${installment.installmentNumber}.`,
        },
      });

      return newInstallment;
    });

    // Return with full details
    const newInstallment = await prisma.installment.findUnique({
      where: { id: result.id },
      include: {
        rescheduledFrom: {
          select: {
            id: true,
            installmentNumber: true,
            dueDate: true,
            amountDue: true,
          },
        },
        schedule: {
          select: {
            id: true,
            sale: {
              select: {
                saleNumber: true,
                customer: { select: { name: true, phone: true } },
              },
            },
          },
        },
      },
    });

    return newInstallment;
  },
};
