import type { FastifyRequest, FastifyReply } from 'fastify';
import { usersService } from './users.service.js';
import { sendSuccess, sendError, sendPaginated } from '../../utils/response.js';
import { parsePagination } from '../../utils/pagination.js';

export const usersController = {
  async list(
    request: FastifyRequest<{
      Querystring: {
        page?: string;
        pageSize?: string;
        shopId?: string;
        role?: string;
        search?: string;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const { page, pageSize, skip, take } = parsePagination(request.query);
      const { shopId, role, search } = request.query;

      const { users, totalItems } = await usersService.list({
        page,
        pageSize,
        skip,
        take,
        shopId,
        role,
        search,
      });

      return sendPaginated(reply, users, { page, pageSize, totalItems });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch users';
      return sendError(reply, message, 500);
    }
  },

  async getById(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const user = await usersService.getById(request.params.id);
      if (!user) {
        return sendError(reply, 'User not found', 404);
      }
      return sendSuccess(reply, user);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch user';
      return sendError(reply, message, 500);
    }
  },

  async create(
    request: FastifyRequest<{
      Body: {
        username: string;
        password: string;
        fullName: string;
        email?: string | null;
        phone: string;
        role: string;
        isMobileOnly?: boolean;
        shopIds: string[];
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const user = await usersService.create(request.body);
      return sendSuccess(reply, user, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create user';
      if (message === 'Username already exists') {
        return sendError(reply, message, 409);
      }
      return sendError(reply, message, 500);
    }
  },

  async update(
    request: FastifyRequest<{
      Params: { id: string };
      Body: {
        fullName?: string;
        email?: string | null;
        phone?: string;
        role?: string;
        isMobileOnly?: boolean;
        isActive?: boolean;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const updated = await usersService.update(request.params.id, request.body);
      if (!updated) {
        return sendError(reply, 'User not found', 404);
      }
      return sendSuccess(reply, updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update user';
      return sendError(reply, message, 500);
    }
  },

  async delete(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const deleted = await usersService.softDelete(request.params.id);
      if (!deleted) {
        return sendError(reply, 'User not found', 404);
      }
      return sendSuccess(reply, { message: 'User deactivated successfully', user: deleted });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete user';
      return sendError(reply, message, 500);
    }
  },

  async assignShops(
    request: FastifyRequest<{
      Params: { id: string };
      Body: { shopIds: string[] };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const user = await usersService.assignShops(request.params.id, request.body.shopIds);
      if (!user) {
        return sendError(reply, 'User not found', 404);
      }
      return sendSuccess(reply, user);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to assign shops';
      return sendError(reply, message, 500);
    }
  },
};
