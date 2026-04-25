import type { FastifyInstance } from 'fastify';
import { UserRole } from '@retailerp/shared-types';
import { authenticate } from '../../middleware/auth.js';
import { authorize } from '../../middleware/rbac.js';
import { shopScope } from '../../middleware/shop-scope.js';
import { ocrController } from './ocr.controller.js';

export async function ocrRoutes(app: FastifyInstance) {
  const adminAccountantShopScoped = [
    authenticate,
    authorize([UserRole.ADMIN, UserRole.ACCOUNTANT]),
    shopScope,
  ];

  app.get('/status', {
    preHandler: [authenticate],
  }, ocrController.status as any);

  app.post('/invoice', {
    preHandler: adminAccountantShopScoped,
    config: { rateLimit: { max: 30, timeWindow: '5 minutes' } },
  }, ocrController.parseInvoice as any);

  app.post('/register-entry', {
    preHandler: adminAccountantShopScoped,
    config: { rateLimit: { max: 30, timeWindow: '5 minutes' } },
  }, ocrController.parseRegisterEntry as any);
}