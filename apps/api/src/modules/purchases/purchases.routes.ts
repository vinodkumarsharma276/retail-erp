import type { FastifyInstance } from 'fastify';
import { purchasesController } from './purchases.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { authorize } from '../../middleware/rbac.js';
import { shopScope } from '../../middleware/shop-scope.js';
import { validate } from '../../middleware/validate.js';
import { createPurchaseSchema, updatePurchaseSchema, recordPaymentSchema } from './purchases.validation.js';
import { UserRole } from '@retailerp/shared-types';

export async function purchaseRoutes(app: FastifyInstance) {
  const adminAccountant = [
    authenticate,
    authorize([UserRole.ADMIN, UserRole.ACCOUNTANT]),
  ];

  const adminAccountantShopScoped = [
    authenticate,
    authorize([UserRole.ADMIN, UserRole.ACCOUNTANT]),
    shopScope,
  ];

  // List purchases (paginated, filtered, shop-scoped)
  app.get('/', { preHandler: adminAccountantShopScoped }, purchasesController.list as any);

  // Check whether an invoice number already exists for a distributor
  app.get('/check-invoice', { preHandler: adminAccountant }, purchasesController.checkInvoice as any);

  // Create purchase with products (shop-scoped)
  app.post('/', {
    preHandler: [...adminAccountantShopScoped, validate(createPurchaseSchema)],
  }, purchasesController.create as any);

  // Get single purchase detail
  app.get('/:id', { preHandler: adminAccountant }, purchasesController.getById as any);

  // Update purchase header
  app.put('/:id', {
    preHandler: [...adminAccountant, validate(updatePurchaseSchema)],
  }, purchasesController.update as any);

  // Record a payment for a purchase
  app.post('/:id/payments', {
    preHandler: [...adminAccountant, validate(recordPaymentSchema)],
  }, purchasesController.recordPayment as any);
}
