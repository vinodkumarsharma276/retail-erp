import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission, requireAnyPermission } from '../../middleware/permissions.js';
import { shopScope } from '../../middleware/shop-scope.js';
import { validate } from '../../middleware/validate.js';
import { promisesController } from './promises.controller.js';
import { createPromiseSchema } from './promises.validation.js';

export async function promisesRoutes(app: FastifyInstance) {

  app.post('/', {
    preHandler: [authenticate, shopScope, requirePermission('installments.record_payment'), validate(createPromiseSchema)],
  }, promisesController.create as any);

  app.get('/', {
    preHandler: [authenticate, shopScope, requireAnyPermission('installments.detail', 'installments.list')],
  }, promisesController.list as any);

  app.delete('/:id', {
    preHandler: [authenticate, shopScope, requirePermission('installments.revert_payment')],
  }, promisesController.cancel as any);
}
