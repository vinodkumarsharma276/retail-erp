import type { FastifyInstance } from 'fastify';
import { FeatureKey, UserRole } from '@retailerp/shared-types';
import { authenticate } from '../../middleware/auth.js';
import { featureGate } from '../../middleware/feature-gate.js';
import { requirePermission } from '../../middleware/permissions.js';
import { shopScope } from '../../middleware/shop-scope.js';
import { bankStatementsController as c } from './bank-statements.controller.js';
import { feedsController as f } from './feeds/feeds.controller.js';
import { authorize } from '../../middleware/rbac.js';

/**
 * Bank statement analysis: upload PDF / Excel / CSV / image statements, parse
 * and categorise every transaction, flag unusual ones for review, and chart
 * cash flow by shop, party and category. Ported from LedgerLens.
 *
 * Everything is tenant-scoped and limited to the shops the user can access
 * (the header shop switcher; "All Shops" fans out across accessible shops).
 */
export async function bankStatementRoutes(app: FastifyInstance) {
  const base = [authenticate, shopScope, featureGate(FeatureKey.BANK_RECONCILIATION)];
  const can = (perm: string) => ({ preHandler: [...base, requirePermission(perm)] });

  app.get('/meta', can('bank.view'), c.meta as any);
  app.get('/analytics', can('bank.view'), c.analytics as any);
  app.get('/export', can('bank.view'), c.exportTransactions as any);

  app.get('/statements', can('bank.view'), c.listStatements as any);
  app.post(
    '/statements/upload',
    { ...can('bank.upload_statement'), config: { rateLimit: { max: 60, timeWindow: '5 minutes' } } },
    c.upload as any,
  );
  app.patch('/statements/:id', can('bank.upload_statement'), c.updateStatement as any);
  app.post('/statements/:id/recategorize', can('bank.upload_statement'), c.recategorize as any);
  app.delete('/statements/:id', can('bank.delete_statement'), c.deleteStatement as any);
  // Original file (only exists if the tenant kept files when it was uploaded).
  app.get('/statements/:id/file', can('bank.view'), c.downloadFile as any);

  // Shop bank accounts, used to map statements to a shop and bank by account number.
  app.get('/accounts', can('bank.view'), c.listAccounts as any);
  app.post('/accounts', can('bank.reconcile'), c.createAccount as any);
  app.delete('/accounts/:id', can('bank.reconcile'), c.deleteAccount as any);

  // Automatic bank feeds (paid add-on). The list stays open so the UI can offer the upgrade;
  // connecting holds bank credentials, so it is owner/admin only.
  const feedsOn = featureGate(FeatureKey.BANK_API_FEEDS);
  const ownerAdmin = [...base, authorize([UserRole.ADMIN]), requirePermission('bank.view'), feedsOn];
  app.get('/feeds', can('bank.view'), f.list as any);
  app.post('/feeds', { preHandler: ownerAdmin }, f.connect as any);
  app.patch('/feeds/:id', { preHandler: ownerAdmin }, f.update as any);
  app.delete('/feeds/:id', { preHandler: ownerAdmin }, f.disconnect as any);
  app.post('/feeds/:id/sync', { preHandler: [...base, requirePermission('bank.upload_statement'), feedsOn] }, f.sync as any);
  app.get('/feeds/:id/runs', { preHandler: [...base, requirePermission('bank.view'), feedsOn] }, f.runs as any);

  app.get('/transactions', can('bank.view'), c.listTransactions as any);
  app.get('/transactions/facets', can('bank.view'), c.facets as any);
  app.get('/transactions/:id', can('bank.view'), c.getTransaction as any);
  app.patch('/transactions/:id', can('bank.reconcile'), c.updateTransaction as any);
  app.post('/transactions/bulk', can('bank.reconcile'), c.bulkUpdate as any);

  app.get('/rules', can('bank.view'), c.listRules as any);
  app.post('/rules', can('bank.reconcile'), c.createRule as any);
  app.delete('/rules/:id', can('bank.reconcile'), c.deleteRule as any);

  app.get('/settings', can('bank.view'), c.getSettings as any);
  app.put('/settings', can('bank.reconcile'), c.updateSettings as any);
}
