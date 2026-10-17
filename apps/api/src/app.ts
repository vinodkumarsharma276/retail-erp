import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { config } from './config/index.js';
import { errorHandler } from './middleware/error-handler.js';
import { tenantResolver } from './middleware/tenant-resolver.js';
import { tenantContext } from './config/tenant-context.js';
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
import { promisesRoutes } from './modules/promises/promises.routes.js';
import { transferRoutes } from './modules/transfers/transfers.routes.js';
import { expenseRoutes } from './modules/expenses/expenses.routes.js';
import { bankRoutes } from './modules/bank/bank.routes.js';
import { bankStatementRoutes } from './modules/bank-statements/bank-statements.routes.js';
import { dashboardRoutes } from './modules/dashboard/dashboard.routes.js';
import { formRoutes } from './modules/forms/forms.routes.js';
import { employeeRoutes } from './modules/employees/employees.routes.js';
import { notificationRoutes } from './modules/notifications/notifications.routes.js';
import { rolesRoutes } from './modules/roles/roles.routes.js';
import { ocrRoutes } from './modules/ocr/ocr.routes.js';
import { lookupRoutes } from './modules/lookup/lookup.routes.js';
import { platformRoutes } from './modules/platform/platform.routes.js';
import { registerInstallmentScheduler } from './jobs/installments-scheduler.js';
import { registerBankFeedScheduler } from './jobs/bank-feeds-scheduler.js';
import { featureGate } from './middleware/feature-gate.js';
import { registerFieldAccess } from './middleware/field-access.js';
import { FeatureKey } from '@retailerp/shared-types';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

/**
 * Register a module's routes behind a tenant feature switch: when the
 * tenant's plan (or override) has the feature off, every route in the
 * module answers 403. With `writesOnly`, reads stay open and only changes
 * are blocked — for modules other screens depend on (forms, roles).
 */
async function registerGated(
  app: FastifyInstance,
  routes: FastifyPluginAsync,
  prefix: string,
  featureKey: string,
  options: { writesOnly?: boolean } = {},
) {
  await app.register(
    async (scope) => {
      const gate = featureGate(featureKey);
      scope.addHook('preHandler', async (request, reply) => {
        if (options.writesOnly && (request.method === 'GET' || request.method === 'HEAD')) return;
        return gate.call(scope, request, reply, () => {});
      });
      await scope.register(routes);
    },
    { prefix },
  );
}

function isAllowedDevOrigin(origin: string) {
  try {
    const url = new URL(origin);
    const isWebDevPort = url.port === '5173' || url.port === '5174' || url.port === '4173';
    const isLocalhost =
      url.hostname === 'localhost' ||
      url.hostname.endsWith('.localhost') ||
      url.hostname === '127.0.0.1';
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
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Shop-Id', 'X-Tenant-Slug'],
    // Lets the web app read download file names (statement exports / originals).
    exposedHeaders: ['Content-Disposition'],
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

  // Tenant resolver — runs on every request BEFORE auth. Bypasses
  // `/api/health`, `/api/ready`, and `/api/v1/platform/*` internally.
  // One tenant context per request; tenantResolver fills in the tenant, and
  // every Prisma query in the request is then scoped to it (config/database.ts).
  app.addHook('onRequest', (_request, _reply, done) => tenantContext.run(done));
  app.addHook('onRequest', tenantResolver);
  // Sensitive fields (cost, Aadhaar, bank details…) leave only with permission.
  registerFieldAccess(app);

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
  // Modules a tenant can have switched off (plan + per-tenant override).
  await registerGated(app, productRoutes, '/api/v1/products', FeatureKey.PRODUCTS);
  await registerGated(app, distributorRoutes, '/api/v1/distributors', FeatureKey.DISTRIBUTORS);
  await registerGated(app, purchaseRoutes, '/api/v1/purchases', FeatureKey.PURCHASES);
  await registerGated(app, customerRoutes, '/api/v1/customers', FeatureKey.CUSTOMERS);
  await registerGated(app, saleRoutes, '/api/v1/sales', FeatureKey.SALES);
  await registerGated(app, installmentRoutes, '/api/v1/installments', FeatureKey.INSTALLMENTS);
  await registerGated(app, promisesRoutes, '/api/v1/promises', FeatureKey.INSTALLMENTS);
  await registerGated(app, transferRoutes, '/api/v1/transfers', FeatureKey.TRANSFERS);
  await registerGated(app, expenseRoutes, '/api/v1/expenses', FeatureKey.EXPENSES);
  await registerGated(app, bankRoutes, '/api/v1/bank', FeatureKey.BANK_RECONCILIATION);
  await registerGated(app, bankStatementRoutes, '/api/v1/bank-statements', FeatureKey.BANK_RECONCILIATION);
  await registerGated(app, dashboardRoutes, '/api/v1/dashboard', FeatureKey.DASHBOARD_ANALYTICS);
  await registerGated(app, formRoutes, '/api/v1/forms', FeatureKey.DYNAMIC_FORMS, { writesOnly: true });
  await registerGated(app, employeeRoutes, '/api/v1/employees', FeatureKey.MOBILE_APP);
  await app.register(notificationRoutes, { prefix: '/api/v1/notifications' });
  await registerGated(app, rolesRoutes, '/api/v1/roles', FeatureKey.CUSTOM_ROLES, { writesOnly: true });
  await registerGated(app, ocrRoutes, '/api/v1/ocr', FeatureKey.OCR_INVOICE_PARSING);
  await app.register(lookupRoutes, { prefix: '/api/v1/lookup' });

  // Platform admin (separate identity, no tenant context — bypassed by tenantResolver)
  await app.register(platformRoutes, { prefix: '/api/v1/platform' });

  // Background jobs (gated by ENABLE_SCHEDULER=true).
  registerInstallmentScheduler(app.log);
  registerBankFeedScheduler(app.log);

  return app;
}
