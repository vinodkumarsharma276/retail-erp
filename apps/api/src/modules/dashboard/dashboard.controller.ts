import type { FastifyRequest, FastifyReply } from 'fastify';
import { dashboardService } from './dashboard.service.js';
import { sendSuccess, sendError } from '../../utils/response.js';

export const dashboardController = {
  async getSalesGraph(
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

      const data = await dashboardService.getSalesGraph(
        { shopId, shopIds: allShops ? shopIds : undefined },
        dateFrom,
        dateTo,
      );
      return sendSuccess(reply, data);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch sales graph data';
      return sendError(reply, message, 500);
    }
  },

  async getTopProducts(
    request: FastifyRequest<{
      Querystring: {
        dateFrom?: string;
        dateTo?: string;
        limit?: string;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const { shopId, shopIds, allShops } = request.shopFilter!;
      const { dateFrom, dateTo, limit } = request.query;
      const parsedLimit = limit ? Math.min(Math.max(1, parseInt(limit, 10)), 50) : 10;

      const data = await dashboardService.getTopProducts(
        { shopId, shopIds: allShops ? shopIds : undefined },
        dateFrom,
        dateTo,
        parsedLimit,
      );
      return sendSuccess(reply, data);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch top products';
      return sendError(reply, message, 500);
    }
  },

  async getYoYComparison(
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

      const data = await dashboardService.getYoYComparison(
        { shopId, shopIds: allShops ? shopIds : undefined },
        dateFrom,
        dateTo,
      );
      return sendSuccess(reply, data);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch year-over-year comparison';
      return sendError(reply, message, 500);
    }
  },

  async getOverdueInstallments(
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

      const data = await dashboardService.getOverdueInstallments(
        { shopId, shopIds: allShops ? shopIds : undefined },
        dateFrom,
        dateTo,
      );
      return sendSuccess(reply, data);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch overdue installments';
      return sendError(reply, message, 500);
    }
  },

  async getSummary(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    try {
      const { shopId, shopIds, allShops } = request.shopFilter!;

      const data = await dashboardService.getSummary({
        shopId,
        shopIds: allShops ? shopIds : undefined,
      });
      return sendSuccess(reply, data);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch dashboard summary';
      return sendError(reply, message, 500);
    }
  },

  async getLowMarginSales(
    request: FastifyRequest<{
      Querystring: { threshold?: string; dateFrom?: string; dateTo?: string };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const { shopId, shopIds, allShops } = request.shopFilter!;
      const threshold = Number(request.query.threshold ?? '5');
      const data = await dashboardService.getLowMarginSales(
        { shopId, shopIds: allShops ? shopIds : undefined },
        {
          threshold: Number.isFinite(threshold) ? threshold : 5,
          dateFrom: request.query.dateFrom,
          dateTo: request.query.dateTo,
        },
      );
      return sendSuccess(reply, data);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch low-margin sales';
      return sendError(reply, message, 500);
    }
  },
};
