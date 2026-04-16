import type { FastifyInstance } from 'fastify';
import { authController } from './auth.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import {
  loginSchema,
  refreshSchema,
  changePasswordSchema,
  switchShopSchema,
} from './auth.validation.js';

export async function authRoutes(app: FastifyInstance) {
  // Public routes
  app.get('/shops', authController.listShops);

  app.post('/login', {
    preHandler: [validate(loginSchema)],
  }, authController.login as any);

  app.post('/refresh', {
    preHandler: [validate(refreshSchema)],
  }, authController.refresh as any);

  // Protected routes
  app.get('/me', { preHandler: [authenticate] }, authController.me);

  app.post('/logout', {
    preHandler: [authenticate, validate(refreshSchema)],
  }, authController.logout as any);

  app.put('/change-password', {
    preHandler: [authenticate, validate(changePasswordSchema)],
  }, authController.changePassword as any);

  app.post('/switch-shop', {
    preHandler: [authenticate, validate(switchShopSchema)],
  }, authController.switchShop as any);
}
