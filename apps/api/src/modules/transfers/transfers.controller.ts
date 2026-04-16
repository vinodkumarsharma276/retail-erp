import type { FastifyRequest, FastifyReply } from 'fastify';
import { transfersService } from './transfers.service.js';
import { sendSuccess, sendError, sendPaginated } from '../../utils/response.js';
import { parsePagination } from '../../utils/pagination.js';

export const transfersController = {
  async list(
    request: FastifyRequest<{
      Querystring: {
        page?: string;
        pageSize?: string;
        fromShopId?: string;
        toShopId?: string;
        status?: string;
        dateFrom?: string;
        dateTo?: string;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const { page, pageSize, skip, take } = parsePagination(request.query);
      const { fromShopId, toShopId, status, dateFrom, dateTo } = request.query;

      const { transfers, totalItems } = await transfersService.list({
        page,
        pageSize,
        skip,
        take,
        fromShopId,
        toShopId,
        status,
        dateFrom,
        dateTo,
      });

      return sendPaginated(reply, transfers, { page, pageSize, totalItems });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch transfers';
      return sendError(reply, message, 500);
    }
  },

  async getById(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const transfer = await transfersService.getById(request.params.id);
      if (!transfer) {
        return sendError(reply, 'Transfer not found', 404);
      }
      return sendSuccess(reply, transfer);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch transfer';
      return sendError(reply, message, 500);
    }
  },

  async initiate(
    request: FastifyRequest<{
      Body: {
        productId: string;
        toShopId: string;
        transferPrice?: number;
        gstAmount?: number;
        invoiceNumber?: string;
        notes?: string;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const fromShopId = request.shopFilter!.shopId;
      const userId = request.currentUser!.userId;

      const transfer = await transfersService.initiate({
        ...request.body,
        fromShopId,
      }, userId);

      return sendSuccess(reply, transfer, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to initiate transfer';
      if (message === 'Product not found' || message === 'Destination shop not found') {
        return sendError(reply, message, 404);
      }
      if (
        message === 'Only in-stock products can be transferred' ||
        message === 'Product does not belong to the source shop' ||
        message === 'Source and destination shops must be different'
      ) {
        return sendError(reply, message, 400);
      }
      return sendError(reply, message, 500);
    }
  },

  async receive(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const userId = request.currentUser!.userId;
      const transfer = await transfersService.receive(request.params.id, userId);
      return sendSuccess(reply, transfer);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to receive transfer';
      if (message === 'Transfer not found') {
        return sendError(reply, message, 404);
      }
      if (message === 'Transfer cannot be received in its current status') {
        return sendError(reply, message, 400);
      }
      return sendError(reply, message, 500);
    }
  },

  async cancel(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const userId = request.currentUser!.userId;
      const transfer = await transfersService.cancel(request.params.id, userId);
      return sendSuccess(reply, transfer);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to cancel transfer';
      if (message === 'Transfer not found') {
        return sendError(reply, message, 404);
      }
      if (message === 'Only initiated transfers can be cancelled') {
        return sendError(reply, message, 400);
      }
      return sendError(reply, message, 500);
    }
  },

  async getIncoming(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    try {
      const shopId = request.shopFilter!.shopId;
      const transfers = await transfersService.getIncoming(shopId);
      return sendSuccess(reply, transfers);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch incoming transfers';
      return sendError(reply, message, 500);
    }
  },
};
