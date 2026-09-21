import type { FastifyReply, FastifyRequest } from 'fastify';
import { sendError, sendSuccess } from '../../utils/response.js';
import { promisesService } from './promises.service.js';

export const promisesController = {
  async create(
    request: FastifyRequest<{
      Body: {
        scheduleId: string;
        customerId: string;
        coveredInstallmentIds: string[];
        promisedDate: string;
        promisedAmount: number;
        notes?: string;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const promise = await promisesService.create(request.body, {
        tenantId: request.tenant!.id,
        actorUserId: request.currentUser!.userId,
      });
      return sendSuccess(reply, promise, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create promise';
      const status = message.includes('not found') ? 404 : 400;
      return sendError(reply, message, status);
    }
  },

  async list(
    request: FastifyRequest<{
      Querystring: { scheduleId?: string; customerId?: string; status?: 'pending' | 'kept' | 'partially_kept' | 'broken' | 'replaced' | 'cancelled' };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const promises = await promisesService.list(request.query, request.tenant!.id);
      return sendSuccess(reply, promises);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to list promises';
      return sendError(reply, message, 500);
    }
  },

  async cancel(
    request: FastifyRequest<{ Params: { id: string }; Body?: { reason?: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const promise = await promisesService.cancel(request.params.id, request.body?.reason, {
        tenantId: request.tenant!.id,
        actorUserId: request.currentUser!.userId,
      });
      return sendSuccess(reply, promise);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to cancel promise';
      const status = message === 'Promise not found' ? 404 : 400;
      return sendError(reply, message, status);
    }
  },
};
