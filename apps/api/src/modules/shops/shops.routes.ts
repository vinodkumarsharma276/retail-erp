import type { FastifyInstance } from 'fastify';
import { shopsController } from './shops.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { authorize } from '../../middleware/rbac.js';
import { validate } from '../../middleware/validate.js';
import { updateShopSchema } from './shops.validation.js';
import { UserRole } from '@retailerp/shared-types';

export async function shopRoutes(app: FastifyInstance) {
  // Listing all shops + edit are admin-only.
  app.get('/', {
    preHandler: [authenticate, authorize([UserRole.ADMIN])],
  }, shopsController.list);

  // Reading a single shop's public details (name, address, GSTIN, phone)
  // is open to any authenticated user — the frontend invoice generator
  // pulls these for the bill header, so blocking non-admins produced
  // invoices with blank shop info.
  app.get('/:id', {
    preHandler: [authenticate],
  }, shopsController.getById as any);

  app.put('/:id', {
    preHandler: [authenticate, authorize([UserRole.ADMIN]), validate(updateShopSchema)],
  }, shopsController.update as any);
}
