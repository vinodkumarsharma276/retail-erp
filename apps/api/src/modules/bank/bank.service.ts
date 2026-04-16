import { prisma } from '../../config/database.js';
import type { Prisma, BankTxnType, ReconciliationStatus } from '@prisma/client';

export const bankService = {
  // =========================================================================
  // BANK ACCOUNTS
  // =========================================================================

  async listAccounts(shopId: string) {
    const accounts = await prisma.bankAccount.findMany({
      where: { shopId },
      orderBy: { createdAt: 'desc' },
    });

    return accounts;
  },

  async getAccountById(id: string) {
    return prisma.bankAccount.findUnique({ where: { id } });
  },

  async createAccount(shopId: string, data: {
    bankName: string;
    accountNumber: string;
    ifscCode: string;
    accountType?: string;
    openingBalance?: number;
  }) {
    const account = await prisma.bankAccount.create({
      data: {
        shopId,
        bankName: data.bankName,
        accountNumber: data.accountNumber,
        ifscCode: data.ifscCode,
        accountType: data.accountType ?? 'current',
        openingBalance: data.openingBalance ?? 0,
      },
    });

    return account;
  },

  // =========================================================================
  // TRANSACTIONS
  // =========================================================================

  async listTransactions(accountId: string, filters: {
    skip: number;
    take: number;
    page: number;
    pageSize: number;
    dateFrom?: string;
    dateTo?: string;
    reconciliationStatus?: string;
  }) {
    const where: Prisma.BankTransactionWhereInput = {
      bankAccountId: accountId,
    };

    if (filters.dateFrom || filters.dateTo) {
      where.transactionDate = {};
      if (filters.dateFrom) {
        where.transactionDate.gte = new Date(filters.dateFrom);
      }
      if (filters.dateTo) {
        where.transactionDate.lte = new Date(filters.dateTo);
      }
    }

    if (filters.reconciliationStatus) {
      where.reconciliationStatus = filters.reconciliationStatus as ReconciliationStatus;
    }

    const [transactions, totalItems] = await Promise.all([
      prisma.bankTransaction.findMany({
        where,
        include: {
          bankAccount: {
            select: { id: true, bankName: true, accountNumber: true, accountType: true },
          },
          reconciler: {
            select: { id: true, username: true, fullName: true },
          },
        },
        orderBy: { transactionDate: 'desc' },
        skip: filters.skip,
        take: filters.take,
      }),
      prisma.bankTransaction.count({ where }),
    ]);

    return { transactions, totalItems };
  },

  async addTransaction(accountId: string, data: {
    transactionDate: string;
    valueDate?: string | null;
    description?: string | null;
    referenceNumber?: string | null;
    txnType: string;
    amount: number;
    balance?: number | null;
  }) {
    const transaction = await prisma.bankTransaction.create({
      data: {
        bankAccountId: accountId,
        transactionDate: new Date(data.transactionDate),
        valueDate: data.valueDate ? new Date(data.valueDate) : null,
        description: data.description ?? null,
        referenceNumber: data.referenceNumber ?? null,
        txnType: data.txnType as BankTxnType,
        amount: data.amount,
        balance: data.balance ?? null,
        reconciliationStatus: 'unmatched',
      },
      include: {
        bankAccount: {
          select: { id: true, bankName: true, accountNumber: true },
        },
      },
    });

    return transaction;
  },

  async bulkImportTransactions(accountId: string, transactions: Array<{
    transactionDate: string;
    valueDate?: string | null;
    description?: string | null;
    referenceNumber?: string | null;
    txnType: string;
    amount: number;
    balance?: number | null;
  }>) {
    let imported = 0;
    let skipped = 0;

    for (const txn of transactions) {
      // Check for duplicates: match on date + amount + referenceNumber
      const duplicateWhere: Prisma.BankTransactionWhereInput = {
        bankAccountId: accountId,
        transactionDate: new Date(txn.transactionDate),
        amount: txn.amount,
      };

      // Only include referenceNumber in duplicate check if it exists
      if (txn.referenceNumber) {
        duplicateWhere.referenceNumber = txn.referenceNumber;
      }

      const existing = await prisma.bankTransaction.findFirst({
        where: duplicateWhere,
      });

      if (existing) {
        skipped++;
        continue;
      }

      await prisma.bankTransaction.create({
        data: {
          bankAccountId: accountId,
          transactionDate: new Date(txn.transactionDate),
          valueDate: txn.valueDate ? new Date(txn.valueDate) : null,
          description: txn.description ?? null,
          referenceNumber: txn.referenceNumber ?? null,
          txnType: txn.txnType as BankTxnType,
          amount: txn.amount,
          balance: txn.balance ?? null,
          reconciliationStatus: 'unmatched',
        },
      });

      imported++;
    }

    return { imported, skipped, total: transactions.length };
  },

  // =========================================================================
  // RECONCILIATION
  // =========================================================================

  async getUnmatched(shopId: string) {
    // Get all bank accounts for the shop, then find unmatched transactions
    const accounts = await prisma.bankAccount.findMany({
      where: { shopId },
      select: { id: true },
    });

    const accountIds = accounts.map((a) => a.id);

    if (accountIds.length === 0) {
      return [];
    }

    const transactions = await prisma.bankTransaction.findMany({
      where: {
        bankAccountId: { in: accountIds },
        reconciliationStatus: 'unmatched',
      },
      include: {
        bankAccount: {
          select: { id: true, bankName: true, accountNumber: true, accountType: true },
        },
      },
      orderBy: { transactionDate: 'desc' },
    });

    return transactions;
  },

  async getTransactionById(id: string) {
    return prisma.bankTransaction.findUnique({
      where: { id },
      include: {
        bankAccount: {
          select: { id: true, bankName: true, accountNumber: true, shopId: true },
        },
        reconciler: {
          select: { id: true, username: true, fullName: true },
        },
      },
    });
  },

  async reconcile(transactionId: string, data: {
    reconciledWithType: string;
    reconciledWithId: string;
  }, userId: string) {
    const transaction = await prisma.bankTransaction.findUnique({
      where: { id: transactionId },
    });

    if (!transaction) {
      return null;
    }

    // Validate that the referenced entity exists
    const valid = await bankService.validateReconciledEntity(
      data.reconciledWithType,
      data.reconciledWithId,
    );

    if (!valid) {
      throw new Error(`Referenced ${data.reconciledWithType} not found`);
    }

    const updated = await prisma.bankTransaction.update({
      where: { id: transactionId },
      data: {
        reconciledWithType: data.reconciledWithType,
        reconciledWithId: data.reconciledWithId,
        reconciledBy: userId,
        reconciledAt: new Date(),
        reconciliationStatus: 'matched',
      },
      include: {
        bankAccount: {
          select: { id: true, bankName: true, accountNumber: true },
        },
        reconciler: {
          select: { id: true, username: true, fullName: true },
        },
      },
    });

    return updated;
  },

  async manualReconcile(transactionId: string, notes: string, userId: string) {
    const transaction = await prisma.bankTransaction.findUnique({
      where: { id: transactionId },
    });

    if (!transaction) {
      return null;
    }

    // Append notes to existing description or set as description
    const existingDesc = transaction.description ?? '';
    const updatedDesc = existingDesc
      ? `${existingDesc} | Manual match: ${notes}`
      : `Manual match: ${notes}`;

    const updated = await prisma.bankTransaction.update({
      where: { id: transactionId },
      data: {
        description: updatedDesc,
        reconciledBy: userId,
        reconciledAt: new Date(),
        reconciliationStatus: 'manual_match',
      },
      include: {
        bankAccount: {
          select: { id: true, bankName: true, accountNumber: true },
        },
        reconciler: {
          select: { id: true, username: true, fullName: true },
        },
      },
    });

    return updated;
  },

  async getSuggestedMatches(transactionId: string) {
    const transaction = await prisma.bankTransaction.findUnique({
      where: { id: transactionId },
      include: {
        bankAccount: {
          select: { shopId: true },
        },
      },
    });

    if (!transaction) {
      return null;
    }

    const shopId = transaction.bankAccount.shopId;
    const txnAmount = Number(transaction.amount);
    const txnDate = transaction.transactionDate;

    // Tolerance: +/- 3 days and +/- 10% amount
    const dateFrom = new Date(txnDate);
    dateFrom.setDate(dateFrom.getDate() - 3);
    const dateTo = new Date(txnDate);
    dateTo.setDate(dateTo.getDate() + 3);

    const amountLow = txnAmount * 0.9;
    const amountHigh = txnAmount * 1.1;

    const suggestions: Array<{
      type: string;
      id: string;
      amount: number;
      date: Date;
      description: string;
      relevanceScore: number;
    }> = [];

    // 1. Search sales (credit transactions likely match sales)
    const sales = await prisma.saleRecord.findMany({
      where: {
        shopId,
        saleDate: { gte: dateFrom, lte: dateTo },
        totalAmount: { gte: amountLow, lte: amountHigh },
      },
      include: {
        customer: { select: { name: true } },
        product: { select: { brand: true, modelNumber: true } },
      },
      take: 20,
    });

    for (const sale of sales) {
      const amountDiff = Math.abs(Number(sale.totalAmount) - txnAmount);
      const daysDiff = Math.abs(
        (sale.saleDate.getTime() - txnDate.getTime()) / (1000 * 60 * 60 * 24),
      );
      const relevanceScore = calculateRelevance(amountDiff, txnAmount, daysDiff);

      suggestions.push({
        type: 'sale',
        id: sale.id,
        amount: Number(sale.totalAmount),
        date: sale.saleDate,
        description: `Sale ${sale.saleNumber} - ${sale.customer.name} - ${sale.product.brand} ${sale.product.modelNumber}`,
        relevanceScore,
      });
    }

    // 2. Search purchase payments (debit transactions likely match purchase payments)
    const purchasePayments = await prisma.purchasePayment.findMany({
      where: {
        paymentDate: { gte: dateFrom, lte: dateTo },
        amount: { gte: amountLow, lte: amountHigh },
        purchase: { shopId },
      },
      include: {
        purchase: {
          select: {
            invoiceNumber: true,
            distributor: { select: { companyName: true } },
          },
        },
      },
      take: 20,
    });

    for (const pp of purchasePayments) {
      const amountDiff = Math.abs(Number(pp.amount) - txnAmount);
      const daysDiff = Math.abs(
        (pp.paymentDate.getTime() - txnDate.getTime()) / (1000 * 60 * 60 * 24),
      );
      const relevanceScore = calculateRelevance(amountDiff, txnAmount, daysDiff);

      suggestions.push({
        type: 'purchase_payment',
        id: pp.id,
        amount: Number(pp.amount),
        date: pp.paymentDate,
        description: `Purchase Payment - Invoice ${pp.purchase.invoiceNumber} - ${pp.purchase.distributor.companyName}`,
        relevanceScore,
      });
    }

    // 3. Search expenses (debit transactions likely match expenses)
    const expenses = await prisma.expense.findMany({
      where: {
        shopId,
        expenseDate: { gte: dateFrom, lte: dateTo },
        amount: { gte: amountLow, lte: amountHigh },
      },
      take: 20,
    });

    for (const exp of expenses) {
      const amountDiff = Math.abs(Number(exp.amount) - txnAmount);
      const daysDiff = Math.abs(
        (exp.expenseDate.getTime() - txnDate.getTime()) / (1000 * 60 * 60 * 24),
      );
      const relevanceScore = calculateRelevance(amountDiff, txnAmount, daysDiff);

      suggestions.push({
        type: 'expense',
        id: exp.id,
        amount: Number(exp.amount),
        date: exp.expenseDate,
        description: `Expense - ${exp.category}${exp.vendorName ? ` - ${exp.vendorName}` : ''}${exp.description ? ` - ${exp.description}` : ''}`,
        relevanceScore,
      });
    }

    // 4. Search installment payments (credit transactions may match installment collections)
    const installmentPayments = await prisma.installmentPayment.findMany({
      where: {
        paymentDate: { gte: dateFrom, lte: dateTo },
        amount: { gte: amountLow, lte: amountHigh },
        installment: {
          schedule: {
            sale: { shopId },
          },
        },
      },
      include: {
        installment: {
          select: {
            installmentNumber: true,
            schedule: {
              select: {
                sale: {
                  select: {
                    saleNumber: true,
                    customer: { select: { name: true } },
                  },
                },
              },
            },
          },
        },
      },
      take: 20,
    });

    for (const ip of installmentPayments) {
      const amountDiff = Math.abs(Number(ip.amount) - txnAmount);
      const daysDiff = Math.abs(
        (ip.paymentDate.getTime() - txnDate.getTime()) / (1000 * 60 * 60 * 24),
      );
      const relevanceScore = calculateRelevance(amountDiff, txnAmount, daysDiff);

      const sale = ip.installment.schedule.sale;
      suggestions.push({
        type: 'installment_payment',
        id: ip.id,
        amount: Number(ip.amount),
        date: ip.paymentDate,
        description: `Installment #${ip.installment.installmentNumber} - Sale ${sale.saleNumber} - ${sale.customer.name}`,
        relevanceScore,
      });
    }

    // Sort by relevance (higher is better) and return top 10
    suggestions.sort((a, b) => b.relevanceScore - a.relevanceScore);
    return suggestions.slice(0, 10);
  },

  // =========================================================================
  // HELPERS
  // =========================================================================

  async validateReconciledEntity(type: string, id: string): Promise<boolean> {
    switch (type) {
      case 'sale': {
        const sale = await prisma.saleRecord.findUnique({ where: { id } });
        return !!sale;
      }
      case 'purchase_payment': {
        const pp = await prisma.purchasePayment.findUnique({ where: { id } });
        return !!pp;
      }
      case 'expense': {
        const expense = await prisma.expense.findUnique({ where: { id } });
        return !!expense;
      }
      case 'installment_payment': {
        const ip = await prisma.installmentPayment.findUnique({ where: { id } });
        return !!ip;
      }
      default:
        return false;
    }
  },
};

/**
 * Calculate relevance score for reconciliation suggestion.
 * Higher score = better match.
 * - Amount closeness: 0-70 points (exact match = 70)
 * - Date proximity: 0-30 points (same day = 30)
 */
function calculateRelevance(amountDiff: number, txnAmount: number, daysDiff: number): number {
  // Amount score: inverse of percentage difference, scaled to 0-70
  const amountPctDiff = txnAmount > 0 ? (amountDiff / txnAmount) * 100 : 100;
  const amountScore = Math.max(0, 70 - amountPctDiff * 7); // 0% diff = 70, 10% diff = 0

  // Date score: inverse of days difference, scaled to 0-30
  const dateScore = Math.max(0, 30 - daysDiff * 10); // 0 days = 30, 3 days = 0

  return Math.round(amountScore + dateScore);
}
