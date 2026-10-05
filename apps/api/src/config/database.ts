import { Prisma, PrismaClient } from '@prisma/client';
import { tenantContext } from './tenant-context.js';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const baseClient = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

/** Every model that has a `tenantId` column — derived from the schema, so new models are covered automatically. */
export const TENANT_SCOPED_MODELS: ReadonlySet<string> = new Set(
  Prisma.dmmf.datamodel.models
    .filter((m) => m.fields.some((f) => f.name === 'tenantId'))
    .map((m) => m.name),
);

const WHERE_OPERATIONS = new Set([
  'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany',
  'count', 'aggregate', 'groupBy',
  'update', 'updateMany', 'updateManyAndReturn',
  'delete', 'deleteMany', 'upsert',
]);

function stampTenant(data: Record<string, unknown>, tenantId: string, model: string) {
  if (data.tenantId !== undefined && data.tenantId !== tenantId) {
    throw new Error(`Blocked a cross-tenant write to ${model}.`);
  }
  // Relation-style writes (`tenant: { connect }`) can't also take `tenantId`.
  if (data.tenantId === undefined && data.tenant === undefined) data.tenantId = tenantId;
}

/**
 * Tenant isolation, enforced in one place: while a request (or job) runs for
 * a tenant, every query on a tenant-owned model is limited to that tenant,
 * and every row it creates is stamped with it. Writing a row for a different
 * tenant throws. Outside a tenant context (platform admin, seeds) queries
 * run unchanged.
 *
 * Not covered: raw SQL (`$queryRaw*`) — that code must filter by tenant
 * itself — and relation filters nested inside `include`/`select`, which only
 * ever reach rows hanging off an already-scoped parent.
 */
const scopedClient = baseClient.$extends({
  name: 'tenant-isolation',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const tenantId = tenantContext.currentTenantId();
        if (!tenantId || !model || !TENANT_SCOPED_MODELS.has(model)) return query(args);

        const a = (args ?? {}) as Record<string, any>;
        if (WHERE_OPERATIONS.has(operation)) {
          a.where = { ...(a.where ?? {}), tenantId };
        }
        if (operation === 'create' || operation === 'upsert') {
          const data = operation === 'create' ? a.data : a.create;
          if (data) stampTenant(data, tenantId, model);
        }
        if (operation === 'createMany' || operation === 'createManyAndReturn') {
          const rows = Array.isArray(a.data) ? a.data : [a.data];
          for (const row of rows) stampTenant(row, tenantId, model);
        }
        return query(a);
      },
    },
  },
});

/**
 * Typed as a plain PrismaClient so existing code (and functions that take a
 * `PrismaClient`) keep compiling; at runtime it is the tenant-scoped client,
 * including inside `$transaction` callbacks.
 */
export const prisma: PrismaClient =
  globalForPrisma.prisma ?? (scopedClient as unknown as PrismaClient);

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

/** The raw client, with no tenant scoping. Only for platform-wide work. */
export const unscopedPrisma = baseClient;
