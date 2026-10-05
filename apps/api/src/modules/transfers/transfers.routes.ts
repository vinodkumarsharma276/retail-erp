import type { FastifyInstance } from 'fastify';
import { transfersController } from './transfers.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission, requireAnyPermission } from '../../middleware/permissions.js';
import { shopScope } from '../../middleware/shop-scope.js';
import { validate } from '../../middleware/validate.js';
import { initiateTransferSchema } from './transfers.validation.js';

export async function transferRoutes(app: FastifyInstance) {

  // List transfers involving the currently selected shop (as source or
  // destination). Shop-scoped so switching shops via the header dropdown
  // immediately changes the visible transfer book.
  app.get('/', { preHandler: [authenticate, shopScope, requirePermission('transfers.list')] }, transfersController.list as any);

  // Get incoming transfers for current shop (admin — shop-scoped)
  app.get('/incoming', { preHandler: [authenticate, shopScope, requireAnyPermission('transfers.list', 'transfers.receive')] }, transfersController.getIncoming as any);

  // Get single transfer detail (admin, accountant)
  app.get('/:id', { preHandler: [authenticate, requirePermission('transfers.detail')] }, transfersController.getById as any);

  // Initiate a transfer (admin only — shop-scoped, fromShopId = current shop)
  app.post('/', {
    preHandler: [authenticate, shopScope, requirePermission('transfers.initiate'), validate(initiateTransferSchema)],
  }, transfersController.initiate as any);

  // Receive a transfer (admin only)
  app.put('/:id/receive', { preHandler: [authenticate, requirePermission('transfers.receive')] }, transfersController.receive as any);

  // Cancel a transfer (admin only)
  app.put('/:id/cancel', { preHandler: [authenticate, requirePermission('transfers.cancel')] }, transfersController.cancel as any);
}
