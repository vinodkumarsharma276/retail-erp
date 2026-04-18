import type { PrismaClient } from '@prisma/client';
import {
  PERMISSION_GROUPS,
  SYSTEM_ROLES,
} from '@retailerp/shared-types';

/**
 * Seeds the permission catalog and the 5 system roles (owner / admin /
 * accountant / others / employee). Idempotent — safe to re-run.
 */
export async function seedRolesAndPermissions(prisma: PrismaClient) {
  // 1. Upsert all permissions from the catalog.
  const allPerms = PERMISSION_GROUPS.flatMap((g) => g.permissions);
  for (const p of allPerms) {
    await prisma.permission.upsert({
      where: { key: p.key },
      update: { module: p.module, description: p.description },
      create: { key: p.key, module: p.module, description: p.description },
    });
  }

  // 2. Upsert each system role and reset its permission grants to match the template.
  for (const role of SYSTEM_ROLES) {
    const r = await prisma.role.upsert({
      where: { code: role.code },
      update: { name: role.name, description: role.description, isSystem: true, isActive: true },
      create: {
        code: role.code,
        name: role.name,
        description: role.description,
        isSystem: true,
        isActive: true,
      },
    });

    // Wipe existing grants and reinstall — keeps system role permissions in sync
    // with the catalog when new permissions are added or templates change.
    await prisma.rolePermission.deleteMany({ where: { roleId: r.id } });

    const permRows = await prisma.permission.findMany({
      where: { key: { in: role.permissions as unknown as string[] } },
      select: { id: true },
    });
    if (permRows.length > 0) {
      await prisma.rolePermission.createMany({
        data: permRows.map((p) => ({ roleId: r.id, permissionId: p.id })),
        skipDuplicates: true,
      });
    }
  }

  const totalPerms = await prisma.permission.count();
  const totalRoles = await prisma.role.count();
  return { permissions: totalPerms, roles: totalRoles };
}
