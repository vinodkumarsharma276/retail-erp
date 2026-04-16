import type { FastifyRequest, FastifyReply } from 'fastify';
import { customersService } from './customers.service.js';
import { sendSuccess, sendError, sendPaginated } from '../../utils/response.js';
import { parsePagination } from '../../utils/pagination.js';

export const customersController = {
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
      const shopId = request.shopFilter!.shopId;

      const { customers, totalItems } = await customersService.list(shopId, {
        page,
        pageSize,
        skip,
        take,
        search,
      });

      return sendPaginated(reply, customers, { page, pageSize, totalItems });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch customers';
      return sendError(reply, message, 500);
    }
  },

  async search(
    request: FastifyRequest<{
      Querystring: { query: string };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const { query } = request.query;

      if (!query || query.length < 2) {
        return sendError(reply, 'Search query must be at least 2 characters', 400);
      }

      const customers = await customersService.search(query);
      return sendSuccess(reply, customers);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to search customers';
      return sendError(reply, message, 500);
    }
  },

  async getById(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const customer = await customersService.getById(request.params.id);
      if (!customer) {
        return sendError(reply, 'Customer not found', 404);
      }
      return sendSuccess(reply, customer);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch customer';
      return sendError(reply, message, 500);
    }
  },

  async create(
    request: FastifyRequest<{
      Body: {
        name: string;
        phone: string;
        altPhone?: string | null;
        aadhaarNumber?: string | null;
        addressLine1?: string | null;
        addressLine2?: string | null;
        city?: string | null;
        state?: string | null;
        pincode?: string | null;
        isGuarantor?: boolean;
        guarantorId?: string | null;
        dynamicAttributes?: Record<string, unknown>;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const shopId = request.shopFilter!.shopId;
      const userId = request.currentUser!.userId;

      const customer = await customersService.create(shopId, request.body, userId);
      return sendSuccess(reply, customer, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create customer';
      if (message === 'Guarantor not found') {
        return sendError(reply, message, 404);
      }
      return sendError(reply, message, 500);
    }
  },

  async update(
    request: FastifyRequest<{
      Params: { id: string };
      Body: {
        name?: string;
        phone?: string;
        altPhone?: string | null;
        aadhaarNumber?: string | null;
        addressLine1?: string | null;
        addressLine2?: string | null;
        city?: string | null;
        state?: string | null;
        pincode?: string | null;
        isGuarantor?: boolean;
        guarantorId?: string | null;
        dynamicAttributes?: Record<string, unknown>;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const updated = await customersService.update(request.params.id, request.body);
      if (!updated) {
        return sendError(reply, 'Customer not found', 404);
      }
      return sendSuccess(reply, updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update customer';
      if (message === 'Guarantor not found') {
        return sendError(reply, message, 404);
      }
      return sendError(reply, message, 500);
    }
  },

  async getSales(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const sales = await customersService.getSales(request.params.id);
      if (sales === null) {
        return sendError(reply, 'Customer not found', 404);
      }
      return sendSuccess(reply, sales);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch customer sales';
      return sendError(reply, message, 500);
    }
  },
};
