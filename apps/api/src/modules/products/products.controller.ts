import type { FastifyRequest, FastifyReply } from 'fastify';
import { productsService } from './products.service.js';
import { sendSuccess, sendError, sendPaginated } from '../../utils/response.js';
import { parsePagination } from '../../utils/pagination.js';

export const productsController = {
  async list(
    request: FastifyRequest<{
      Querystring: {
        page?: string;
        pageSize?: string;
        categoryId?: string;
        status?: string;
        brand?: string;
        search?: string;
        dateFrom?: string;
        dateTo?: string;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const { page, pageSize, skip, take } = parsePagination(request.query);
      const { categoryId, status, brand, search, dateFrom, dateTo } = request.query;
      const shopId = request.shopFilter!.shopId;

      const { products, totalItems } = await productsService.list(shopId, {
        page,
        pageSize,
        skip,
        take,
        categoryId,
        status,
        brand,
        search,
        dateFrom,
        dateTo,
      });

      return sendPaginated(reply, products, { page, pageSize, totalItems });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch products';
      return sendError(reply, message, 500);
    }
  },

  async globalSearch(
    request: FastifyRequest<{
      Querystring: { query: string };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const shopId = request.shopFilter!.shopId;
      const { query } = request.query;

      if (!query || query.length < 3) {
        return sendError(reply, 'Search query must be at least 3 characters', 400);
      }

      const products = await productsService.globalSearch(shopId, query);
      return sendSuccess(reply, products);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to search products';
      return sendError(reply, message, 500);
    }
  },

  async getById(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const product = await productsService.getById(request.params.id);
      if (!product) {
        return sendError(reply, 'Product not found', 404);
      }
      return sendSuccess(reply, product);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch product';
      return sendError(reply, message, 500);
    }
  },

  async create(
    request: FastifyRequest<{
      Body: {
        categoryId: string;
        brand: string;
        modelNumber: string;
        serialNumber?: string | null;
        mrp: number;
        sellingPrice: number;
        purchasePrice: number;
        color?: string | null;
        weightKg?: number | null;
        distributorId?: string | null;
        warrantyMonths?: number | null;
        barcode?: string | null;
        notes?: string | null;
        dynamicAttributes?: Record<string, unknown>;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const shopId = request.shopFilter!.shopId;
      const userId = request.currentUser!.userId;

      const product = await productsService.create(shopId, request.body, userId);
      return sendSuccess(reply, product, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create product';
      if (message === 'Category not found' || message === 'Distributor not found') {
        return sendError(reply, message, 404);
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
        categoryId?: string;
        brand?: string;
        modelNumber?: string;
        serialNumber?: string | null;
        mrp?: number;
        sellingPrice?: number;
        purchasePrice?: number;
        color?: string | null;
        weightKg?: number | null;
        distributorId?: string | null;
        warrantyMonths?: number | null;
        barcode?: string | null;
        notes?: string | null;
        dynamicAttributes?: Record<string, unknown>;
        status?: string;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const updated = await productsService.update(request.params.id, request.body);
      if (!updated) {
        return sendError(reply, 'Product not found', 404);
      }
      return sendSuccess(reply, updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update product';
      if (message === 'Category not found' || message === 'Distributor not found') {
        return sendError(reply, message, 404);
      }
      if (message.includes('already exists')) {
        return sendError(reply, message, 409);
      }
      return sendError(reply, message, 500);
    }
  },

  async getHistory(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const history = await productsService.getHistory(request.params.id);
      if (history === null) {
        return sendError(reply, 'Product not found', 404);
      }
      return sendSuccess(reply, history);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch product history';
      return sendError(reply, message, 500);
    }
  },

  async canSell(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const result = await productsService.canSell(request.params.id);
      if (result === null) {
        return sendError(reply, 'Product not found', 404);
      }
      return sendSuccess(reply, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to check product status';
      return sendError(reply, message, 500);
    }
  },
};
