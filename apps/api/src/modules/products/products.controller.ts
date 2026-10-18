import type { FastifyRequest, FastifyReply } from 'fastify';
import { productsService } from './products.service.js';
import { productEnrichService } from './products.enrich.js';
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
      const { shopId, shopIds, allShops } = request.shopFilter!;

      const { products, totalItems } = await productsService.list(
        { shopId, shopIds: allShops ? shopIds : undefined },
        {
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
        },
      );

      return sendPaginated(reply, products, { page, pageSize, totalItems });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch products';
      return sendError(reply, message, 500);
    }
  },

  async listGrouped(
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
      const { shopId, shopIds, allShops } = request.shopFilter!;

      const { groups, totalItems } = await productsService.listGrouped(
        { shopId, shopIds: allShops ? shopIds : undefined },
        { page, pageSize, skip, take, categoryId, status, brand, search, dateFrom, dateTo },
      );

      return sendPaginated(reply, groups, { page, pageSize, totalItems });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch grouped products';
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
      const { shopId, shopIds, allShops } = request.shopFilter!;
      const { query } = request.query;

      if (!query || query.length < 3) {
        return sendError(reply, 'Search query must be at least 3 characters', 400);
      }

      const products = await productsService.globalSearch(
        { shopId, shopIds: allShops ? shopIds : undefined },
        query,
      );
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
        sellingPrice?: number;
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

  /**
   * POST /products/:id/enrich — fill empty specifications from the web.
   *
   * Aimed at units that came off a spreadsheet, which arrive with every
   * category attribute blank. Anything already entered is left alone.
   */
  async enrich(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    try {
      const result = await productEnrichService.enrichProduct(request.params.id, request.shopFilter!);
      if (!result) {
        return sendError(reply, 'Product not found', 404);
      }
      return sendSuccess(reply, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch the product details';
      return sendError(reply, message, 500);
    }
  },

  /** GET /products/enrich/batch/:batchId — how much of a run has no details. */
  async enrichBatchStatus(request: FastifyRequest<{ Params: { batchId: string } }>, reply: FastifyReply) {
    try {
      const status = await productEnrichService.batchStatus(request.params.batchId, request.shopFilter!);
      if (!status) {
        return sendError(reply, 'Import run not found', 404);
      }
      return sendSuccess(reply, status);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to check the import run';
      return sendError(reply, message, 500);
    }
  },

  /**
   * POST /products/enrich/batch/:batchId — look up the next few models of an
   * import run. One pass per call, so the screen can show progress and the
   * user can stop part-way; running it again only fills what is still blank.
   */
  async enrichBatch(
    request: FastifyRequest<{ Params: { batchId: string }; Body: { limit?: number; refresh?: boolean } }>,
    reply: FastifyReply,
  ) {
    try {
      const result = await productEnrichService.enrichBatch(
        request.params.batchId,
        request.shopFilter!,
        request.body ?? {},
      );
      if (!result) {
        return sendError(reply, 'Import run not found', 404);
      }
      return sendSuccess(reply, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch the product details';
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
