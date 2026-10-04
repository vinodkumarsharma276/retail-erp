import type { FastifyRequest, FastifyReply } from 'fastify';
import { purchasesService } from './purchases.service.js';
import { purchaseImportService } from './purchases.import.js';
import type { PurchaseImportRequest } from '@retailerp/shared-types';
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
        allShops?: string;
        search?: string;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const { page, pageSize, skip, take } = parsePagination(request.query);
      const { distributorId, dateFrom, dateTo, paymentStatus, allShops, search } = request.query;

      // Two ways to get a cross-shop view:
      //   1. Legacy: ?allShops=true with distributorId on the Distributor
      //      Detail page (admin-only escape hatch — lets the page show a
      //      distributor's full purchase history across every shop).
      //   2. Header-driven: middleware sets shopFilter.allShops=true when
      //      the user has the `shops.view_all` permission and picks
      //      "All Shops" in the dropdown.
      const legacyAllShops =
        allShops === 'true' &&
        request.currentUser?.role === 'admin' &&
        !!distributorId;

      const { shopId, shopIds, allShops: scopeAllShops } = request.shopFilter!;

      const scope = legacyAllShops
        ? { shopId: null }
        : scopeAllShops
          ? { shopId, shopIds }
          : { shopId };

      const { purchases, totalItems } = await purchasesService.list(scope, {
        page,
        pageSize,
        skip,
        take,
        distributorId,
        dateFrom,
        dateTo,
        paymentStatus,
        search,
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

  async checkInvoice(
    request: FastifyRequest<{
      Querystring: { distributorId?: string; invoiceNumber?: string };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const { distributorId, invoiceNumber } = request.query;
      if (!invoiceNumber) {
        return sendError(reply, 'invoiceNumber is required', 400);
      }
      const result = await purchasesService.checkInvoiceExists(invoiceNumber, distributorId);
      return sendSuccess(reply, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to check invoice';
      return sendError(reply, message, 500);
    }
  },

  /** POST /purchases/import/preview — check a mapped sheet; nothing is saved. */
  async importPreview(request: FastifyRequest<{ Body: PurchaseImportRequest }>, reply: FastifyReply) {
    try {
      if (request.shopFilter!.allShops) return sendError(reply, 'Switch to a single shop to import purchases', 400);
      const preview = await purchaseImportService.preview(request.body, {
        tenantId: request.currentUser!.tenantId,
        shopId: request.shopFilter!.shopId,
      });
      return sendSuccess(reply, preview);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to check the import';
      return sendError(reply, message, 500);
    }
  },

  /** POST /purchases/import — save every invoice that passed the check. */
  async importCommit(request: FastifyRequest<{ Body: PurchaseImportRequest }>, reply: FastifyReply) {
    try {
      if (request.shopFilter!.allShops) return sendError(reply, 'Switch to a single shop to import purchases', 400);
      const result = await purchaseImportService.commit(request.body, {
        tenantId: request.currentUser!.tenantId,
        shopId: request.shopFilter!.shopId,
        userId: request.currentUser!.userId,
      });
      return sendSuccess(reply, result, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to import purchases';
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
      const tenantId = request.currentUser!.tenantId;

      const purchase = await purchasesService.create(shopId, tenantId, request.body, userId);
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
      if (message.includes('already exists')) {
        return sendError(reply, message, 409);
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
      if (message.includes('already exists')) {
        return sendError(reply, message, 409);
      }
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
