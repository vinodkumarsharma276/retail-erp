import type { FastifyInstance } from 'fastify';
import { productsController } from './products.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { authorize } from '../../middleware/rbac.js';
import { shopScope } from '../../middleware/shop-scope.js';
import { validate } from '../../middleware/validate.js';
import { createProductSchema, updateProductSchema } from './products.validation.js';
import { UserRole } from '@retailerp/shared-types';

export async function productRoutes(app: FastifyInstance) {
  const allRoles = [authenticate, shopScope];
  const adminAccountant = [
    authenticate,
    authorize([UserRole.ADMIN, UserRole.ACCOUNTANT]),
    shopScope,
  ];

  // List products (paginated, filtered, shop-scoped)
  app.get('/', { preHandler: allRoles }, productsController.list as any);

  // Global search across categories (shop-scoped)
  app.get('/search', { preHandler: allRoles }, productsController.globalSearch as any);

  // Create product (admin + accountant only)
  app.post('/', {
    preHandler: [...adminAccountant, validate(createProductSchema)],
  }, productsController.create as any);

  // Get single product
  app.get('/:id', { preHandler: allRoles }, productsController.getById as any);

  // Update product (admin + accountant only)
  app.put('/:id', {
    preHandler: [...adminAccountant, validate(updateProductSchema)],
  }, productsController.update as any);

  // Get product audit trail / history
  app.get('/:id/history', { preHandler: allRoles }, productsController.getHistory as any);

  // Check if product can be sold
  app.get('/:id/can-sell', { preHandler: allRoles }, productsController.canSell as any);
}
