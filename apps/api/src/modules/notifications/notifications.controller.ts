import type { FastifyRequest, FastifyReply } from 'fastify';
import * as notificationService from './notifications.service.js';

export const notificationController = {
  /**
   * POST /register-token — Register Expo push token for the current user.
   */
  async registerToken(request: FastifyRequest, reply: FastifyReply) {
    const { token, deviceId } = request.body as { token: string; deviceId?: string };
    const userId = request.currentUser!.userId;

    const result = await notificationService.registerPushToken(userId, token, deviceId);
    return reply.status(200).send({ success: true, data: result });
  },

  /**
   * GET / — Get current user's notifications.
   */
  async list(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.currentUser!.userId;
    const { page, limit } = request.query as { page?: string; limit?: string };

    const result = await notificationService.getUserNotifications(
      userId,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );

    return reply.status(200).send({ success: true, ...result });
  },

  /**
   * PUT /:id/read — Mark a notification as read.
   */
  async markRead(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    const userId = request.currentUser!.userId;

    const result = await notificationService.markAsRead(id, userId);
    return reply.status(200).send({ success: true, data: result });
  },
};
