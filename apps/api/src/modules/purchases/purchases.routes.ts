import type { FastifyInstance } from 'fastify';
import { purchasesController } from './purchases.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission, requireAnyPermission } from '../../middleware/permissions.js';
import { shopScope } from '../../middleware/shop-scope.js';
import { validate } from '../../middleware/validate.js';
import {
  createPurchaseSchema,
  updatePurchaseSchema,
  recordPaymentSchema,
  purchaseImportSchema,
  classifyItemsSchema,
  saveClassificationsSchema,
  lookupItemSchema,
  forgetClassificationsSchema,
} from './purchases.validation.js';

export async function purchaseRoutes(app: FastifyInstance) {

  // List purchases (paginated, filtered, shop-scoped)
  app.get('/', { preHandler: [authenticate, shopScope, requirePermission('purchases.list')] }, purchasesController.list as any);

  // Check whether an invoice number already exists for a distributor
  app.get('/check-invoice', { preHandler: [authenticate, requireAnyPermission('purchases.create', 'purchases.edit')] }, purchasesController.checkInvoice as any);

  // Create purchase with products (shop-scoped)
  app.post('/', {
    preHandler: [authenticate, shopScope, requirePermission('purchases.create'), validate(createPurchaseSchema)],
  }, purchasesController.create as any);

  // Bulk import from a spreadsheet: preview (nothing saved), then commit.
  // A year of Tally lines can run to several MB of JSON.
  app.post('/import/preview', {
    bodyLimit: 25 * 1024 * 1024,
    preHandler: [authenticate, shopScope, requirePermission('purchases.create'), validate(purchaseImportSchema)],
  }, purchasesController.importPreview as any);

  app.post('/import', {
    bodyLimit: 25 * 1024 * 1024,
    preHandler: [authenticate, shopScope, requirePermission('purchases.create'), validate(purchaseImportSchema)],
  }, purchasesController.importCommit as any);

  // Identify the sheet item names before the preview, and keep corrections.
  app.post('/import/classify', {
    bodyLimit: 2 * 1024 * 1024,
    preHandler: [authenticate, requirePermission('purchases.create'), validate(classifyItemsSchema)],
  }, purchasesController.classifyItems as any);

  // Fetch one product’s details from the web, from the identify screen.
  app.post('/import/lookup', {
    preHandler: [authenticate, requirePermission('purchases.create'), validate(lookupItemSchema)],
  }, purchasesController.lookupItem as any);

  app.put('/import/classifications', {
    bodyLimit: 2 * 1024 * 1024,
    preHandler: [authenticate, requirePermission('purchases.create'), validate(saveClassificationsSchema)],
  }, purchasesController.saveClassifications as any);

  // Forget a stored answer, so the name is worked out again next run.
  app.delete('/import/classifications', {
    preHandler: [authenticate, requirePermission('purchases.create'), validate(forgetClassificationsSchema)],
  }, purchasesController.forgetClassifications as any);

  // Past import runs.
  app.get('/import/batches', {
    preHandler: [authenticate, shopScope, requirePermission('purchases.list')],
  }, purchasesController.importBatches as any);

  // Get single purchase detail
  app.get('/:id', { preHandler: [authenticate, requirePermission('purchases.detail')] }, purchasesController.getById as any);

  // Update purchase header
  app.put('/:id', {
    preHandler: [authenticate, requirePermission('purchases.edit'), validate(updatePurchaseSchema)],
  }, purchasesController.update as any);

  // Record a payment for a purchase
  app.post('/:id/payments', {
    preHandler: [authenticate, requirePermission('purchases.record_payment'), validate(recordPaymentSchema)],
  }, purchasesController.recordPayment as any);
}
