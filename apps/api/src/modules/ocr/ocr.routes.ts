import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission, requireAnyPermission } from '../../middleware/permissions.js';
import { shopScope } from '../../middleware/shop-scope.js';
import { ocrController } from './ocr.controller.js';

export async function ocrRoutes(app: FastifyInstance) {

  app.get('/status', {
    preHandler: [authenticate],
  }, ocrController.status as any);

  app.post('/invoice', {
    preHandler: [authenticate, shopScope, requirePermission('purchases.create')],
    config: { rateLimit: { max: 30, timeWindow: '5 minutes' } },
  }, ocrController.parseInvoice as any);

  app.post('/register-entry', {
    preHandler: [authenticate, shopScope, requireAnyPermission('sales.create_full_payment', 'sales.create_partial_with_promise', 'sales.create_self_finance', 'sales.create_company_finance')],
    config: { rateLimit: { max: 30, timeWindow: '5 minutes' } },
  }, ocrController.parseRegisterEntry as any);
}