import type { FastifyRequest, FastifyReply } from 'fastify';
import { salesService } from './sales.service.js';
import { sendSuccess, sendError, sendPaginated } from '../../utils/response.js';
import { parsePagination } from '../../utils/pagination.js';

export const salesController = {
  async list(
    request: FastifyRequest<{
      Querystring: {
        page?: string;
        pageSize?: string;
        dateFrom?: string;
        dateTo?: string;
        saleType?: string;
        customerSearch?: string;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const { page, pageSize, skip, take } = parsePagination(request.query);
      const { dateFrom, dateTo, saleType, customerSearch } = request.query;
      const shopId = request.shopFilter!.shopId;
      const userRole = request.currentUser!.role;

      const { sales, totalItems } = await salesService.list(shopId, userRole, {
        page,
        pageSize,
        skip,
        take,
        dateFrom,
        dateTo,
        saleType,
        customerSearch,
      });

      return sendPaginated(reply, sales, { page, pageSize, totalItems });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch sales';
      return sendError(reply, message, 500);
    }
  },

  async create(
    request: FastifyRequest<{
      Body: {
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
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const shopId = request.shopFilter!.shopId;
      const userId = request.currentUser!.userId;

      const sale = await salesService.create(shopId, request.body, userId);
      return sendSuccess(reply, sale, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create sale';
      if (
        message === 'Product not found' ||
        message === 'Customer not found' ||
        message === 'Guarantor not found' ||
        message === 'Finance company not found'
      ) {
        return sendError(reply, message, 404);
      }
      if (
        message === 'Product does not belong to this shop' ||
        message === 'Product is not available for sale' ||
        message === 'Guarantor is required for self-finance sales' ||
        message === 'Number of installments is required for self-finance sales' ||
        message === 'Interest rate is required for self-finance sales' ||
        message === 'Finance company is required for company-finance sales'
      ) {
        return sendError(reply, message, 400);
      }
      return sendError(reply, message, 500);
    }
  },

  async getById(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const userRole = request.currentUser!.role;
      const sale = await salesService.getById(request.params.id, userRole);
      if (!sale) {
        return sendError(reply, 'Sale not found', 404);
      }
      return sendSuccess(reply, sale);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch sale';
      return sendError(reply, message, 500);
    }
  },

  async getInstallments(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const schedule = await salesService.getInstallments(request.params.id);
      if (schedule === null) {
        return sendError(reply, 'Sale not found', 404);
      }
      if (!schedule) {
        return sendError(reply, 'No installment schedule found for this sale', 404);
      }
      return sendSuccess(reply, schedule);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch installments';
      return sendError(reply, message, 500);
    }
  },

  async recordFinancePayment(
    request: FastifyRequest<{
      Params: { id: string };
      Body: {
        financePaymentStatus: string;
        financePaymentReceivedDate?: string | null;
        financeReferenceNumber?: string | null;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const updated = await salesService.recordFinancePayment(
        request.params.id,
        request.body,
      );
      return sendSuccess(reply, updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to record finance payment';
      if (message === 'Sale not found') {
        return sendError(reply, message, 404);
      }
      if (message === 'Finance payment can only be recorded for company-finance sales') {
        return sendError(reply, message, 400);
      }
      return sendError(reply, message, 500);
    }
  },

  async recordPendingPayment(
    request: FastifyRequest<{
      Params: { id: string };
      Body: {
        amount: number;
        paymentMode: string;
        paymentBreakdown?: Array<{mode: string; amount: number}> | null;
        notes?: string | null;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const updated = await salesService.recordPendingPayment(
        request.params.id,
        request.body,
      );
      return sendSuccess(reply, updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to record payment';
      if (message === 'Sale not found') {
        return sendError(reply, message, 404);
      }
      if (message.includes('pending') || message.includes('exceeds')) {
        return sendError(reply, message, 400);
      }
      return sendError(reply, message, 500);
    }
  },

  async listFinanceCompanies(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    try {
      const companies = await salesService.listFinanceCompanies();
      return sendSuccess(reply, companies);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch finance companies';
      return sendError(reply, message, 500);
    }
  },
};
