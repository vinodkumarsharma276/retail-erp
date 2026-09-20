import type { FastifyInstance } from 'fastify';
import { platformAuthenticate } from '../../middleware/platform-auth.js';
import { validate } from '../../middleware/validate.js';
import {
  platformLoginSchema,
  platformRefreshSchema,
  createTenantSchema,
  updateTenantSchema,
  upsertTenantFeatureSchema,
  createPlanSchema,
  updatePlanSchema,
  setPlanFeatureSchema,
} from './platform.validation.js';
import {
  platformAuthController,
  tenantsController,
  plansController,
} from './platform.controller.js';

/**
 * Platform-admin routes. Mounted at `/api/v1/platform`. The
 * `tenantResolver` middleware in `app.ts` bypasses this prefix so no
 * tenant subdomain is needed — these endpoints are reached at the apex
 * `admin.retailerp.com` host. All routes except auth/login require a
 * platform-admin JWT (scope === 'platform').
 */
export async function platformRoutes(app: FastifyInstance) {
  // ── Auth ────────────────────────────────────────────────────────────
  app.post(
    '/auth/login',
    { preHandler: [validate(platformLoginSchema)] },
    platformAuthController.login as any,
  );
  app.post(
    '/auth/refresh',
    { preHandler: [validate(platformRefreshSchema)] },
    platformAuthController.refresh as any,
  );
  app.post('/auth/logout', platformAuthController.logout as any);
  app.get(
    '/auth/me',
    { preHandler: [platformAuthenticate] },
    platformAuthController.me as any,
  );

  // ── Tenants ─────────────────────────────────────────────────────────
  app.get('/tenants', { preHandler: [platformAuthenticate] }, tenantsController.list as any);
  app.get('/tenants/:id', { preHandler: [platformAuthenticate] }, tenantsController.get as any);
  app.post(
    '/tenants',
    { preHandler: [platformAuthenticate, validate(createTenantSchema)] },
    tenantsController.create as any,
  );
  app.patch(
    '/tenants/:id',
    { preHandler: [platformAuthenticate, validate(updateTenantSchema)] },
    tenantsController.update as any,
  );

  // Feature overrides for a tenant
  app.get(
    '/tenants/:id/features',
    { preHandler: [platformAuthenticate] },
    tenantsController.listFeatures as any,
  );
  app.post(
    '/tenants/:id/features',
    { preHandler: [platformAuthenticate, validate(upsertTenantFeatureSchema)] },
    tenantsController.upsertFeature as any,
  );
  app.delete(
    '/tenants/:id/features/:featureKey',
    { preHandler: [platformAuthenticate] },
    tenantsController.deleteFeatureOverride as any,
  );

  app.post(
    '/tenants/:id/reset-owner-password',
    { preHandler: [platformAuthenticate] },
    tenantsController.resetOwnerPassword as any,
  );

  // ── Plans ───────────────────────────────────────────────────────────
  app.get('/plans', { preHandler: [platformAuthenticate] }, plansController.list as any);
  app.get('/plans/:code', { preHandler: [platformAuthenticate] }, plansController.get as any);
  app.post(
    '/plans',
    { preHandler: [platformAuthenticate, validate(createPlanSchema)] },
    plansController.create as any,
  );
  app.patch(
    '/plans/:id',
    { preHandler: [platformAuthenticate, validate(updatePlanSchema)] },
    plansController.update as any,
  );
  app.post(
    '/plans/:id/features',
    { preHandler: [platformAuthenticate, validate(setPlanFeatureSchema)] },
    plansController.setFeature as any,
  );
}
