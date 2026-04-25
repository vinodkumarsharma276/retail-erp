import { prisma } from '../../config/database.js';
import { invalidatePermissionCache } from '../../middleware/permissions.js';
import { PERMISSION_GROUPS } from '@retailerp/shared-types';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

const SEED_DEFAULT_PASSWORD = 'RetailERP@2026';

/** Generate a memorable random password: e.g. "Brave-Otter-7421". */
function generatePassword(): string {
  const adj = ['Brave', 'Quick', 'Calm', 'Bold', 'Bright', 'Lucky', 'Swift', 'Wise', 'Eager', 'Royal'];
  const animal = ['Otter', 'Tiger', 'Falcon', 'Lynx', 'Panda', 'Eagle', 'Wolf', 'Hawk', 'Fox', 'Bear'];
  const a = adj[Math.floor(Math.random() * adj.length)];
  const b = animal[Math.floor(Math.random() * animal.length)];
  const n = 1000 + crypto.randomInt(0, 9000);
  return `${a}-${b}-${n}`;
}

export const rolesService = {
  async listGroups() {
    return PERMISSION_GROUPS;
  },

  async listRoles() {
    const roles = await prisma.role.findMany({
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      include: {
        rolePermissions: { select: { permission: { select: { key: true } } } },
        _count: { select: { users: true } },
      },
    });
    return roles.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      isActive: r.isActive,
      userCount: r._count.users,
      permissions: r.rolePermissions.map((rp) => rp.permission.key),
    }));
  },

  async getRole(id: string) {
    const r = await prisma.role.findUnique({
      where: { id },
      include: {
        rolePermissions: { select: { permission: { select: { key: true } } } },
      },
    });
    if (!r) return null;
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      isActive: r.isActive,
      permissions: r.rolePermissions.map((rp) => rp.permission.key),
    };
  },

  async createRole(input: { code: string; name: string; description?: string }) {
    return prisma.role.create({
      data: {
        code: input.code,
        name: input.name,
        description: input.description ?? null,
        isSystem: false,
      },
    });
  },

  async updateRole(id: string, input: { name?: string; description?: string; isActive?: boolean }) {
    return prisma.role.update({
      where: { id },
      data: input,
    });
  },

  async deleteRole(id: string) {
    const role = await prisma.role.findUnique({ where: { id } });
    if (!role) throw new Error('Role not found');
    if (role.isSystem) throw new Error('System roles cannot be deleted');
    const userCount = await prisma.user.count({ where: { roleId: id } });
    if (userCount > 0) throw new Error(`Role is assigned to ${userCount} user(s)`);
    await prisma.role.delete({ where: { id } });
    invalidatePermissionCache(id);
  },

  async setRolePermissions(roleId: string, permissionKeys: string[]) {
    const perms = await prisma.permission.findMany({
      where: { key: { in: permissionKeys } },
      select: { id: true, key: true },
    });

    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId } }),
      prisma.rolePermission.createMany({
        data: perms.map((p) => ({ roleId, permissionId: p.id })),
        skipDuplicates: true,
      }),
    ]);
    invalidatePermissionCache(roleId);
    return perms.map((p) => p.key);
  },

  async cloneRole(sourceRoleId: string, newCode: string, newName: string) {
    const source = await prisma.role.findUnique({
      where: { id: sourceRoleId },
      include: { rolePermissions: true },
    });
    if (!source) throw new Error('Source role not found');

    return prisma.$transaction(async (tx) => {
      const newRole = await tx.role.create({
        data: {
          code: newCode,
          name: newName,
          description: `Cloned from ${source.name}`,
          isSystem: false,
        },
      });
      if (source.rolePermissions.length > 0) {
        await tx.rolePermission.createMany({
          data: source.rolePermissions.map((rp) => ({
            roleId: newRole.id,
            permissionId: rp.permissionId,
          })),
        });
      }
      return newRole;
    });
  },

  async listUsers() {
    const users = await prisma.user.findMany({
      orderBy: [{ role: 'asc' }, { username: 'asc' }],
      select: {
        id: true,
        username: true,
        passwordHash: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        roleId: true,
        isActive: true,
        isMobileOnly: true,
        lastLoginAt: true,
        customRole: { select: { id: true, code: true, name: true } },
        userShops: { select: { shop: { select: { id: true, code: true, name: true } } } },
      },
    });

    // Detect users still on the seeded default password so the Owner can see
    // it. We compare each hash once — bcrypt is slow so this is a small per-
    // request cost; the user list is bounded (<100 in this product).
    return Promise.all(
      users.map(async (u) => {
        const stillDefault = await bcrypt.compare(SEED_DEFAULT_PASSWORD, u.passwordHash);
        const { passwordHash, ...rest } = u;
        return {
          ...rest,
          knownPassword: stillDefault ? SEED_DEFAULT_PASSWORD : null,
        };
      }),
    );
  },

  async assignUserRole(userId: string, roleId: string | null) {
    let legacyRole: 'owner' | 'admin' | 'accountant' | 'others' | 'employee' | undefined;
    if (roleId) {
      const role = await prisma.role.findUnique({ where: { id: roleId } });
      if (!role) throw new Error('Role not found');
      // Mirror the legacy enum when the assigned role is one of the system roles.
      if (['owner', 'admin', 'accountant', 'others', 'employee'].includes(role.code)) {
        legacyRole = role.code as typeof legacyRole;
      }
    }
    return prisma.user.update({
      where: { id: userId },
      data: {
        roleId,
        ...(legacyRole ? { role: legacyRole } : {}),
      },
    });
  },

  async resetPassword(userId: string, newPasswordOverride?: string) {
    if (newPasswordOverride !== undefined && newPasswordOverride.length < 4) {
      throw new Error('Password must be at least 4 characters');
    }

    const newPassword = newPasswordOverride ?? generatePassword();
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
    // Revoke all refresh tokens to force re-login.
    await prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { newPassword };
  },
};
