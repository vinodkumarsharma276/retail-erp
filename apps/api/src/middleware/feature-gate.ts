/**
 * Feature-flag gate middleware.
 *
 * Usage in a route:
 *   app.get('/', { preHandler: [authenticate, shopScope, featureGate('installments')] }, handler);
 *
 * Resolution order for a given (tenantId, featureKey):
 *   1. `TenantFeature` row exists  → use its `enabled` flag.
 *   2. Otherwise                    → fall back to the tenant's plan
 *      (`PlanFeature` for the tenant's `planId`).
 *   3. No row in either             → feature is treated as DISABLED.
 *
 * Reads are cached in-process for `FEATURE_CACHE_TTL_MS` to keep the
 * middleware near-free on hot paths. Cache is invalidated when the
 * platform admin updates tenant features (via `invalidateFeatureCache`).
 */
import type { FastifyRequest, FastifyReply, preHandlerHookHandler } from 'fastify';
import { prisma } from '../config/database.js';

const FEATURE_CACHE_TTL_MS = 60_000;

interface FeatureSnapshot {
  flags: Record<string, boolean>;
  values: Record<string, unknown>;
  expiresAt: number;
}

const cache = new Map<string, FeatureSnapshot>();

/** Invalidate feature cache for a tenant. Call after platform admin changes. */
export function invalidateFeatureCache(tenantId?: string): void {
  if (tenantId) {
    cache.delete(tenantId);
  } else {
    cache.clear();
  }
}

async function loadFeatureSnapshot(tenantId: string): Promise<FeatureSnapshot> {
  const now = Date.now();
  const cached = cache.get(tenantId);
  if (cached && cached.expiresAt > now) {
    return cached;
  }

  // Pull tenant's plan + override rows in parallel.
  const [tenant, overrides] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { planId: true },
    }),
    prisma.tenantFeature.findMany({
      where: { tenantId },
      select: { featureKey: true, enabled: true, valueJson: true },
    }),
  ]);

  const planFeatures = tenant
    ? await prisma.planFeature.findMany({
        where: { planId: tenant.planId },
        select: { featureKey: true, enabled: true, valueJson: true },
      })
    : [];

  const flags: Record<string, boolean> = {};
  const values: Record<string, unknown> = {};

  // Plan defaults first…
  for (const pf of planFeatures) {
    flags[pf.featureKey] = pf.enabled;
    if (pf.valueJson != null) values[pf.featureKey] = pf.valueJson;
  }
  // …then per-tenant overrides on top.
  for (const tf of overrides) {
    flags[tf.featureKey] = tf.enabled;
    if (tf.valueJson != null) values[tf.featureKey] = tf.valueJson;
  }

  const snap: FeatureSnapshot = {
    flags,
    values,
    expiresAt: now + FEATURE_CACHE_TTL_MS,
  };
  cache.set(tenantId, snap);
  return snap;
}

/**
 * Public helper — load the snapshot for a tenant. Used by the login
 * response so the client receives the full feature map up front and
 * doesn't need a separate round-trip.
 */
export async function getTenantFeatureSnapshot(
  tenantId: string,
): Promise<{ flags: Record<string, boolean>; values: Record<string, unknown> }> {
  const snap = await loadFeatureSnapshot(tenantId);
  return { flags: snap.flags, values: snap.values };
}

/**
 * Build a Fastify preHandler that rejects the request with 403 when the
 * given feature key is disabled for the request's tenant. The key must
 * exist in `packages/shared-types/src/features.ts`.
 */
export function featureGate(featureKey: string): preHandlerHookHandler {
  return async function featureGateHandler(request: FastifyRequest, reply: FastifyReply) {
    const tenantId = request.tenant?.id ?? request.currentUser?.tenantId;
    if (!tenantId) {
      return reply.status(400).send({
        success: false,
        error: 'No tenant context — featureGate requires tenantResolver',
      });
    }

    const snap = await loadFeatureSnapshot(tenantId);
    const enabled = snap.flags[featureKey] === true;
    if (!enabled) {
      return reply.status(403).send({
        success: false,
        error: `Feature '${featureKey}' is not enabled for this tenant. Upgrade your plan or contact support.`,
      });
    }
  };
}
