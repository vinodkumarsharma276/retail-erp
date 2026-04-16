import type { FastifyInstance } from 'fastify';
import { authController } from './auth.controller.js';
import { authenticate } from '../../middleware/auth.js';

export async function authRoutes(app: FastifyInstance) {
  // Public routes
  app.get('/shops', authController.listShops);
  app.post('/login', authController.login);
  app.post('/refresh', authController.refresh);

  // Protected routes
  app.get('/me', { preHandler: [authenticate] }, authController.me);
  app.post('/logout', { preHandler: [authenticate] }, authController.logout);
  app.put('/change-password', { preHandler: [authenticate] }, authController.changePassword);
  app.post('/switch-shop', { preHandler: [authenticate] }, authController.switchShop);
}
