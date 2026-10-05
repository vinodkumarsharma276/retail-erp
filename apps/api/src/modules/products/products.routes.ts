import type { FastifyInstance } from 'fastify';
import { productsController } from './products.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission, requireAnyPermission } from '../../middleware/permissions.js';
import { shopScope } from '../../middleware/shop-scope.js';
import { validate } from '../../middleware/validate.js';
import { createProductSchema, updateProductSchema } from './products.validation.js';

export async function productRoutes(app: FastifyInstance) {

  // List products (paginated, filtered, shop-scoped)
  app.get('/', { preHandler: [authenticate, shopScope, requireAnyPermission('products.list', 'transfers.initiate')] }, productsController.list as any);

  // List products grouped by (shop, category, brand, model, status) with qty
  app.get('/grouped', { preHandler: [authenticate, shopScope, requirePermission('products.list')] }, productsController.listGrouped as any);

  // Global search across categories (shop-scoped)
  app.get('/search', { preHandler: [authenticate, shopScope, requireAnyPermission('products.list', 'sales.create_full_payment', 'sales.create_partial_with_promise', 'sales.create_self_finance', 'sales.create_company_finance')] }, productsController.globalSearch as any);

  // Create product (admin + accountant only)
  app.post('/', {
    preHandler: [authenticate, shopScope, requirePermission('products.create'), validate(createProductSchema)],
  }, productsController.create as any);

  // Get single product
  app.get('/:id', { preHandler: [authenticate, shopScope, requirePermission('products.detail')] }, productsController.getById as any);

  // Update product (admin + accountant only)
  app.put('/:id', {
    preHandler: [authenticate, shopScope, requirePermission('products.edit'), validate(updateProductSchema)],
  }, productsController.update as any);

  // Get product audit trail / history
  app.get('/:id/history', { preHandler: [authenticate, shopScope, requirePermission('products.audit_trail')] }, productsController.getHistory as any);

  // Check if product can be sold
  app.get('/:id/can-sell', { preHandler: [authenticate, shopScope, requireAnyPermission('sales.create_full_payment', 'sales.create_partial_with_promise', 'sales.create_self_finance', 'sales.create_company_finance')] }, productsController.canSell as any);
}
