import type { FastifyRequest, FastifyReply } from 'fastify';
import { bankService } from './bank.service.js';
import { sendSuccess, sendError, sendPaginated } from '../../utils/response.js';
import { parsePagination } from '../../utils/pagination.js';

export const bankController = {
  // =========================================================================
  // BANK ACCOUNTS
  // =========================================================================

  async listAccounts(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    try {
      const { shopId, shopIds, allShops } = request.shopFilter!;
      const accounts = await bankService.listAccounts({
        shopId,
        shopIds: allShops ? shopIds : undefined,
      });
      return sendSuccess(reply, accounts);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch bank accounts';
      return sendError(reply, message, 500);
    }
  },

  async createAccount(
    request: FastifyRequest<{
      Body: {
        bankName: string;
        accountNumber: string;
        ifscCode: string;
        accountType?: string;
        openingBalance?: number;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const shopId = request.shopFilter!.shopId;
      const account = await bankService.createAccount(shopId, request.body);
      return sendSuccess(reply, account, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create bank account';
      return sendError(reply, message, 500);
    }
  },

  // =========================================================================
  // TRANSACTIONS
  // =========================================================================

  async listTransactions(
    request: FastifyRequest<{
      Params: { id: string };
      Querystring: {
        page?: string;
        pageSize?: string;
        dateFrom?: string;
        dateTo?: string;
        reconciliationStatus?: string;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const accountId = request.params.id;

      // Verify account exists
      const account = await bankService.getAccountById(accountId);
      if (!account) {
        return sendError(reply, 'Bank account not found', 404);
      }

      const { page, pageSize, skip, take } = parsePagination(request.query);
      const { dateFrom, dateTo, reconciliationStatus } = request.query;

      const { transactions, totalItems } = await bankService.listTransactions(accountId, {
        page,
        pageSize,
        skip,
        take,
        dateFrom,
        dateTo,
        reconciliationStatus,
      });

      return sendPaginated(reply, transactions, { page, pageSize, totalItems });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch transactions';
      return sendError(reply, message, 500);
    }
  },

  async addTransaction(
    request: FastifyRequest<{
      Params: { id: string };
      Body: {
        transactionDate: string;
        valueDate?: string | null;
        description?: string | null;
        referenceNumber?: string | null;
        txnType: string;
        amount: number;
        balance?: number | null;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const accountId = request.params.id;

      // Verify account exists
      const account = await bankService.getAccountById(accountId);
      if (!account) {
        return sendError(reply, 'Bank account not found', 404);
      }

      const transaction = await bankService.addTransaction(accountId, request.body);
      return sendSuccess(reply, transaction, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to add transaction';
      return sendError(reply, message, 500);
    }
  },

  async bulkImportTransactions(
    request: FastifyRequest<{
      Params: { id: string };
      Body: {
        transactions: Array<{
          transactionDate: string;
          valueDate?: string | null;
          description?: string | null;
          referenceNumber?: string | null;
          txnType: string;
          amount: number;
          balance?: number | null;
        }>;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const accountId = request.params.id;

      // Verify account exists
      const account = await bankService.getAccountById(accountId);
      if (!account) {
        return sendError(reply, 'Bank account not found', 404);
      }

      const result = await bankService.bulkImportTransactions(
        accountId,
        request.body.transactions,
      );

      return sendSuccess(reply, result, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to import transactions';
      return sendError(reply, message, 500);
    }
  },

  // =========================================================================
  // RECONCILIATION
  // =========================================================================

  async getUnmatched(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    try {
      const { shopId, shopIds, allShops } = request.shopFilter!;
      const transactions = await bankService.getUnmatched({
        shopId,
        shopIds: allShops ? shopIds : undefined,
      });
      return sendSuccess(reply, transactions);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch unmatched transactions';
      return sendError(reply, message, 500);
    }
  },

  async getSuggestedMatches(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const suggestions = await bankService.getSuggestedMatches(request.params.id);
      if (suggestions === null) {
        return sendError(reply, 'Transaction not found', 404);
      }
      return sendSuccess(reply, suggestions);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch suggestions';
      return sendError(reply, message, 500);
    }
  },

  async reconcile(
    request: FastifyRequest<{
      Params: { id: string };
      Body: {
        reconciledWithType: string;
        reconciledWithId: string;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const userId = request.currentUser!.userId;
      const updated = await bankService.reconcile(
        request.params.id,
        request.body,
        userId,
      );

      if (!updated) {
        return sendError(reply, 'Transaction not found', 404);
      }

      return sendSuccess(reply, updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reconcile transaction';
      if (message.includes('not found')) {
        return sendError(reply, message, 404);
      }
      return sendError(reply, message, 500);
    }
  },

  async manualReconcile(
    request: FastifyRequest<{
      Params: { id: string };
      Body: {
        notes: string;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const userId = request.currentUser!.userId;
      const updated = await bankService.manualReconcile(
        request.params.id,
        request.body.notes,
        userId,
      );

      if (!updated) {
        return sendError(reply, 'Transaction not found', 404);
      }

      return sendSuccess(reply, updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to manually reconcile transaction';
      return sendError(reply, message, 500);
    }
  },
};
