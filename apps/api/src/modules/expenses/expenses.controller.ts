import type { FastifyRequest, FastifyReply } from 'fastify';
import { expensesService } from './expenses.service.js';
import { sendSuccess, sendError, sendPaginated } from '../../utils/response.js';
import { parsePagination } from '../../utils/pagination.js';

export const expensesController = {
  async list(
    request: FastifyRequest<{
      Querystring: {
        page?: string;
        pageSize?: string;
        category?: string;
        dateFrom?: string;
        dateTo?: string;
        search?: string;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const { page, pageSize, skip, take } = parsePagination(request.query);
      const { category, dateFrom, dateTo, search } = request.query;
      const { shopId, shopIds, allShops } = request.shopFilter!;

      const { expenses, totalItems } = await expensesService.list(
        { shopId, shopIds: allShops ? shopIds : undefined },
        {
          page,
          pageSize,
          skip,
          take,
          category,
          dateFrom,
          dateTo,
          search,
        },
      );

      return sendPaginated(reply, expenses, { page, pageSize, totalItems });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch expenses';
      return sendError(reply, message, 500);
    }
  },

  async getById(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const expense = await expensesService.getById(request.params.id);
      if (!expense) {
        return sendError(reply, 'Expense not found', 404);
      }
      return sendSuccess(reply, expense);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch expense';
      return sendError(reply, message, 500);
    }
  },

  async create(
    request: FastifyRequest<{
      Body: {
        expenseDate: string;
        category: string;
        vendorName?: string | null;
        description?: string | null;
        amount: number;
        gstAmount?: number | null;
        invoiceNumber?: string | null;
        invoiceUrl?: string | null;
        isGstClaimable?: boolean;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const shopId = request.shopFilter!.shopId;
      const userId = request.currentUser!.userId;

      const expense = await expensesService.create(shopId, request.body, userId);
      return sendSuccess(reply, expense, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create expense';
      return sendError(reply, message, 500);
    }
  },

  async update(
    request: FastifyRequest<{
      Params: { id: string };
      Body: {
        expenseDate?: string;
        category?: string;
        vendorName?: string | null;
        description?: string | null;
        amount?: number;
        gstAmount?: number | null;
        invoiceNumber?: string | null;
        invoiceUrl?: string | null;
        isGstClaimable?: boolean;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const updated = await expensesService.update(request.params.id, request.body);
      if (!updated) {
        return sendError(reply, 'Expense not found', 404);
      }
      return sendSuccess(reply, updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update expense';
      return sendError(reply, message, 500);
    }
  },

  async delete(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const result = await expensesService.delete(request.params.id);
      if (!result) {
        return sendError(reply, 'Expense not found', 404);
      }
      return sendSuccess(reply, { message: 'Expense deleted successfully' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete expense';
      return sendError(reply, message, 500);
    }
  },

  async getSummary(
    request: FastifyRequest<{
      Querystring: {
        dateFrom?: string;
        dateTo?: string;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const { shopId, shopIds, allShops } = request.shopFilter!;
      const { dateFrom, dateTo } = request.query;

      const summary = await expensesService.getSummary(
        { shopId, shopIds: allShops ? shopIds : undefined },
        dateFrom,
        dateTo,
      );
      return sendSuccess(reply, summary);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch expense summary';
      return sendError(reply, message, 500);
    }
  },
};
