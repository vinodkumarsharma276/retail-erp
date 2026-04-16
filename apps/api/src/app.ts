import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { config } from './config/index.js';
import { errorHandler } from './middleware/error-handler.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { shopRoutes } from './modules/shops/shops.routes.js';
import { userRoutes } from './modules/users/users.routes.js';
import { categoryRoutes } from './modules/categories/categories.routes.js';
import { productRoutes } from './modules/products/products.routes.js';
import { distributorRoutes } from './modules/distributors/distributors.routes.js';
import { purchaseRoutes } from './modules/purchases/purchases.routes.js';
import { customerRoutes } from './modules/customers/customers.routes.js';
import { saleRoutes } from './modules/sales/sales.routes.js';
import { installmentRoutes } from './modules/installments/installments.routes.js';
import { transferRoutes } from './modules/transfers/transfers.routes.js';
import { expenseRoutes } from './modules/expenses/expenses.routes.js';
import { bankRoutes } from './modules/bank/bank.routes.js';
import { dashboardRoutes } from './modules/dashboard/dashboard.routes.js';
import { formRoutes } from './modules/forms/forms.routes.js';
import { employeeRoutes } from './modules/employees/employees.routes.js';
import { notificationRoutes } from './modules/notifications/notifications.routes.js';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    },
  });

  // Plugins
  await app.register(cors, { origin: config.corsOrigin, credentials: true });
  await app.register(jwt, { secret: config.jwt.secret });
  await app.register(cookie);
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });

  // Error handler
  app.setErrorHandler(errorHandler);

  // Health check
  app.get('/api/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  // Routes
  await app.register(authRoutes, { prefix: '/api/v1/auth' });

  // Module routes
  await app.register(shopRoutes, { prefix: '/api/v1/shops' });
  await app.register(userRoutes, { prefix: '/api/v1/users' });
  await app.register(categoryRoutes, { prefix: '/api/v1/categories' });
  await app.register(productRoutes, { prefix: '/api/v1/products' });
  await app.register(distributorRoutes, { prefix: '/api/v1/distributors' });
  await app.register(purchaseRoutes, { prefix: '/api/v1/purchases' });
  await app.register(customerRoutes, { prefix: '/api/v1/customers' });
  await app.register(saleRoutes, { prefix: '/api/v1/sales' });
  await app.register(installmentRoutes, { prefix: '/api/v1/installments' });
  await app.register(transferRoutes, { prefix: '/api/v1/transfers' });
  await app.register(expenseRoutes, { prefix: '/api/v1/expenses' });
  await app.register(bankRoutes, { prefix: '/api/v1/bank' });
  await app.register(dashboardRoutes, { prefix: '/api/v1/dashboard' });
  await app.register(formRoutes, { prefix: '/api/v1/forms' });
  await app.register(employeeRoutes, { prefix: '/api/v1/employees' });
  await app.register(notificationRoutes, { prefix: '/api/v1/notifications' });

  return app;
}
