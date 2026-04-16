import type { FastifyInstance } from 'fastify';
import { dashboardController } from './dashboard.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { authorize } from '../../middleware/rbac.js';
import { shopScope } from '../../middleware/shop-scope.js';
import { UserRole } from '@retailerp/shared-types';

export async function dashboardRoutes(app: FastifyInstance) {
  // All dashboard routes are admin-only and shop-scoped
  const adminOnly = [
    authenticate,
    authorize([UserRole.ADMIN]),
    shopScope,
  ];

  // GET /sales-graph?dateFrom=&dateTo= — Daily sales totals for charting
  app.get('/sales-graph', { preHandler: adminOnly }, dashboardController.getSalesGraph as any);

  // GET /top-products?dateFrom=&dateTo=&limit= — Top N products by sale count
  app.get('/top-products', { preHandler: adminOnly }, dashboardController.getTopProducts as any);

  // GET /yoy-comparison?dateFrom=&dateTo= — Year-over-year sales comparison
  app.get('/yoy-comparison', { preHandler: adminOnly }, dashboardController.getYoYComparison as any);

  // GET /overdue-installments?dateFrom=&dateTo= — Overdue installments list
  app.get('/overdue-installments', { preHandler: adminOnly }, dashboardController.getOverdueInstallments as any);

  // GET /summary — Dashboard header summary metrics
  app.get('/summary', { preHandler: adminOnly }, dashboardController.getSummary as any);
}
