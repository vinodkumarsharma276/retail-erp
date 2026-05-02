import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
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
import { rolesRoutes } from './modules/roles/roles.routes.js';
import { ocrRoutes } from './modules/ocr/ocr.routes.js';
import { lookupRoutes } from './modules/lookup/lookup.routes.js';
import { registerInstallmentScheduler } from './jobs/installments-scheduler.js';

function isAllowedDevOrigin(origin: string) {
  try {
    const url = new URL(origin);
    const isWebDevPort = url.port === '5173' || url.port === '4173';
    const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    const isPrivateLan = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(url.hostname);
    return isWebDevPort && (isLocalhost || isPrivateLan);
  } catch {
    return false;
  }
}

function isAllowedCorsOrigin(origin: string | undefined) {
  if (!origin) return true;

  const configuredOrigins = config.corsOrigin
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (configuredOrigins.includes(origin)) return true;
  return config.nodeEnv !== 'production' && isAllowedDevOrigin(origin);
}

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    },
  });

  // Plugins
  await app.register(cors, {
    origin: (origin, callback) => {
      callback(null, isAllowedCorsOrigin(origin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Shop-Id'],
  });
  await app.register(jwt, { secret: config.jwt.secret });
  await app.register(cookie);
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });
  await app.register(multipart, {
    limits: {
      files: 1,
      fileSize: config.ocr.maxFileMb * 1024 * 1024,
    },
  });

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
  await app.register(rolesRoutes, { prefix: '/api/v1/roles' });
  await app.register(ocrRoutes, { prefix: '/api/v1/ocr' });
  await app.register(lookupRoutes, { prefix: '/api/v1/lookup' });

  // Background jobs (gated by ENABLE_SCHEDULER=true).
  registerInstallmentScheduler(app.log);

  return app;
}
