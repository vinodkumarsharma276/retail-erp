import type { FastifyRequest, FastifyReply } from 'fastify';
import { salesService } from './sales.service.js';
import { sendSuccess, sendError, sendPaginated } from '../../utils/response.js';
import { parsePagination } from '../../utils/pagination.js';
import { getCurrentUserPermissions } from '../../middleware/permissions.js';
import { getTenantFeatureSnapshot } from '../../middleware/feature-gate.js';
import { FeatureKey } from '@retailerp/shared-types';

const SALE_TYPE_PERMISSION: Record<string, string> = {
  full_payment: 'sales.create_full_payment',
  partial_with_promise: 'sales.create_partial_with_promise',
  self_finance: 'sales.create_self_finance',
  company_finance: 'sales.create_company_finance',
};

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
        maxProfitPct?: string;
        minProfitPct?: string;
        approvalStatus?: 'pending' | 'approved';
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const { page, pageSize, skip, take } = parsePagination(request.query);
      const { dateFrom, dateTo, saleType, customerSearch, maxProfitPct, minProfitPct, approvalStatus } = request.query;
      // shopFilter is set by the shopScope middleware. When `allShops`
      // is true (user picked "All Shops" in the header and has the
      // `shops.view_all` permission) we forward `shopIds` so the service
      // queries across every accessible shop.
      const { shopId, shopIds, allShops } = request.shopFilter!;
      // Without "see real sales" a user gets the restricted view: real records,
      // except self-finance sales, which show as their cash-sale copy.
      const restrictedViewer = !(await getCurrentUserPermissions(request)).includes('sales.view_real');

      const parsePct = (v?: string) => {
        if (v === undefined || v === '') return undefined;
        const n = Number(v);
        return Number.isFinite(n) ? n : undefined;
      };

      const { sales, totalItems } = await salesService.list(
        { shopId, shopIds: allShops ? shopIds : undefined },
        restrictedViewer,
        {
          page,
          pageSize,
          skip,
          take,
          dateFrom,
          dateTo,
          saleType,
          customerSearch,
          maxProfitPct: parsePct(maxProfitPct),
          minProfitPct: parsePct(minProfitPct),
          approvalStatus,
        },
      );

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

      const perms = await getCurrentUserPermissions(request);
      // The route accepts anyone who can create SOME sale; this sale type
      // needs its own permission (e.g. self-finance).
      const needed = SALE_TYPE_PERMISSION[request.body.saleType];
      if (!needed || !perms.includes(needed)) {
        return sendError(reply, `You can't record a ${request.body.saleType.replace(/_/g, ' ')} sale.`, 403);
      }
      // With the approval workflow on, sales by users without `sales.approve`
      // wait for review; with it off there is nothing to approve.
      const workflowOn = (await getTenantFeatureSnapshot(request.tenant!.id)).flags[FeatureKey.SALE_APPROVAL_WORKFLOW] === true;
      const autoApprove = !workflowOn || perms.includes('sales.approve');

      const sale = await salesService.create(shopId, request.body, userId, { autoApprove });
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
      const restrictedViewer = !(await getCurrentUserPermissions(request)).includes('sales.view_real');
      const sale = await salesService.getById(request.params.id, restrictedViewer);
      if (!sale) {
        return sendError(reply, 'Sale not found', 404);
      }
      return sendSuccess(reply, sale);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch sale';
      return sendError(reply, message, 500);
    }
  },

  async update(
    request: FastifyRequest<{
      Params: { id: string };
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
      const sale = await salesService.update(request.params.id, shopId, request.body, userId);
      return sendSuccess(reply, sale);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update sale';
      if (
        message === 'Sale not found' ||
        message === 'Customer not found' ||
        message === 'Guarantor not found' ||
        message === 'Finance company not found'
      ) {
        return sendError(reply, message, 404);
      }
      if (
        message === 'Sale does not belong to this shop' ||
        message === 'Product cannot be changed when editing a sale' ||
        message === 'Guarantor is required for self-finance sales' ||
        message === 'Number of installments is required for self-finance sales' ||
        message === 'Interest rate is required for self-finance sales' ||
        message === 'Finance company is required for company-finance sales' ||
        message === 'Sale date cannot be in the future' ||
        message.startsWith('Sale date cannot be before') ||
        message.startsWith('This sale already has installment activity')
      ) {
        return sendError(reply, message, 400);
      }
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

  async getActivity(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const logs = await salesService.getActivity(request.params.id);
      if (logs === null) {
        return sendError(reply, 'Sale not found', 404);
      }
      return sendSuccess(reply, logs);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch activity';
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

  async getPendingApprovalCount(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    try {
      const { shopId, shopIds, allShops } = request.shopFilter!;
      const count = await salesService.getPendingApprovalCount({
        shopId,
        shopIds: allShops ? shopIds : undefined,
      });
      return sendSuccess(reply, { count });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch pending count';
      return sendError(reply, message, 500);
    }
  },

  async approveSale(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const userId = request.currentUser!.userId;
      const updated = await salesService.approveSale(request.params.id, userId);
      return sendSuccess(reply, updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to approve sale';
      if (message === 'Sale not found') {
        return sendError(reply, message, 404);
      }
      return sendError(reply, message, 500);
    }
  },
};
