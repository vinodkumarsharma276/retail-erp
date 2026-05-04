import type { FastifyRequest, FastifyReply } from 'fastify';
import { shopsService } from './shops.service.js';
import { sendSuccess, sendError } from '../../utils/response.js';

export const shopsController = {
  async list(_request: FastifyRequest, reply: FastifyReply) {
    try {
      const shops = await shopsService.list();
      return sendSuccess(reply, shops);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch shops';
      return sendError(reply, message, 500);
    }
  },

  async getById(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    try {
      // Admins (and Owner) get the full record including userShops + bank;
      // every other authenticated user gets the lean public projection.
      const isAdmin =
        request.currentUser?.role === 'owner' || request.currentUser?.role === 'admin';
      const shop = isAdmin
        ? await shopsService.getById(request.params.id)
        : await shopsService.getPublicById(request.params.id);
      if (!shop) {
        return sendError(reply, 'Shop not found', 404);
      }
      return sendSuccess(reply, shop);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch shop';
      return sendError(reply, message, 500);
    }
  },

  async update(
    request: FastifyRequest<{
      Params: { id: string };
      Body: Record<string, unknown>;
    }>,
    reply: FastifyReply,
  ) {
    try {
      const updated = await shopsService.update(request.params.id, request.body as any);
      if (!updated) {
        return sendError(reply, 'Shop not found', 404);
      }
      return sendSuccess(reply, updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update shop';
      return sendError(reply, message, 500);
    }
  },
};
