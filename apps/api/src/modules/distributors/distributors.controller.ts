import type { FastifyRequest, FastifyReply } from 'fastify';
import { distributorsService } from './distributors.service.js';
import { sendSuccess, sendError, sendPaginated } from '../../utils/response.js';
import { parsePagination } from '../../utils/pagination.js';

export const distributorsController = {
  async list(
    request: FastifyRequest<{
      Querystring: {
        page?: string;
        pageSize?: string;
        search?: string;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const { page, pageSize, skip, take } = parsePagination(request.query);
      const { search } = request.query;

      const { distributors, totalItems } = await distributorsService.list({
        page,
        pageSize,
        skip,
        take,
        search,
      });

      return sendPaginated(reply, distributors, { page, pageSize, totalItems });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch distributors';
      return sendError(reply, message, 500);
    }
  },

  async getById(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const distributor = await distributorsService.getById(request.params.id);
      if (!distributor) {
        return sendError(reply, 'Distributor not found', 404);
      }
      return sendSuccess(reply, distributor);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch distributor';
      return sendError(reply, message, 500);
    }
  },

  async create(
    request: FastifyRequest<{
      Body: {
        companyName: string;
        contactPerson: string;
        phone: string;
        altPhone?: string | null;
        email?: string | null;
        gstNumber?: string | null;
        panNumber?: string | null;
        addressLine1: string;
        addressLine2?: string | null;
        city: string;
        state: string;
        pincode: string;
        bankName?: string | null;
        bankAccountNumber?: string | null;
        bankIfsc?: string | null;
        bankBranch?: string | null;
        paymentTerms?: string | null;
        creditLimit?: number;
        categoryIds?: string[];
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const userId = request.currentUser!.userId;
      const distributor = await distributorsService.create(request.body, userId);
      return sendSuccess(reply, distributor, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create distributor';
      if (message === 'One or more category IDs are invalid') {
        return sendError(reply, message, 400);
      }
      return sendError(reply, message, 500);
    }
  },

  async update(
    request: FastifyRequest<{
      Params: { id: string };
      Body: {
        companyName?: string;
        contactPerson?: string;
        phone?: string;
        altPhone?: string | null;
        email?: string | null;
        gstNumber?: string | null;
        panNumber?: string | null;
        addressLine1?: string;
        addressLine2?: string | null;
        city?: string;
        state?: string;
        pincode?: string;
        bankName?: string | null;
        bankAccountNumber?: string | null;
        bankIfsc?: string | null;
        bankBranch?: string | null;
        paymentTerms?: string | null;
        creditLimit?: number;
        isActive?: boolean;
        categoryIds?: string[];
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const updated = await distributorsService.update(request.params.id, request.body);
      if (!updated) {
        return sendError(reply, 'Distributor not found', 404);
      }
      return sendSuccess(reply, updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update distributor';
      if (message === 'One or more category IDs are invalid') {
        return sendError(reply, message, 400);
      }
      return sendError(reply, message, 500);
    }
  },

  async getProducts(
    request: FastifyRequest<{
      Params: { id: string };
      Querystring: {
        page?: string;
        pageSize?: string;
        dateFrom?: string;
        dateTo?: string;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const { page, pageSize, skip, take } = parsePagination(request.query);
      const { dateFrom, dateTo } = request.query;

      const result = await distributorsService.getProducts(request.params.id, {
        page,
        pageSize,
        skip,
        take,
        dateFrom,
        dateTo,
      });

      if (result === null) {
        return sendError(reply, 'Distributor not found', 404);
      }

      return sendPaginated(reply, result.products, { page, pageSize, totalItems: result.totalItems });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch distributor products';
      return sendError(reply, message, 500);
    }
  },

  async getPayments(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const payments = await distributorsService.getPayments(request.params.id);
      if (payments === null) {
        return sendError(reply, 'Distributor not found', 404);
      }
      return sendSuccess(reply, payments);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch distributor payments';
      return sendError(reply, message, 500);
    }
  },
};
