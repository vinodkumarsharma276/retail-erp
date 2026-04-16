import type { FastifyRequest, FastifyReply } from 'fastify';
import { purchasesService } from './purchases.service.js';
import { sendSuccess, sendError, sendPaginated } from '../../utils/response.js';
import { parsePagination } from '../../utils/pagination.js';

export const purchasesController = {
  async list(
    request: FastifyRequest<{
      Querystring: {
        page?: string;
        pageSize?: string;
        distributorId?: string;
        dateFrom?: string;
        dateTo?: string;
        paymentStatus?: string;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const { page, pageSize, skip, take } = parsePagination(request.query);
      const { distributorId, dateFrom, dateTo, paymentStatus } = request.query;
      const shopId = request.shopFilter!.shopId;

      const { purchases, totalItems } = await purchasesService.list(shopId, {
        page,
        pageSize,
        skip,
        take,
        distributorId,
        dateFrom,
        dateTo,
        paymentStatus,
      });

      return sendPaginated(reply, purchases, { page, pageSize, totalItems });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch purchases';
      return sendError(reply, message, 500);
    }
  },

  async getById(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const purchase = await purchasesService.getById(request.params.id);
      if (!purchase) {
        return sendError(reply, 'Purchase not found', 404);
      }
      return sendSuccess(reply, purchase);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch purchase';
      return sendError(reply, message, 500);
    }
  },

  async create(
    request: FastifyRequest<{
      Body: {
        distributorId: string;
        invoiceNumber: string;
        invoiceDate: string;
        totalAmount: number;
        gstAmount?: number;
        discountAmount?: number;
        notes?: string | null;
        items: Array<{
          categoryId: string;
          brand: string;
          modelNumber: string;
          serialNumber?: string | null;
          mrp: number;
          sellingPrice?: number;
          purchasePrice: number;
          color?: string | null;
          weightKg?: number | null;
          warrantyMonths?: number | null;
          barcode?: string | null;
          dynamicAttributes?: Record<string, unknown>;
        }>;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const shopId = request.shopFilter!.shopId;
      const userId = request.currentUser!.userId;

      const purchase = await purchasesService.create(shopId, request.body, userId);
      return sendSuccess(reply, purchase, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create purchase';
      if (message === 'Distributor not found') {
        return sendError(reply, message, 404);
      }
      if (message === 'One or more category IDs are invalid') {
        return sendError(reply, message, 400);
      }
      if (message.startsWith('Required attribute')) {
        return sendError(reply, message, 400);
      }
      return sendError(reply, message, 500);
    }
  },

  async update(
    request: FastifyRequest<{
      Params: { id: string };
      Body: {
        invoiceNumber?: string;
        invoiceDate?: string;
        totalAmount?: number;
        gstAmount?: number;
        discountAmount?: number;
        notes?: string | null;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const updated = await purchasesService.update(request.params.id, request.body);
      if (!updated) {
        return sendError(reply, 'Purchase not found', 404);
      }
      return sendSuccess(reply, updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update purchase';
      return sendError(reply, message, 500);
    }
  },

  async recordPayment(
    request: FastifyRequest<{
      Params: { id: string };
      Body: {
        amount: number;
        paymentMode: string;
        paymentDate: string;
        referenceNumber?: string | null;
        notes?: string | null;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const userId = request.currentUser!.userId;
      const result = await purchasesService.recordPayment(
        request.params.id,
        request.body,
        userId,
      );
      return sendSuccess(reply, result, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to record payment';
      if (message === 'Purchase not found') {
        return sendError(reply, message, 404);
      }
      return sendError(reply, message, 500);
    }
  },
};
