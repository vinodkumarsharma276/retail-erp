import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The tenant a piece of work belongs to, carried implicitly through every
 * async call made while handling one request (or one job run).
 *
 * `database.ts` reads it to scope every Prisma query on a tenant-owned
 * model to that tenant — so a service that forgets `where: { tenantId }`
 * still can't read or change another tenant's rows.
 *
 * - API requests: `app.ts` opens a context per request; `tenantResolver`
 *   fills in the tenant id once the subdomain / header is resolved.
 * - Platform-admin routes, seeds and jobs run with no tenant id, i.e.
 *   unscoped; they filter by tenant explicitly where it matters.
 */
export interface TenantStore {
  tenantId?: string;
}

// One instance per process. The Prisma client is cached on globalThis (see
// database.ts), so if this module were ever evaluated twice (hot reload, test
// runners) a second storage instance would leave queries silently unscoped.
const globalForTenant = globalThis as unknown as { tenantStorage?: AsyncLocalStorage<TenantStore> };
const storage = (globalForTenant.tenantStorage ??= new AsyncLocalStorage<TenantStore>());

export const tenantContext = {
  /** Open an empty context; the tenant id is filled in later in the request. */
  run<T>(fn: () => T): T {
    return storage.run({}, fn);
  },

  /**
   * Run `fn` scoped to one tenant (jobs, scripts, tests). Awaits inside the
   * context: Prisma queries are lazy and only execute when awaited, so a
   * query returned un-awaited would otherwise run outside it, unscoped.
   */
  runAs<T>(tenantId: string, fn: () => T | PromiseLike<T>): Promise<T> {
    return storage.run({ tenantId }, async () => await fn());
  },

  /** Run `fn` with no tenant scoping, even inside a request. Use sparingly. */
  runUnscoped<T>(fn: () => T | PromiseLike<T>): Promise<T> {
    return storage.run({}, async () => await fn());
  },

  setTenant(tenantId: string): void {
    const store = storage.getStore();
    if (store) store.tenantId = tenantId;
  },

  currentTenantId(): string | undefined {
    return storage.getStore()?.tenantId;
  },
};
