import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../config/database';

/**
 * In-memory cache: roleId → Set<permissionKey>. Refreshed when a Role's
 * permissions are mutated through the API (call `invalidatePermissionCache`).
 */
const cache = new Map<string, Set<string>>();

export function invalidatePermissionCache(roleId?: string) {
  if (roleId) cache.delete(roleId);
  else cache.clear();
}

export async function loadPermissionsForRole(roleId: string): Promise<Set<string>> {
  const hit = cache.get(roleId);
  if (hit) return hit;
  const rows = await prisma.rolePermission.findMany({
    where: { roleId },
    select: { permission: { select: { key: true } } },
  });
  const set = new Set(rows.map((r) => r.permission.key));
  cache.set(roleId, set);
  return set;
}

async function ensurePermissionsLoaded(request: FastifyRequest): Promise<Set<string>> {
  if (!request.currentUser) return new Set();
  if (request.currentUser.permissions) return request.currentUser.permissions;

  // Look up the user's roleId fresh — token doesn't carry it.
  const user = await prisma.user.findUnique({
    where: { id: request.currentUser.userId },
    select: { roleId: true },
  });
  request.currentUser.roleId = user?.roleId ?? null;

  if (!user?.roleId) {
    request.currentUser.permissions = new Set();
    return request.currentUser.permissions;
  }

  const perms = await loadPermissionsForRole(user.roleId);
  request.currentUser.permissions = perms;
  return perms;
}

/**
 * Fastify preHandler that requires the current user's role to grant the given
 * permission key. Owner and admin who have it via their role pass; users with
 * no `roleId` (legacy) fall through and are denied — they should be migrated.
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
