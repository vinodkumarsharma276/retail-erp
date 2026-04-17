import type { FastifyInstance } from 'fastify';
import { salesController } from './sales.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { authorize } from '../../middleware/rbac.js';
import { shopScope } from '../../middleware/shop-scope.js';
import { validate } from '../../middleware/validate.js';
import { createSaleSchema, recordFinancePaymentSchema, recordPendingPaymentSchema } from './sales.validation.js';
import { UserRole } from '@retailerp/shared-types';

export async function saleRoutes(app: FastifyInstance) {
  const allShopRoles = [
    authenticate,
    authorize([UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.OTHERS]),
    shopScope,
  ];

  const adminAccountant = [
    authenticate,
    authorize([UserRole.ADMIN, UserRole.ACCOUNTANT]),
  ];

  const adminAccountantShopScoped = [
    authenticate,
    authorize([UserRole.ADMIN, UserRole.ACCOUNTANT]),
    shopScope,
  ];

  // List finance companies (any authenticated user)
  app.get('/finance-companies', { preHandler: [authenticate] }, salesController.listFinanceCompanies as any);

  // List sales (admin, accountant, others — shop-scoped)
  // Controller passes role to service for RBAC data isolation
  app.get('/', { preHandler: allShopRoles }, salesController.list as any);

  // Create sale (admin, accountant, others — shop-scoped)
  // "Others" can create but sale form hides installment options from them
  app.post('/', {
    preHandler: [...allShopRoles, validate(createSaleSchema)],
  }, salesController.create as any);

  // Get single sale detail (admin, accountant, others)
  // Controller passes role for RBAC data isolation
  app.get('/:id', { preHandler: allShopRoles }, salesController.getById as any);

  // Get installment schedule (admin, accountant ONLY — never others)
  app.get('/:id/installments', { preHandler: adminAccountant }, salesController.getInstallments as any);

  // Record finance company payment (admin, accountant only)
  app.put('/:id/finance-payment', {
    preHandler: [...adminAccountantShopScoped, validate(recordFinancePaymentSchema)],
  }, salesController.recordFinancePayment as any);

  // Record pending payment (admin, accountant only)
  app.put('/:id/record-payment', {
    preHandler: [...adminAccountantShopScoped, validate(recordPendingPaymentSchema)],
  }, salesController.recordPendingPayment as any);
}
