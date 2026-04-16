import type { FastifyInstance } from 'fastify';
import { bankController } from './bank.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { authorize } from '../../middleware/rbac.js';
import { shopScope } from '../../middleware/shop-scope.js';
import { validate } from '../../middleware/validate.js';
import {
  createAccountSchema,
  addTransactionSchema,
  bulkImportSchema,
  reconcileSchema,
  manualReconcileSchema,
} from './bank.validation.js';
import { UserRole } from '@retailerp/shared-types';

export async function bankRoutes(app: FastifyInstance) {
  const adminAccountant = [
    authenticate,
    authorize([UserRole.ADMIN, UserRole.ACCOUNTANT]),
    shopScope,
  ];

  const adminOnly = [
    authenticate,
    authorize([UserRole.ADMIN]),
    shopScope,
  ];

  // =========================================================================
  // BANK ACCOUNTS
  // =========================================================================

  // List bank accounts (shop-scoped)
  app.get('/accounts', { preHandler: adminAccountant }, bankController.listAccounts as any);

  // Create bank account (admin only, shop-scoped)
  app.post('/accounts', {
    preHandler: [...adminOnly, validate(createAccountSchema)],
  }, bankController.createAccount as any);

  // =========================================================================
  // TRANSACTIONS
  // =========================================================================

  // List transactions for a bank account
  app.get('/accounts/:id/transactions', {
    preHandler: adminAccountant,
  }, bankController.listTransactions as any);

  // Add single transaction to a bank account
  app.post('/accounts/:id/transactions', {
    preHandler: [...adminAccountant, validate(addTransactionSchema)],
  }, bankController.addTransaction as any);

  // Bulk import transactions (parsed CSV upload)
  app.post('/accounts/:id/upload-statement', {
    preHandler: [...adminAccountant, validate(bulkImportSchema)],
  }, bankController.bulkImportTransactions as any);

  // =========================================================================
  // RECONCILIATION
  // =========================================================================

  // Get all unmatched transactions across all shop accounts
  app.get('/transactions/unmatched', {
    preHandler: adminAccountant,
  }, bankController.getUnmatched as any);

  // Get suggested matches for a transaction
  app.get('/transactions/:id/suggestions', {
    preHandler: adminAccountant,
  }, bankController.getSuggestedMatches as any);

  // Reconcile a transaction with a known entity
  app.put('/transactions/:id/reconcile', {
    preHandler: [...adminAccountant, validate(reconcileSchema)],
  }, bankController.reconcile as any);

  // Manually reconcile a transaction with notes
  app.put('/transactions/:id/manual-reconcile', {
    preHandler: [...adminAccountant, validate(manualReconcileSchema)],
  }, bankController.manualReconcile as any);
}
