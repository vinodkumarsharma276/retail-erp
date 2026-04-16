import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/auth.js';
import { notificationController } from './notifications.controller.js';

export async function notificationRoutes(app: FastifyInstance) {
  // All notification routes require authentication
  app.addHook('preHandler', authenticate);

  // Register Expo push token (typically from mobile app)
  app.post('/register-token', notificationController.registerToken);

  // Get current user's notifications
  app.get('/', notificationController.list);

  // Mark a notification as read
  app.put('/:id/read', notificationController.markRead);
}
