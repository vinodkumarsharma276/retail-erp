import type { FastifyInstance } from 'fastify';
import { bankController } from './bank.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permissions.js';
import { shopScope } from '../../middleware/shop-scope.js';
import { validate } from '../../middleware/validate.js';
import {
  createAccountSchema,
  addTransactionSchema,
  bulkImportSchema,
  reconcileSchema,
  manualReconcileSchema,
} from './bank.validation.js';

export async function bankRoutes(app: FastifyInstance) {

  // =========================================================================
  // BANK ACCOUNTS
  // =========================================================================

  // List bank accounts (shop-scoped)
  app.get('/accounts', { preHandler: [authenticate, shopScope, requirePermission('bank.view')] }, bankController.listAccounts as any);

  // Create bank account (admin only, shop-scoped)
  app.post('/accounts', {
    preHandler: [authenticate, shopScope, requirePermission('bank.upload_statement'), validate(createAccountSchema)],
  }, bankController.createAccount as any);

  // =========================================================================
  // TRANSACTIONS
  // =========================================================================

  // List transactions for a bank account
  app.get('/accounts/:id/transactions', {
    preHandler: [authenticate, shopScope, requirePermission('bank.view')],
  }, bankController.listTransactions as any);

  // Add single transaction to a bank account
  app.post('/accounts/:id/transactions', {
    preHandler: [authenticate, shopScope, requirePermission('bank.reconcile'), validate(addTransactionSchema)],
  }, bankController.addTransaction as any);

  // Bulk import transactions (parsed CSV upload)
  app.post('/accounts/:id/upload-statement', {
    preHandler: [authenticate, shopScope, requirePermission('bank.upload_statement'), validate(bulkImportSchema)],
  }, bankController.bulkImportTransactions as any);

  // =========================================================================
  // RECONCILIATION
  // =========================================================================

  // Get all unmatched transactions across all shop accounts
  app.get('/transactions/unmatched', {
    preHandler: [authenticate, shopScope, requirePermission('bank.view')],
  }, bankController.getUnmatched as any);

  // Get suggested matches for a transaction
  app.get('/transactions/:id/suggestions', {
    preHandler: [authenticate, shopScope, requirePermission('bank.view')],
  }, bankController.getSuggestedMatches as any);

  // Reconcile a transaction with a known entity
  app.put('/transactions/:id/reconcile', {
    preHandler: [authenticate, shopScope, requirePermission('bank.reconcile'), validate(reconcileSchema)],
  }, bankController.reconcile as any);

  // Manually reconcile a transaction with notes
  app.put('/transactions/:id/manual-reconcile', {
    preHandler: [authenticate, shopScope, requirePermission('bank.reconcile'), validate(manualReconcileSchema)],
  }, bankController.manualReconcile as any);
}
