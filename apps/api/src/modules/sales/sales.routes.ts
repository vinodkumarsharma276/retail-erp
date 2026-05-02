import type { FastifyInstance } from 'fastify';
import { salesController } from './sales.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { authorize } from '../../middleware/rbac.js';
import { requirePermission, requireAnyPermission } from '../../middleware/permissions.js';
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

  // List sales (requires sales.list permission)
  // Controller passes role to service for RBAC data isolation
  app.get('/', { preHandler: [...allShopRoles, requirePermission('sales.list')] }, salesController.list as any);

  // Create sale (requires at least one sales.create_* permission)
  // "Others" can create but sale form hides installment options from them
  app.post('/', {
    preHandler: [
      ...allShopRoles,
      requireAnyPermission(
        'sales.create_full_payment',
        'sales.create_partial_with_promise',
        'sales.create_self_finance',
        'sales.create_company_finance',
      ),
      validate(createSaleSchema),
    ],
  }, salesController.create as any);

  // Get single sale detail (requires sales.detail permission)
  // Controller passes role for RBAC data isolation
  app.get('/:id', { preHandler: [...allShopRoles, requirePermission('sales.detail')] }, salesController.getById as any);

  // Update sale (requires sales.edit permission)
  app.put('/:id', {
    preHandler: [
      ...allShopRoles,
      requirePermission('sales.edit'),
      validate(createSaleSchema),
    ],
  }, salesController.update as any);

  // Get installment schedule (requires sales.detail + sales.view_real)
  app.get('/:id/installments', {
    preHandler: [...adminAccountant, requirePermission('sales.view_real')],
  }, salesController.getInstallments as any);

  // Get sale activity / audit log (requires sales.view_history — Owner-only by default)
  app.get('/:id/activity', {
    preHandler: [...allShopRoles, requirePermission('sales.view_history')],
  }, salesController.getActivity as any);

  // Record finance company payment (requires sales.record_company_finance_payment)
  app.put('/:id/finance-payment', {
    preHandler: [
      ...adminAccountantShopScoped,
      requirePermission('sales.record_company_finance_payment'),
      validate(recordFinancePaymentSchema),
    ],
  }, salesController.recordFinancePayment as any);

  // Record pending payment (requires sales.mark_partial_settled)
  app.put('/:id/record-payment', {
    preHandler: [
      ...adminAccountantShopScoped,
      requirePermission('sales.mark_partial_settled'),
      validate(recordPendingPaymentSchema),
    ],
  }, salesController.recordPendingPayment as any);
}
