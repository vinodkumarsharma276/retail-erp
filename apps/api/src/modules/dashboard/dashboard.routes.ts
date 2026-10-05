import type { FastifyInstance } from 'fastify';
import { dashboardController } from './dashboard.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permissions.js';
import { shopScope } from '../../middleware/shop-scope.js';

export async function dashboardRoutes(app: FastifyInstance) {
  // All dashboard routes are admin-only and shop-scoped

  // GET /sales-graph?dateFrom=&dateTo= — Daily sales totals for charting
  app.get('/sales-graph', { preHandler: [authenticate, shopScope, requirePermission('dashboard.sales_chart')] }, dashboardController.getSalesGraph as any);

  // GET /top-products?dateFrom=&dateTo=&limit= — Top N products by sale count
  app.get('/top-products', { preHandler: [authenticate, shopScope, requirePermission('dashboard.top_products')] }, dashboardController.getTopProducts as any);

  // GET /yoy-comparison?dateFrom=&dateTo= — Year-over-year sales comparison
  app.get('/yoy-comparison', { preHandler: [authenticate, shopScope, requirePermission('dashboard.yoy_comparison')] }, dashboardController.getYoYComparison as any);

  // GET /overdue-installments?dateFrom=&dateTo= — Overdue installments list
  app.get('/overdue-installments', { preHandler: [authenticate, shopScope, requirePermission('dashboard.overdue_table')] }, dashboardController.getOverdueInstallments as any);

  // GET /summary — Dashboard header summary metrics
  app.get('/summary', { preHandler: [authenticate, shopScope, requirePermission('dashboard.summary_cards')] }, dashboardController.getSummary as any);

  // GET /low-margin-sales?threshold=&dateFrom=&dateTo= — Sales whose net-profit % is at most threshold
  app.get('/low-margin-sales', { preHandler: [authenticate, shopScope, requirePermission('dashboard.view_profit')] }, dashboardController.getLowMarginSales as any);
}
