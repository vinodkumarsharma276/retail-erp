/**
 * Tenant resolver middleware.
 *
 * Runs on every request BEFORE auth/shopScope. Resolves the active tenant
 * by inspecting (in order):
 *   1. `X-Tenant-Slug` header  — mobile app + manual API clients.
 *   2. Host header subdomain   — e.g. `vn.retailerp.com` → slug `vn`.
 *   3. Local-dev fallback      — `localhost` / `127.0.0.1` / `*.localhost`
 *      maps to the bootstrap tenant (slug from `BOOTSTRAP_TENANT_SLUG` env
 *      var, defaulting to `vn`).
 *
 * If the tenant cannot be resolved, the request is rejected with 404 so
 * subdomain typos surface clearly rather than landing in the default
 * tenant. Routes scoped to the platform admin (e.g. `admin.retailerp.com`
 * or `/api/v1/platform/*`) are handled separately by `platform-auth.ts`
 * and bypass this middleware.
 *
 * Resolved tenant is attached to `request.tenant` for downstream consumers.
 * The lookup is cached in-process for `TENANT_CACHE_TTL_MS` (default 60s)
 * to avoid hammering the DB on every request.
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../config/database.js';
import { tenantContext } from '../config/tenant-context.js';

const BOOTSTRAP_TENANT_SLUG = process.env.BOOTSTRAP_TENANT_SLUG ?? 'vn';
const TENANT_CACHE_TTL_MS = 60_000;

/**
 * Apex domains under which we treat the first label as the tenant slug.
 * Configurable via env so dev / staging / prod can each have their own.
 * In dev we also accept `*.localhost` and bare `localhost`.
 */
const APEX_DOMAINS = (process.env.TENANT_APEX_DOMAINS ?? 'retailerp.com')
  .split(',')
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

interface CachedTenant {
  id: string;
  slug: string;
  name: string;
  planId: string;
  status: string;
  settings: unknown;
  expiresAt: number;
}

const tenantBySlugCache = new Map<string, CachedTenant>();

/** Invalidate cache entry — exported for platform admin endpoints to call after updates. */
export function invalidateTenantCache(slug?: string): void {
  if (slug) {
    tenantBySlugCache.delete(slug);
  } else {
    tenantBySlugCache.clear();
  }
}

async function loadTenantBySlug(slug: string): Promise<CachedTenant | null> {
  const now = Date.now();
  const cached = tenantBySlugCache.get(slug);
  if (cached && cached.expiresAt > now) {
    return cached;
  }
  const row = await prisma.tenant.findUnique({
    where: { slug },
    select: { id: true, slug: true, name: true, planId: true, status: true, settings: true },
  });
  if (!row) return null;
  const entry: CachedTenant = {
    ...row,
    expiresAt: now + TENANT_CACHE_TTL_MS,
  };
  tenantBySlugCache.set(slug, entry);
  return entry;
}

/**
 * Extract the tenant slug from the request:
 *   1. `X-Tenant-Slug` header if present and non-empty.
 *   2. First label of the Host header when host matches an apex in APEX_DOMAINS.
 *   3. Localhost dev fallback → BOOTSTRAP_TENANT_SLUG.
 * Returns null when no slug can be determined.
 */
export function extractTenantSlugFromRequest(request: FastifyRequest): string | null {
  // 1. Explicit header (highest priority — mobile app, automated tests).
  const headerSlug = request.headers['x-tenant-slug'];
  if (typeof headerSlug === 'string' && headerSlug.trim().length > 0) {
    return headerSlug.trim().toLowerCase();
  }

  // 2. Subdomain of Host header.
  const host = (request.headers.host ?? '').toLowerCase().split(':')[0];
  if (!host) return null;

  // Local-dev fallback. `vn.localhost` is also supported as a developer
  // convenience for testing real subdomain routing.
  if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') {
    return BOOTSTRAP_TENANT_SLUG;
  }
  if (host.endsWith('.localhost')) {
    const sub = host.split('.')[0];
    return sub.length > 0 ? sub : BOOTSTRAP_TENANT_SLUG;
  }

  // Production subdomain pattern: `<slug>.<apex>`.
  for (const apex of APEX_DOMAINS) {
    if (host === apex) {
      // Bare apex without subdomain — no implicit tenant. Used for marketing
      // / landing site only; API routes should reject.
      return null;
    }
    if (host.endsWith(`.${apex}`)) {
      const sub = host.slice(0, -1 - apex.length);
      // Disallow multi-label subdomains for now (e.g. `foo.bar.retailerp.com`).
      if (!sub.includes('.')) return sub;
    }
  }

  return null;
}

/**
 * Fastify middleware: resolve tenant and attach to `request.tenant`. The
 * platform-admin and health-check routes bypass this by checking the URL
 * prefix before consulting the resolver — they have no tenant context.
 *
 * Routes that need tenant context must include this middleware before
 * `authenticate` / `shopScope` in their preHandler chain. For convenience,
 * `app.ts` registers an `onRequest` hook that runs it globally for every
 * non-bypassed path.
 */
export async function tenantResolver(request: FastifyRequest, reply: FastifyReply) {
  // Bypass: platform-admin endpoints + health + readiness probes.
  const url = request.url ?? '';
  if (
    url === '/api/health' ||
    url === '/api/ready' ||
    url.startsWith('/api/v1/platform/')
  ) {
    return;
  }

  const slug = extractTenantSlugFromRequest(request);
  if (!slug) {
    return reply.status(404).send({
      success: false,
      error:
        'No tenant context found. Use a tenant subdomain (e.g. vn.retailerp.com) or send X-Tenant-Slug header.',
    });
  }

  const tenant = await loadTenantBySlug(slug);
  if (!tenant) {
    return reply.status(404).send({
      success: false,
      error: `Tenant '${slug}' not found.`,
    });
  }

  if (tenant.status === 'suspended' || tenant.status === 'cancelled') {
    return reply.status(403).send({
      success: false,
      error: `Tenant '${slug}' is ${tenant.status}. Contact support.`,
    });
  }

  tenantContext.setTenant(tenant.id);
  request.tenant = {
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    planId: tenant.planId,
    status: tenant.status,
    settings: tenant.settings,
  };
}
