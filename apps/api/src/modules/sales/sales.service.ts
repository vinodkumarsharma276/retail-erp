import { prisma } from '../../config/database.js';
import type { Prisma } from '@prisma/client';
import { generateSaleNumber } from '../../utils/id-generator.js';
import { calculateEMI } from '@retailerp/shared-utils';

export const salesService = {
  /**
   * Create a sale — the most complex method. Handles all 4 sale types
   * in a single Prisma transaction with dual-write to sale_records + sale_records_sanitized.
   */
  async create(shopId: string, data: {
    productId: string;
    customerId: string;
    ledgerNumber: string;
    saleDate?: string;
    saleType: 'full_payment' | 'partial_with_promise' | 'self_finance' | 'company_finance';
    sellingPrice: number;
    discountAmount?: number;
    gstRate?: number;
    downPayment?: number;
    paymentMode: string;
    paymentBreakdown?: Array<{mode: string; amount: number}> | null;
    promiseDate?: string | null;
    interestRate?: number | null;
    fileCharge?: number | null;
    numInstallments?: number | null;
    guarantorId?: string | null;
    financeCompanyId?: string | null;
    financedAmount?: number | null;
    expectedPaymentDate?: string | null;
    notes?: string | null;
  }, userId: string, options?: { autoApprove?: boolean }) {
    // 1. Validate product exists, is in_stock, belongs to this shop
    const product = await prisma.product.findUnique({
      where: { id: data.productId },
      include: {
        shop: { select: { id: true, code: true } },
        purchase: { select: { invoiceDate: true } },
      },
    });
    if (!product) {
      throw new Error('Product not found');
    }
    if (product.shopId !== shopId) {
      throw new Error('Product does not belong to this shop');
    }
    if (product.status !== 'in_stock') {
      throw new Error('Product is not available for sale');
    }

    // 2. Validate customer exists
    const customer = await prisma.customer.findUnique({
      where: { id: data.customerId },
    });
    if (!customer) {
      throw new Error('Customer not found');
    }

    // Validate guarantor if self_finance
    if (data.saleType === 'self_finance') {
      if (!data.guarantorId) {
        throw new Error('Guarantor is required for self-finance sales');
      }
      const guarantor = await prisma.customer.findUnique({
        where: { id: data.guarantorId },
      });
      if (!guarantor) {
        throw new Error('Guarantor not found');
      }
      if (!data.numInstallments || data.numInstallments < 1) {
        throw new Error('Number of installments is required for self-finance sales');
      }
      if (data.interestRate === undefined || data.interestRate === null) {
        throw new Error('Interest rate is required for self-finance sales');
      }
    }

    // Validate finance company if company_finance
    if (data.saleType === 'company_finance') {
      if (!data.financeCompanyId) {
        throw new Error('Finance company is required for company-finance sales');
      }
      const financeCompany = await prisma.financeCompany.findUnique({
        where: { id: data.financeCompanyId },
      });
      if (!financeCompany) {
        throw new Error('Finance company not found');
      }
    }

    // 3. Generate saleNumber
    const saleDate = data.saleDate ? new Date(data.saleDate) : new Date();
    const shopCode = product.shop.code.toUpperCase();

    // Sale date cannot be before the product's purchase invoice date, nor in the future.
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    if (saleDate.getTime() > today.getTime()) {
      throw new Error('Sale date cannot be in the future');
    }
    if (product.purchase?.invoiceDate) {
      const invoiceDate = new Date(product.purchase.invoiceDate);
      invoiceDate.setHours(0, 0, 0, 0);
      const saleDay = new Date(saleDate);
      saleDay.setHours(0, 0, 0, 0);
      if (saleDay.getTime() < invoiceDate.getTime()) {
        throw new Error(
          `Sale date cannot be before the product's purchase invoice date (${invoiceDate.toISOString().slice(0, 10)})`,
        );
      }
    }

    const lastSale = await prisma.saleRecord.findFirst({
      where: {
        saleNumber: { startsWith: `SALE-${shopCode}-` },
      },
      orderBy: { saleNumber: 'desc' },
      select: { saleNumber: true },
    });

    let saleNumber = generateSaleNumber(shopCode, saleDate, lastSale?.saleNumber ?? undefined);

    // 4. Calculate financials
    const sellingPrice = data.sellingPrice;
    const discountAmount = data.discountAmount ?? 0;
    const gstRate = data.gstRate ?? 0;
    const downPayment = data.downPayment ?? 0;
    const fileCharge = data.fileCharge ?? 0;
    const interestRate = data.interestRate ?? 0;
    const numInstallments = data.numInstallments ?? 0;

    // Selling price is GST-inclusive. Extract GST via reverse calculation.
    const gstAmount = gstRate > 0 ? Math.round(sellingPrice * gstRate / (100 + gstRate)) : 0;
    const netAmount = sellingPrice - gstAmount; // Pre-tax base price
    const totalAmount = sellingPrice; // SP is already GST-inclusive

    // Snapshot DP and calculate input GST (ITC) from purchase price
    const purchasePrice = Number(product.purchasePrice);
    const purchaseGstAmount = gstRate > 0 ? Math.round(purchasePrice * gstRate / (100 + gstRate)) : 0;

    // For self_finance: use calculateEMI to compute financing details
    let totalFinancedAmount: number | null = null;
    let emiAmount: number | null = null;
    let emiResult: ReturnType<typeof calculateEMI> | null = null;
    let effectiveMonthlyRate: number | null = null;

    if (data.saleType === 'self_finance') {
      emiResult = calculateEMI({
        sellingPrice, // SP is already GST-inclusive
        downPayment,
        interestRate,
        fileCharge,
        numInstallments,
      });
      totalFinancedAmount = emiResult.totalPayable;
      emiAmount = emiResult.emiAmount;
      // Effective monthly rate blends the interest % per month with the file
      // charge spread across the tenure: interest + (fileCharge / principal / months) × 100.
      const principal = sellingPrice - downPayment;
      if (principal > 0 && numInstallments > 0) {
        effectiveMonthlyRate =
          Math.round(
            (interestRate + (fileCharge / principal / numInstallments) * 100) * 1000,
          ) / 1000;
      } else {
        effectiveMonthlyRate = interestRate;
      }
    }

    // For partial_with_promise: calculate pending amount
    let pendingAmount = 0;
    if (data.saleType === 'partial_with_promise') {
      pendingAmount = totalAmount - downPayment;
    }

    // For company_finance
    const financedAmount = data.saleType === 'company_finance' ? (data.financedAmount ?? totalAmount - downPayment) : null;
    const expectedPaymentDate = data.saleType === 'company_finance'
      ? (data.expectedPaymentDate ? new Date(data.expectedPaymentDate) : (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d; })())
      : null;

    // 5-9. Create everything in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Re-generate sale number inside the transaction to prevent race conditions
      const txLastSale = await tx.saleRecord.findFirst({
        where: { saleNumber: { startsWith: `SALE-${shopCode}-` } },
        orderBy: { saleNumber: 'desc' },
        select: { saleNumber: true },
      });
      saleNumber = generateSaleNumber(shopCode, saleDate, txLastSale?.saleNumber ?? undefined);

      // 5. Create SaleRecord
      const saleRecord = await tx.saleRecord.create({
        data: {
          saleNumber,
          ledgerNumber: data.ledgerNumber,
          shopId,
          productId: data.productId,
          customerId: data.customerId,
          saleDate,
          saleType: data.saleType as any,
          mrp: Number(product.mrp),
          sellingPrice,
          discountAmount,
          netAmount,
          gstRate,
          gstAmount,
          purchasePrice,
          purchaseGstAmount,
          totalAmount,
          downPayment,
          paymentMode: data.paymentMode as any,
          paymentBreakdown: data.paymentBreakdown ?? null,
          // Partial with promise
          promiseDate: data.saleType === 'partial_with_promise' && data.promiseDate
            ? new Date(data.promiseDate)
            : null,
          pendingAmount,
          // Self finance
          interestRate: data.saleType === 'self_finance' ? interestRate : null,
          fileCharge: data.saleType === 'self_finance' ? fileCharge : 0,
          effectiveMonthlyRate,
          totalFinancedAmount,
          numInstallments: data.saleType === 'self_finance' ? numInstallments : null,
          emiAmount,
          guarantorId: data.saleType === 'self_finance' ? data.guarantorId : null,
          // Company finance
          financeCompanyId: data.saleType === 'company_finance' ? data.financeCompanyId : null,
          financedAmount,
          expectedPaymentDate,
          financePaymentStatus: data.saleType === 'company_finance' ? 'pending' as any : null,
          financePaymentReceivedDate: null,
          financeReferenceNumber: null,
          // Completion — full_payment sales are complete at creation; other
          // types transition to completed when their money flow settles.
          completedAt: data.saleType === 'full_payment' ? new Date() : null,
          // Approval — sales created by users with `sales.approve` are
          // auto-approved; others land in 'pending' until reviewed.
          approvalStatus: options?.autoApprove ? 'approved' : 'pending' as any,
          approvedById: options?.autoApprove ? userId : null,
          approvedAt: options?.autoApprove ? new Date() : null,
          // Metadata
          notes: data.notes ?? null,
          createdBy: userId,
        },
      });

      // 6. Create SaleRecordSanitized — ALWAYS, regardless of sale type
      // Same id as SaleRecord. saleType is ALWAYS 'full_payment', paymentMode is ALWAYS 'cash'
      await tx.saleRecordSanitized.create({
        data: {
          id: saleRecord.id,
          saleNumber,
          ledgerNumber: data.ledgerNumber,
          shopId,
          productId: data.productId,
          customerId: data.customerId,
          saleDate,
          saleType: 'full_payment',
          sellingPrice,
          totalAmount,
          paymentMode: 'cash',
          createdBy: userId,
        },
      });

      // 7. Update Product status to 'sold'
      await tx.product.update({
        where: { id: data.productId },
        data: { status: 'sold' },
      });

      // 8. Create ProductAuditTrail entry
      await tx.productAuditTrail.create({
        data: {
          productId: data.productId,
          eventType: 'sold',
          toShopId: shopId,
          referenceId: saleRecord.id,
          referenceType: 'sale',
          performedBy: userId,
          notes: `Sold to ${customer.name} (${customer.customerCode}), Sale: ${saleNumber}`,
        },
      });

      // 9. If self_finance: Create InstallmentSchedule + individual Installment records
      if (data.saleType === 'self_finance' && emiResult) {
        const schedule = await tx.installmentSchedule.create({
          data: {
            saleId: saleRecord.id,
            totalPrincipal: emiResult.principal,
            totalInterest: emiResult.totalInterest,
            fileCharge: emiResult.fileCharge,
            totalPayable: emiResult.totalPayable,
            numInstallments: emiResult.schedule.length,
            emiAmount: emiResult.emiAmount,
            startDate: new Date(emiResult.schedule[0].dueDate),
            status: 'active',
          },
        });

        // Create individual installment records
        for (const inst of emiResult.schedule) {
          await tx.installment.create({
            data: {
              scheduleId: schedule.id,
              installmentNumber: inst.installmentNumber,
              dueDate: new Date(inst.dueDate),
              amountDue: inst.amount,
              amountPaid: 0,
              remainingAmount: inst.amount,
              status: 'upcoming',
              isRescheduled: false,
            },
          });
        }
      }

      return saleRecord;
    });

    // 10. Return the created sale with all relations
    const fullSale = await prisma.saleRecord.findUnique({
      where: { id: result.id },
      include: {
        product: {
          select: {
            id: true,
            brand: true,
            modelNumber: true,
            serialNumber: true,
            category: { select: { id: true, name: true, slug: true, hsnCode: true } },
          },
        },
        customer: {
          select: { id: true, name: true, phone: true, customerCode: true },
        },
        guarantor: {
          select: { id: true, name: true, phone: true, customerCode: true },
        },
        financeCompany: {
          select: { id: true, name: true, code: true },
        },
        shop: {
          select: { id: true, name: true, code: true },
        },
        creator: {
          select: { id: true, username: true, fullName: true },
        },
        installmentSchedule: {
          include: {
            installments: {
              orderBy: [{ dueDate: 'asc' }, { installmentNumber: 'asc' }],
            },
          },
        },
      },
    });

    return fullSale;
  },

  /**
   * Update an existing sale — full edit per user policy:
   * any installment payments, finance payment status, and partial-promise
   * settlements ARE RESET. Installment schedule is rebuilt from scratch.
   * productId and saleType cannot be changed.
   */
  async update(saleId: string, shopId: string, data: {
    productId: string;
    customerId: string;
    ledgerNumber: string;
    saleDate?: string;
    saleType: 'full_payment' | 'partial_with_promise' | 'self_finance' | 'company_finance';
    sellingPrice: number;
    discountAmount?: number;
    gstRate?: number;
    downPayment?: number;
    paymentMode: string;
    paymentBreakdown?: Array<{mode: string; amount: number}> | null;
    promiseDate?: string | null;
    interestRate?: number | null;
    fileCharge?: number | null;
    numInstallments?: number | null;
    guarantorId?: string | null;
    financeCompanyId?: string | null;
    financedAmount?: number | null;
    expectedPaymentDate?: string | null;
    notes?: string | null;
  }, userId: string) {
    // Load existing sale
    const existing = await prisma.saleRecord.findUnique({
      where: { id: saleId },
      include: {
        product: { include: { purchase: { select: { invoiceDate: true } } } },
        installmentSchedule: { include: { installments: { select: { id: true } } } },
      },
    });
    if (!existing) {
      throw new Error('Sale not found');
    }
    if (existing.shopId !== shopId) {
      throw new Error('Sale does not belong to this shop');
    }
    if (existing.productId !== data.productId) {
      throw new Error('Product cannot be changed when editing a sale');
    }
    const saleTypeChanged = existing.saleType !== data.saleType;

    // Validate customer exists
    const customer = await prisma.customer.findUnique({ where: { id: data.customerId } });
    if (!customer) {
      throw new Error('Customer not found');
    }

    // Validate guarantor / finance company by saleType
    if (data.saleType === 'self_finance') {
      if (!data.guarantorId) throw new Error('Guarantor is required for self-finance sales');
      const g = await prisma.customer.findUnique({ where: { id: data.guarantorId } });
      if (!g) throw new Error('Guarantor not found');
      if (!data.numInstallments || data.numInstallments < 1) {
        throw new Error('Number of installments is required for self-finance sales');
      }
      if (data.interestRate === undefined || data.interestRate === null) {
        throw new Error('Interest rate is required for self-finance sales');
      }
    }
    if (data.saleType === 'company_finance') {
      if (!data.financeCompanyId) throw new Error('Finance company is required for company-finance sales');
      const fc = await prisma.financeCompany.findUnique({ where: { id: data.financeCompanyId } });
      if (!fc) throw new Error('Finance company not found');
    }

    // Validate sale date
    const saleDate = data.saleDate ? new Date(data.saleDate) : existing.saleDate;
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    if (saleDate.getTime() > today.getTime()) {
      throw new Error('Sale date cannot be in the future');
    }
    if (existing.product.purchase?.invoiceDate) {
      const invoiceDate = new Date(existing.product.purchase.invoiceDate);
      invoiceDate.setHours(0, 0, 0, 0);
      const saleDay = new Date(saleDate);
      saleDay.setHours(0, 0, 0, 0);
      if (saleDay.getTime() < invoiceDate.getTime()) {
        throw new Error(
          `Sale date cannot be before the product's purchase invoice date (${invoiceDate.toISOString().slice(0, 10)})`,
        );
      }
    }

    // Recalculate financials
    const sellingPrice = data.sellingPrice;
    const discountAmount = data.discountAmount ?? 0;
    const gstRate = data.gstRate ?? 0;
    const downPayment = data.downPayment ?? 0;
    const fileCharge = data.fileCharge ?? 0;
    const interestRate = data.interestRate ?? 0;
    const numInstallments = data.numInstallments ?? 0;

    const gstAmount = gstRate > 0 ? Math.round(sellingPrice * gstRate / (100 + gstRate)) : 0;
    const netAmount = sellingPrice - gstAmount;
    const totalAmount = sellingPrice;

    const purchasePrice = Number(existing.product.purchasePrice);
    const purchaseGstAmount = gstRate > 0 ? Math.round(purchasePrice * gstRate / (100 + gstRate)) : 0;

    let totalFinancedAmount: number | null = null;
    let emiAmount: number | null = null;
    let emiResult: ReturnType<typeof calculateEMI> | null = null;
    let effectiveMonthlyRate: number | null = null;

    if (data.saleType === 'self_finance') {
      emiResult = calculateEMI({
        sellingPrice,
        downPayment,
        interestRate,
        fileCharge,
        numInstallments,
      });
      totalFinancedAmount = emiResult.totalPayable;
      emiAmount = emiResult.emiAmount;
      const principal = sellingPrice - downPayment;
      if (principal > 0 && numInstallments > 0) {
        effectiveMonthlyRate =
          Math.round(
            (interestRate + (fileCharge / principal / numInstallments) * 100) * 1000,
          ) / 1000;
      } else {
        effectiveMonthlyRate = interestRate;
      }
    }

    let pendingAmount = 0;
    if (data.saleType === 'partial_with_promise') {
      pendingAmount = totalAmount - downPayment;
    }

    const financedAmount = data.saleType === 'company_finance'
      ? (data.financedAmount ?? totalAmount - downPayment)
      : null;
    const expectedPaymentDate = data.saleType === 'company_finance'
      ? (data.expectedPaymentDate ? new Date(data.expectedPaymentDate) : (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d; })())
      : null;

    await prisma.$transaction(async (tx) => {
      // Snapshot of pre-edit values for audit log
      const beforeValues = {
        ledgerNumber: existing.ledgerNumber,
        customerId: existing.customerId,
        saleDate: existing.saleDate,
        saleType: existing.saleType,
        sellingPrice: Number(existing.sellingPrice),
        discountAmount: Number(existing.discountAmount ?? 0),
        gstRate: Number(existing.gstRate ?? 0),
        downPayment: Number(existing.downPayment ?? 0),
        paymentMode: existing.paymentMode,
        promiseDate: existing.promiseDate,
        interestRate: existing.interestRate !== null ? Number(existing.interestRate) : null,
        fileCharge: existing.fileCharge !== null ? Number(existing.fileCharge) : null,
        numInstallments: existing.numInstallments,
        guarantorId: existing.guarantorId,
        financeCompanyId: existing.financeCompanyId,
        financedAmount: existing.financedAmount !== null ? Number(existing.financedAmount) : null,
        expectedPaymentDate: existing.expectedPaymentDate,
        notes: existing.notes,
      };

      // 1. Tear down existing installment schedule (if any)
      if (existing.installmentSchedule) {
        const scheduleId = existing.installmentSchedule.id;
        const installmentIds = existing.installmentSchedule.installments.map((i) => i.id);
        if (installmentIds.length > 0) {
          await tx.installmentPayment.deleteMany({
            where: { installmentId: { in: installmentIds } },
          });
        }
        await tx.installmentRollLog.deleteMany({ where: { scheduleId } });
        await tx.employeeCollectionAssignment.deleteMany({ where: { scheduleId } });
        await tx.installment.deleteMany({ where: { scheduleId } });
        await tx.installmentSchedule.delete({ where: { id: scheduleId } });
      }

      // 2. Update SaleRecord
      await tx.saleRecord.update({
        where: { id: saleId },
        data: {
          ledgerNumber: data.ledgerNumber,
          customerId: data.customerId,
          saleDate,
          saleType: data.saleType as any,
          sellingPrice,
          discountAmount,
          netAmount,
          gstRate,
          gstAmount,
          purchasePrice,
          purchaseGstAmount,
          totalAmount,
          downPayment,
          paymentMode: data.paymentMode as any,
          paymentBreakdown: data.paymentBreakdown ?? null,
          promiseDate: data.saleType === 'partial_with_promise' && data.promiseDate
            ? new Date(data.promiseDate)
            : null,
          pendingAmount,
          interestRate: data.saleType === 'self_finance' ? interestRate : null,
          fileCharge: data.saleType === 'self_finance' ? fileCharge : 0,
          effectiveMonthlyRate,
          totalFinancedAmount,
          numInstallments: data.saleType === 'self_finance' ? numInstallments : null,
          emiAmount,
          guarantorId: data.saleType === 'self_finance' ? data.guarantorId : null,
          financeCompanyId: data.saleType === 'company_finance' ? data.financeCompanyId : null,
          financedAmount,
          expectedPaymentDate,
          // Reset finance payment status to pending on edit
          financePaymentStatus: data.saleType === 'company_finance' ? 'pending' as any : null,
          financePaymentReceivedDate: null,
          financeReferenceNumber: null,
          // Completion is reset; only full_payment is "complete" at edit save
          completedAt: data.saleType === 'full_payment' ? new Date() : null,
          notes: data.notes ?? null,
        },
      });

      // 3. Update SaleRecordSanitized (mirror)
      await tx.saleRecordSanitized.update({
        where: { id: saleId },
        data: {
          ledgerNumber: data.ledgerNumber,
          customerId: data.customerId,
          saleDate,
          sellingPrice,
          totalAmount,
          // saleType + paymentMode stay 'full_payment'/'cash' by sanitization rule
        },
      });

      // 4. Recreate ProductAuditTrail entry for the edit
      await tx.productAuditTrail.create({
        data: {
          productId: existing.productId,
          eventType: 'sold',
          toShopId: shopId,
          referenceId: saleId,
          referenceType: 'sale',
          performedBy: userId,
          notes: `Sale ${existing.saleNumber} edited; installment schedule rebuilt`,
        },
      });

      // 5. If self_finance, recreate schedule + installments
      if (data.saleType === 'self_finance' && emiResult) {
        const schedule = await tx.installmentSchedule.create({
          data: {
            saleId,
            totalPrincipal: emiResult.principal,
            totalInterest: emiResult.totalInterest,
            fileCharge: emiResult.fileCharge,
            totalPayable: emiResult.totalPayable,
            numInstallments: emiResult.schedule.length,
            emiAmount: emiResult.emiAmount,
            startDate: new Date(emiResult.schedule[0].dueDate),
            status: 'active',
          },
        });
        for (const inst of emiResult.schedule) {
          await tx.installment.create({
            data: {
              scheduleId: schedule.id,
              installmentNumber: inst.installmentNumber,
              dueDate: new Date(inst.dueDate),
              amountDue: inst.amount,
              amountPaid: 0,
              remainingAmount: inst.amount,
              status: 'upcoming',
              isRescheduled: false,
            },
          });
        }
      }

      // 6. Audit log entry for the edit
      const afterValues = {
        ledgerNumber: data.ledgerNumber,
        customerId: data.customerId,
        saleDate,
        saleType: data.saleType,
        sellingPrice,
        discountAmount,
        gstRate,
        downPayment,
        paymentMode: data.paymentMode,
        promiseDate: data.saleType === 'partial_with_promise' && data.promiseDate
          ? new Date(data.promiseDate)
          : null,
        interestRate: data.saleType === 'self_finance' ? interestRate : null,
        fileCharge: data.saleType === 'self_finance' ? fileCharge : 0,
        numInstallments: data.saleType === 'self_finance' ? numInstallments : null,
        guarantorId: data.saleType === 'self_finance' ? data.guarantorId : null,
        financeCompanyId: data.saleType === 'company_finance' ? data.financeCompanyId : null,
        financedAmount,
        expectedPaymentDate,
        notes: data.notes ?? null,
      };
      await tx.auditLog.create({
        data: {
          userId,
          shopId,
          entityType: 'sale',
          entityId: saleId,
          action: saleTypeChanged ? 'update_sale_type' : 'update',
          oldValues: beforeValues as any,
          newValues: afterValues as any,
        },
      });
    });

    // Return updated full sale
    const fullSale = await prisma.saleRecord.findUnique({
      where: { id: saleId },
      include: {
        product: {
          select: {
            id: true,
            brand: true,
            modelNumber: true,
            serialNumber: true,
            category: { select: { id: true, name: true, slug: true, hsnCode: true } },
          },
        },
        customer: { select: { id: true, name: true, phone: true, customerCode: true } },
        guarantor: { select: { id: true, name: true, phone: true, customerCode: true } },
        financeCompany: { select: { id: true, name: true, code: true } },
        shop: { select: { id: true, name: true, code: true } },
        creator: { select: { id: true, username: true, fullName: true } },
        installmentSchedule: {
          include: {
            installments: { orderBy: [{ dueDate: 'asc' }, { installmentNumber: 'asc' }] },
          },
        },
      },
    });
    return fullSale;
  },

  /**
   * List sales — CRITICAL RBAC:
   * - 'others' role: query from sale_records_sanitized (never expose real data)
   * - 'admin'/'accountant': query from sale_records with full details
   *
   * The `scope` argument supports two modes:
   *  - single shop: `{ shopId: string }` (default)
   *  - all shops the user has access to: `{ shopId, shopIds: string[] }`
   *    — used when the user picks "All Shops" in the header (gated by
   *    the `shops.view_all` permission in the middleware).
   */
  async list(
    scope: { shopId: string; shopIds?: string[] },
    userRole: string,
    filters: {
      skip: number;
      take: number;
      page: number;
      pageSize: number;
      dateFrom?: string;
      dateTo?: string;
      saleType?: string;
      customerSearch?: string;
      maxProfitPct?: number;
      minProfitPct?: number;
      approvalStatus?: 'pending' | 'approved';
    },
  ) {
    // Role-based data isolation: "others" see sanitized data ONLY
    if (userRole === 'others') {
      return salesService.listSanitized(scope, filters);
    }

    return salesService.listReal(scope, filters);
  },

  async listReal(
    scope: { shopId: string; shopIds?: string[] },
    filters: {
      skip: number;
      take: number;
      page: number;
      pageSize: number;
      dateFrom?: string;
      dateTo?: string;
      saleType?: string;
      customerSearch?: string;
      maxProfitPct?: number;
      minProfitPct?: number;
      approvalStatus?: 'pending' | 'approved';
    },
  ) {
    const where: Prisma.SaleRecordWhereInput =
      scope.shopIds && scope.shopIds.length > 0
        ? { shopId: { in: scope.shopIds } }
        : { shopId: scope.shopId };

    if (filters.saleType) {
      where.saleType = filters.saleType as any;
    }

    if (filters.approvalStatus) {
      where.approvalStatus = filters.approvalStatus as any;
    }

    if (filters.dateFrom || filters.dateTo) {
      where.saleDate = {};
      if (filters.dateFrom) {
        (where.saleDate as Prisma.DateTimeFilter).gte = new Date(filters.dateFrom);
      }
      if (filters.dateTo) {
        (where.saleDate as Prisma.DateTimeFilter).lte = new Date(filters.dateTo);
      }
    }

    if (filters.customerSearch) {
      const q = filters.customerSearch;
      where.OR = [
        { ledgerNumber: { contains: q, mode: 'insensitive' } },
        { customer: { name: { contains: q, mode: 'insensitive' } } },
        { customer: { phone: { contains: q, mode: 'insensitive' } } },
        { customer: { customerCode: { contains: q, mode: 'insensitive' } } },
        { product: { modelNumber: { contains: q, mode: 'insensitive' } } },
        { product: { serialNumber: { contains: q, mode: 'insensitive' } } },
        { product: { brand: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const profitFilterActive =
      filters.maxProfitPct !== undefined || filters.minProfitPct !== undefined;

    if (!profitFilterActive) {
      const [sales, totalItems] = await Promise.all([
        prisma.saleRecord.findMany({
          where,
          include: {
            product: {
              select: {
                id: true,
                brand: true,
                modelNumber: true,
                serialNumber: true,
                category: { select: { id: true, name: true, slug: true, hsnCode: true } },
              },
            },
            customer: {
              select: { id: true, name: true, phone: true, customerCode: true },
            },
            guarantor: {
              select: { id: true, name: true, phone: true, customerCode: true },
            },
            financeCompany: {
              select: { id: true, name: true, code: true },
            },
            shop: {
              select: { id: true, name: true, code: true },
            },
            creator: {
              select: { id: true, username: true, fullName: true },
            },
            installmentSchedule: {
              select: { id: true, status: true, numInstallments: true, emiAmount: true, totalPayable: true },
            },
          },
          orderBy: { saleDate: 'desc' },
          skip: filters.skip,
          take: filters.take,
        }),
        prisma.saleRecord.count({ where }),
      ]);

      return { sales, totalItems };
    }

    // Profit-% filter is a derived value — fetch the full match set (capped),
    // compute profit% in memory, filter, then apply pagination.
    const all = await prisma.saleRecord.findMany({
      where,
      include: {
        product: {
          select: {
            id: true,
            brand: true,
            modelNumber: true,
            serialNumber: true,
            category: { select: { id: true, name: true, slug: true, hsnCode: true } },
          },
        },
        customer: {
          select: { id: true, name: true, phone: true, customerCode: true },
        },
        guarantor: {
          select: { id: true, name: true, phone: true, customerCode: true },
        },
        financeCompany: {
          select: { id: true, name: true, code: true },
        },
        shop: {
          select: { id: true, name: true, code: true },
        },
        creator: {
          select: { id: true, username: true, fullName: true },
        },
        installmentSchedule: {
          select: { id: true, status: true, numInstallments: true, emiAmount: true, totalPayable: true },
        },
      },
      orderBy: { saleDate: 'desc' },
      take: 10000,
    });

    const filtered = all.filter((s) => {
      const profitPct = computeNetProfitPct(s);
      if (profitPct === null) return false;
      if (filters.maxProfitPct !== undefined && profitPct > filters.maxProfitPct) return false;
      if (filters.minProfitPct !== undefined && profitPct < filters.minProfitPct) return false;
      return true;
    });

    const totalItems = filtered.length;
    const sales = filtered.slice(filters.skip, filters.skip + filters.take);
    return { sales, totalItems };
  },

  async listSanitized(
    scope: { shopId: string; shopIds?: string[] },
    filters: {
      skip: number;
      take: number;
      page: number;
      pageSize: number;
      dateFrom?: string;
      dateTo?: string;
      saleType?: string;
      customerSearch?: string;
    },
  ) {
    const where: Prisma.SaleRecordSanitizedWhereInput =
      scope.shopIds && scope.shopIds.length > 0
        ? { shopId: { in: scope.shopIds } }
        : { shopId: scope.shopId };

    // saleType filter is ignored for sanitized — always full_payment
    // But we still apply date and customer filters

    if (filters.dateFrom || filters.dateTo) {
      where.saleDate = {};
      if (filters.dateFrom) {
        (where.saleDate as Prisma.DateTimeFilter).gte = new Date(filters.dateFrom);
      }
      if (filters.dateTo) {
        (where.saleDate as Prisma.DateTimeFilter).lte = new Date(filters.dateTo);
      }
    }

    if (filters.customerSearch) {
      const q = filters.customerSearch;
      where.OR = [
        { ledgerNumber: { contains: q, mode: 'insensitive' } },
        { customer: { name: { contains: q, mode: 'insensitive' } } },
        { customer: { phone: { contains: q, mode: 'insensitive' } } },
        { customer: { customerCode: { contains: q, mode: 'insensitive' } } },
        { product: { modelNumber: { contains: q, mode: 'insensitive' } } },
        { product: { serialNumber: { contains: q, mode: 'insensitive' } } },
        { product: { brand: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const [sales, totalItems] = await Promise.all([
      prisma.saleRecordSanitized.findMany({
        where,
        include: {
          product: {
            select: {
              id: true,
              brand: true,
              modelNumber: true,
              serialNumber: true,
            },
          },
          customer: {
            select: { id: true, name: true, phone: true, customerCode: true },
          },
          shop: {
            select: { id: true, name: true, code: true },
          },
          creator: {
            select: { id: true, username: true, fullName: true },
          },
        },
        orderBy: { saleDate: 'desc' },
        skip: filters.skip,
        take: filters.take,
      }),
      prisma.saleRecordSanitized.count({ where }),
    ]);

    return { sales, totalItems };
  },

  /**
   * Get sale by ID — Same RBAC:
   * - 'others' -> sanitized record
   * - 'admin'/'accountant' -> real record with installment schedule, guarantor, finance company
   */
  async getById(id: string, userRole: string) {
    if (userRole === 'others') {
      const sale = await prisma.saleRecordSanitized.findUnique({
        where: { id },
        include: {
          product: {
            select: {
              id: true,
              brand: true,
              modelNumber: true,
              serialNumber: true,
            },
          },
          customer: {
            select: { id: true, name: true, phone: true, customerCode: true },
          },
          shop: {
            select: { id: true, name: true, code: true },
          },
          creator: {
            select: { id: true, username: true, fullName: true },
          },
        },
      });
      return sale;
    }

    const sale = await prisma.saleRecord.findUnique({
      where: { id },
      include: {
        product: {
          select: {
            id: true,
            brand: true,
            modelNumber: true,
            serialNumber: true,
            mrp: true,
            purchasePrice: true,
            category: { select: { id: true, name: true, slug: true, hsnCode: true } },
          },
        },
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
            customerCode: true,
            addressLine1: true,
            addressLine2: true,
            city: true,
            state: true,
            pincode: true,
          },
        },
        guarantor: {
          select: { id: true, name: true, phone: true, customerCode: true },
        },
        financeCompany: {
          select: { id: true, name: true, code: true },
        },
        shop: {
          select: { id: true, name: true, code: true },
        },
        creator: {
          select: { id: true, username: true, fullName: true },
        },
        installmentSchedule: {
          include: {
            installments: {
              orderBy: [{ dueDate: 'asc' }, { installmentNumber: 'asc' }],
              include: {
                payments: {
                  orderBy: { paymentDate: 'desc' },
                },
              },
            },
          },
        },
      },
    });

    return sale;
  },

  /**
   * Get audit/activity log for a sale (most recent first)
   */
  async getActivity(saleId: string) {
    const sale = await prisma.saleRecord.findUnique({
      where: { id: saleId },
      select: { id: true },
    });
    if (!sale) return null;
    const logs = await prisma.auditLog.findMany({
      where: { entityType: 'sale', entityId: saleId },
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, username: true, fullName: true } },
      },
    });
    return logs;
  },

  /**
   * Get installment schedule for a sale (admin/accountant only, never others)
   */
  async getInstallments(saleId: string) {
    const sale = await prisma.saleRecord.findUnique({
      where: { id: saleId },
      select: { id: true, saleType: true },
    });
    if (!sale) {
      return null;
    }

    const schedule = await prisma.installmentSchedule.findUnique({
      where: { saleId },
      include: {
        installments: {
          orderBy: [{ dueDate: 'asc' }, { installmentNumber: 'asc' }],
          include: {
            payments: {
              include: {
                collector: {
                  select: { id: true, username: true, fullName: true },
                },
              },
              orderBy: { paymentDate: 'desc' },
            },
          },
        },
        sale: {
          select: {
            id: true,
            saleNumber: true,
            saleType: true,
            totalAmount: true,
            downPayment: true,
            customer: {
              select: { id: true, name: true, phone: true, customerCode: true },
            },
            guarantor: {
              select: { id: true, name: true, phone: true, customerCode: true },
            },
          },
        },
      },
    });

    return schedule;
  },

  /**
   * Record finance company payment for company_finance sales.
   * Updates financePaymentStatus, financePaymentReceivedDate, financeReferenceNumber.
   */
  async recordFinancePayment(saleId: string, data: {
    financePaymentStatus: string;
    financePaymentReceivedDate?: string | null;
    financeReferenceNumber?: string | null;
  }) {
    const sale = await prisma.saleRecord.findUnique({
      where: { id: saleId },
    });
    if (!sale) {
      throw new Error('Sale not found');
    }
    if (sale.saleType !== 'company_finance') {
      throw new Error('Finance payment can only be recorded for company-finance sales');
    }

    const updated = await prisma.saleRecord.update({
      where: { id: saleId },
      data: {
        financePaymentStatus: data.financePaymentStatus as any,
        financePaymentReceivedDate: data.financePaymentReceivedDate
          ? new Date(data.financePaymentReceivedDate)
          : null,
        financeReferenceNumber: data.financeReferenceNumber ?? null,
        // Auto-complete the sale when the finance company pays.
        completedAt:
          data.financePaymentStatus === 'received'
            ? (sale.completedAt ?? new Date())
            : null,
      },
      include: {
        product: {
          select: {
            id: true,
            brand: true,
            modelNumber: true,
            serialNumber: true,
          },
        },
        customer: {
          select: { id: true, name: true, phone: true, customerCode: true },
        },
        financeCompany: {
          select: { id: true, name: true, code: true },
        },
        shop: {
          select: { id: true, name: true, code: true },
        },
      },
    });

    return updated;
  },

  /**
   * Record payment against a sale's pending amount (for partial_with_promise or any sale with pendingAmount > 0).
   */
  async recordPendingPayment(saleId: string, data: {
    amount: number;
    paymentMode: string;
    paymentBreakdown?: Array<{mode: string; amount: number}> | null;
    notes?: string | null;
  }) {
    const sale = await prisma.saleRecord.findUnique({ where: { id: saleId } });
    if (!sale) throw new Error('Sale not found');
    if (Number(sale.pendingAmount) <= 0) throw new Error('No pending amount for this sale');
    if (data.amount > Number(sale.pendingAmount)) throw new Error('Payment amount exceeds pending amount');

    const newPending = Number(sale.pendingAmount) - data.amount;
    const newDownPayment = Number(sale.downPayment) + data.amount;

    // Append payment info to notes for audit trail
    const paymentNote = `Payment received: ₹${data.amount} via ${data.paymentMode}${data.notes ? ' - ' + data.notes : ''} on ${new Date().toISOString().split('T')[0]}`;
    const updatedNotes = sale.notes ? `${sale.notes}\n${paymentNote}` : paymentNote;

    const updated = await prisma.saleRecord.update({
      where: { id: saleId },
      data: {
        pendingAmount: newPending,
        downPayment: newDownPayment,
        notes: updatedNotes,
        // Sale auto-completes when all pending money is collected.
        completedAt: newPending <= 0 ? (sale.completedAt ?? new Date()) : null,
      },
    });

    return updated;
  },

  async listFinanceCompanies() {
    return prisma.financeCompany.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
  },

  /**
   * Count of sales currently awaiting approval. Drives the badge subscript
   * shown on the "Approve" button in the Sale list page. Scoped to the
   * caller's accessible shops (single-shop or All-Shops mode).
   */
  async getPendingApprovalCount(scope: { shopId: string; shopIds?: string[] }) {
    const where: Prisma.SaleRecordWhereInput =
      scope.shopIds && scope.shopIds.length > 0
        ? { shopId: { in: scope.shopIds }, approvalStatus: 'pending' as any }
        : { shopId: scope.shopId, approvalStatus: 'pending' as any };
    return prisma.saleRecord.count({ where });
  },

  /**
   * Approve a sale (manual review by Owner / a user with `sales.approve`).
   * Idempotent — already-approved sales are returned unchanged.
   */
  async approveSale(saleId: string, approverId: string) {
    const sale = await prisma.saleRecord.findUnique({ where: { id: saleId } });
    if (!sale) throw new Error('Sale not found');
    if (sale.approvalStatus === 'approved') return sale;

    return prisma.saleRecord.update({
      where: { id: saleId },
      data: {
        approvalStatus: 'approved' as any,
        approvedById: approverId,
        approvedAt: new Date(),
      },
    });
  },
};

/**
 * Compute net-profit % for a sale record.
 * Formula: ((SP - GST) - (PP - inputGST)) / (PP - inputGST) × 100.
 * Mirrors the front-end calculation used on SaleCreatePage / SaleDetailPage.
 * Returns null when purchase-price (excl GST) is zero (no meaningful %).
 */
export function computeNetProfitPct(sale: {
  sellingPrice: unknown;
  gstAmount: unknown;
  purchasePrice: unknown;
  purchaseGstAmount: unknown;
}): number | null {
  const sp = Number(sale.sellingPrice ?? 0);
  const gst = Number(sale.gstAmount ?? 0);
  const pp = Number(sale.purchasePrice ?? 0);
  const ppGst = Number(sale.purchaseGstAmount ?? 0);
  const spExcl = sp - gst;
  const ppExcl = pp - ppGst;
  if (ppExcl <= 0) return null;
  return ((spExcl - ppExcl) / ppExcl) * 100;
}

/** Net profit (₹) for a sale record. */
export function computeNetProfit(sale: {
  sellingPrice: unknown;
  gstAmount: unknown;
  purchasePrice: unknown;
  purchaseGstAmount: unknown;
}): number {
  const sp = Number(sale.sellingPrice ?? 0);
  const gst = Number(sale.gstAmount ?? 0);
  const pp = Number(sale.purchasePrice ?? 0);
  const ppGst = Number(sale.purchaseGstAmount ?? 0);
  return (sp - gst) - (pp - ppGst);
}
