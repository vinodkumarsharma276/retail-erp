import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../config/database';

/**
 * Two in-memory caches:
 *   - `roleCache` maps `roleId → Set<permissionKey>` (just the role's grants).
 *     Still useful for the Roles UI which displays a role's base permissions.
 *   - `userCache` maps `userId → Set<permissionKey>` of EFFECTIVE permissions
 *     for that user (`role ∪ user.grants ∖ user.denies`). This is the set
 *     consulted by `requirePermission` / `requireAnyPermission`.
 *
 * Both caches are invalidated when permissions change. Role mutations clear
 * every userCache entry (cheap; the user list is small in this product).
 */
const roleCache = new Map<string, Set<string>>();
const userCache = new Map<string, Set<string>>();

/**
 * Invalidate cached permissions.
 *  - `invalidatePermissionCache()` — clear everything (safe default).
 *  - `invalidatePermissionCache({ roleId })` — clear that role's row AND all
 *    user caches (since users in that role just changed effective perms).
 *  - `invalidatePermissionCache({ userId })` — clear just one user's row,
 *    used after editing per-user overrides or re-assigning their role.
 */
export function invalidatePermissionCache(target?: { roleId?: string; userId?: string }) {
  if (!target) {
    roleCache.clear();
    userCache.clear();
    return;
  }
  if (target.roleId) {
    roleCache.delete(target.roleId);
    // Conservative: a role permission change can affect any user in that
    // role. We don't track userId→roleId in the cache, so wipe all users.
    userCache.clear();
  }
  if (target.userId) {
    userCache.delete(target.userId);
  }
}

/**
 * Returns the raw set of permission keys granted to a role. Does NOT apply
 * any per-user overrides — use `loadEffectivePermissionsForUser` for that.
 */
export async function loadPermissionsForRole(roleId: string): Promise<Set<string>> {
  const hit = roleCache.get(roleId);
  if (hit) return hit;
  const rows = await prisma.rolePermission.findMany({
    where: { roleId },
    select: { permission: { select: { key: true } } },
  });
  const set = new Set(rows.map((r) => r.permission.key));
  roleCache.set(roleId, set);
  return set;
}

/**
 * Returns the EFFECTIVE permission set for a user. Layers per-user grants
 * and denies on top of the role's permissions:
 *   `effective = (rolePerms ∪ userGrants) ∖ userDenies`.
 *
 * Cached per user; invalidated on role / override changes.
 */
export async function loadEffectivePermissionsForUser(userId: string): Promise<Set<string>> {
  const hit = userCache.get(userId);
  if (hit) return hit;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      roleId: true,
      permissionOverrides: {
        select: {
          effect: true,
          permission: { select: { key: true } },
        },
      },
    },
  });

  const set = new Set<string>();
  if (user?.roleId) {
    const rolePerms = await loadPermissionsForRole(user.roleId);
    rolePerms.forEach((k) => set.add(k));
  }
  for (const override of user?.permissionOverrides ?? []) {
    if (override.effect === 'grant') set.add(override.permission.key);
  }
  for (const override of user?.permissionOverrides ?? []) {
    if (override.effect === 'deny') set.delete(override.permission.key);
  }

  userCache.set(userId, set);
  return set;
}

async function ensurePermissionsLoaded(request: FastifyRequest): Promise<Set<string>> {
  if (!request.currentUser) return new Set();
  if (request.currentUser.permissions) return request.currentUser.permissions;

  const perms = await loadEffectivePermissionsForUser(request.currentUser.userId);
  request.currentUser.permissions = perms;
  return perms;
}

/**
 * Fastify preHandler that requires the current user's effective permission
 * set to grant the given key. Owner bypasses (Owner has every catalog perm
 * by default; per-user denies on Owner are still respected since this
 * resolver consults the same set).
 */
export function requirePermission(key: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.currentUser) {
      return reply.status(401).send({ success: false, error: 'Authentication required' });
    }
    const perms = await ensurePermissionsLoaded(request);
    if (!perms.has(key)) {
      return reply
        .status(403)
        .send({ success: false, error: `Missing permission: ${key}` });
    }
  };
}

/** Require at least one of the listed permissions. */
export function requireAnyPermission(...keys: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.currentUser) {
      return reply.status(401).send({ success: false, error: 'Authentication required' });
    }
    const perms = await ensurePermissionsLoaded(request);
    if (!keys.some((k) => perms.has(k))) {
      return reply
        .status(403)
        .send({ success: false, error: `Missing one of: ${keys.join(', ')}` });
    }
  };
}

/** Helper used by other route handlers to fetch the current user's perms. */
export async function getCurrentUserPermissions(request: FastifyRequest): Promise<string[]> {
  const perms = await ensurePermissionsLoaded(request);
  return Array.from(perms);
}
