import { describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { parseTrustProxy, productionConfigProblems } from '../../src/config/index.js';
import { extractTenantSlugFromRequest } from '../../src/middleware/tenant-resolver.js';
import { createTenantSchema } from '../../src/modules/platform/platform.validation.js';

const strong = 'a'.repeat(40);
const strong2 = 'b'.repeat(40);
const prodEnv = {
  NODE_ENV: 'production',
  JWT_SECRET: strong,
  JWT_REFRESH_SECRET: strong2,
  DATABASE_URL: 'postgresql://u:p@db:5432/retailerp',
  CORS_ORIGIN: 'https://vn.retailerpai.com,https://admin.retailerpai.com',
} as NodeJS.ProcessEnv;

describe('productionConfigProblems', () => {
  it('accepts a complete production configuration', () => {
    expect(productionConfigProblems(prodEnv)).toEqual([]);
  });

  it('ignores development', () => {
    expect(productionConfigProblems({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toEqual([]);
  });

  it('rejects missing, short, placeholder, dev or identical JWT secrets', () => {
    expect(productionConfigProblems({ ...prodEnv, JWT_SECRET: undefined })).toHaveLength(1);
    expect(productionConfigProblems({ ...prodEnv, JWT_SECRET: 'short' })).toHaveLength(1);
    expect(productionConfigProblems({ ...prodEnv, JWT_SECRET: '<generate-a-strong-secret-of-many-chars>' })).toHaveLength(1);
    expect(productionConfigProblems({ ...prodEnv, JWT_REFRESH_SECRET: 'dev-refresh-secret' })).toHaveLength(1);
    expect(productionConfigProblems({ ...prodEnv, JWT_REFRESH_SECRET: strong })).toEqual([
      'JWT_SECRET and JWT_REFRESH_SECRET must differ.',
    ]);
  });

  it('requires exact https CORS origins and a database URL', () => {
    expect(productionConfigProblems({ ...prodEnv, CORS_ORIGIN: '' })).toHaveLength(1);
    expect(productionConfigProblems({ ...prodEnv, CORS_ORIGIN: '*' })).toHaveLength(1);
    expect(productionConfigProblems({ ...prodEnv, CORS_ORIGIN: 'http://vn.retailerpai.com' })).toHaveLength(1);
    expect(productionConfigProblems({ ...prodEnv, DATABASE_URL: '' })).toHaveLength(1);
  });
});

describe('parseTrustProxy', () => {
  it('parses off, on, hop counts and address lists', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('172.16.0.0/12, 127.0.0.1')).toEqual(['172.16.0.0/12', '127.0.0.1']);
  });
});

describe('tenant resolution on the hosted domain', () => {
  const request = (host: string, slug?: string) =>
    ({ headers: { host, ...(slug ? { 'x-tenant-slug': slug } : {}) } }) as unknown as FastifyRequest;

  it('reads the tenant from <slug>.retailerpai.com by default', () => {
    expect(extractTenantSlugFromRequest(request('vn.retailerpai.com'))).toBe('vn');
    expect(extractTenantSlugFromRequest(request('retailerpai.com'))).toBeNull();
    expect(extractTenantSlugFromRequest(request('a.b.retailerpai.com'))).toBeNull();
  });

  it('prefers the X-Tenant-Slug header (web and app calling api.retailerpai.com)', () => {
    expect(extractTenantSlugFromRequest(request('api.retailerpai.com', 'vn'))).toBe('vn');
  });
});

describe('reserved tenant slugs', () => {
  const base = {
    name: 'Test',
    planCode: 'standard',
    owner: { username: 'owner', password: 'password123', fullName: 'Owner', phone: '9999999999' },
  };
  it('refuses deployment host names as tenant slugs', () => {
    expect(createTenantSchema.safeParse({ ...base, slug: 'shop1' }).success).toBe(true);
    for (const slug of ['api', 'admin', 'www']) {
      const result = createTenantSchema.safeParse({ ...base, slug });
      expect(result.success).toBe(false);
      expect(result.error?.issues.map((i) => i.message)).toEqual(['This slug is reserved for the platform']);
    }
  });
});
