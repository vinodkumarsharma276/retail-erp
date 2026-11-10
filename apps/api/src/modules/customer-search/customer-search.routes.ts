import type { FastifyInstance } from 'fastify';
import { customerSearchController as c } from './customer-search.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { requireAnyPermission, requirePermission } from '../../middleware/permissions.js';
import { shopScope } from '../../middleware/shop-scope.js';
import { validate } from '../../middleware/validate.js';
import { createEntrySchema, importCommitSchema, importPreviewSchema, updateEntrySchema } from './customer-search.validation.js';

/** A 10,000-row import range is a few MB of JSON (about 500 bytes a row). */
const IMPORT_BODY_LIMIT = 25 * 1024 * 1024;

export async function customerSearchRoutes(app: FastifyInstance) {
  // Search the register (tenant-wide; the sheet covered every shop).
  app.get('/', { preHandler: [authenticate, shopScope, requirePermission('customer_search.list')] }, c.list as any);

  app.get('/prefixes', { preHandler: [authenticate, shopScope, requirePermission('customer_search.list')] }, c.prefixes as any);

  // On-device copy for the mobile app: snapshot pages, then changes and deletions.
  app.get('/sync', { preHandler: [authenticate, shopScope, requirePermission('customer_search.list')] }, c.sync as any);

  // "Needs review": how many entries have each kind of problem.
  app.get('/review-summary', { preHandler: [authenticate, shopScope, requirePermission('customer_search.list')] }, c.reviewSummary as any);

  // Entry-form helpers.
  app.get('/next-number', {
    preHandler: [authenticate, shopScope, requireAnyPermission('customer_search.create', 'customer_search.edit')],
  }, c.nextNumber as any);
  app.get('/customer-matches', {
    preHandler: [authenticate, shopScope, requireAnyPermission('customer_search.create', 'customer_search.edit')],
  }, c.customerMatches as any);

  // Items a customer bought / is co-applicant on (customer detail page).
  app.get('/by-customer/:customerId', { preHandler: [authenticate, shopScope, requirePermission('customer_search.list')] }, c.forCustomer as any);

  // One-off import of the Google Sheet, a range of rows at a time.
  app.get('/import/batches', { preHandler: [authenticate, shopScope, requirePermission('customer_search.import')] }, c.importBatches as any);
  app.post('/import/preview', {
    bodyLimit: IMPORT_BODY_LIMIT,
    preHandler: [authenticate, shopScope, requirePermission('customer_search.import'), validate(importPreviewSchema)],
  }, c.importPreview as any);
  app.post('/import', {
    bodyLimit: IMPORT_BODY_LIMIT,
    preHandler: [authenticate, shopScope, requirePermission('customer_search.import'), validate(importCommitSchema)],
  }, c.importCommit as any);

  app.get('/export', { preHandler: [authenticate, shopScope, requirePermission('customer_search.export')] }, c.export as any);

  app.post('/', {
    preHandler: [authenticate, shopScope, requirePermission('customer_search.create'), validate(createEntrySchema)],
  }, c.create as any);

  app.get('/:id', { preHandler: [authenticate, shopScope, requirePermission('customer_search.detail')] }, c.getById as any);

  app.patch('/:id', {
    preHandler: [authenticate, shopScope, requirePermission('customer_search.edit'), validate(updateEntrySchema)],
  }, c.update as any);

  // Removes the register entry only; the customer and co-applicant stay.
  app.delete('/:id', { preHandler: [authenticate, shopScope, requirePermission('customer_search.delete')] }, c.remove as any);
}
