import type { FastifyInstance } from 'fastify';
import { transfersController } from './transfers.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { authorize } from '../../middleware/rbac.js';
import { shopScope } from '../../middleware/shop-scope.js';
import { validate } from '../../middleware/validate.js';
import { initiateTransferSchema } from './transfers.validation.js';
import { UserRole } from '@retailerp/shared-types';

export async function transferRoutes(app: FastifyInstance) {
  const adminAccountant = [
    authenticate,
    authorize([UserRole.ADMIN, UserRole.ACCOUNTANT]),
  ];

  const adminAccountantShopScoped = [
    authenticate,
    authorize([UserRole.ADMIN, UserRole.ACCOUNTANT]),
    shopScope,
  ];

  const adminOnly = [
    authenticate,
    authorize([UserRole.ADMIN]),
  ];

  const adminOnlyShopScoped = [
    authenticate,
    authorize([UserRole.ADMIN]),
    shopScope,
  ];

  // List transfers involving the currently selected shop (as source or
  // destination). Shop-scoped so switching shops via the header dropdown
  // immediately changes the visible transfer book.
  app.get('/', { preHandler: adminAccountantShopScoped }, transfersController.list as any);

  // Get incoming transfers for current shop (admin — shop-scoped)
  app.get('/incoming', { preHandler: adminOnlyShopScoped }, transfersController.getIncoming as any);

  // Get single transfer detail (admin, accountant)
  app.get('/:id', { preHandler: adminAccountant }, transfersController.getById as any);

  // Initiate a transfer (admin only — shop-scoped, fromShopId = current shop)
  app.post('/', {
    preHandler: [...adminOnlyShopScoped, validate(initiateTransferSchema)],
  }, transfersController.initiate as any);

  // Receive a transfer (admin only)
  app.put('/:id/receive', { preHandler: adminOnly }, transfersController.receive as any);

  // Cancel a transfer (admin only)
  app.put('/:id/cancel', { preHandler: adminOnly }, transfersController.cancel as any);
}
