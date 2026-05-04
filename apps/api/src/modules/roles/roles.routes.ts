import type { FastifyInstance } from 'fastify';
import { rolesController } from './roles.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission, requireAnyPermission } from '../../middleware/permissions.js';

export async function rolesRoutes(app: FastifyInstance) {
  // Permission catalog (read) — anyone who can see the roles UI can fetch the
  // catalog; gating is via roles.list.
  app.get('/permissions/catalog', {
    preHandler: [authenticate, requireAnyPermission('roles.list', 'users.list')],
  }, rolesController.listGroups);

  app.get('/', {
    preHandler: [authenticate, requirePermission('roles.list')],
  }, rolesController.listRoles);

  app.get('/:id', {
    preHandler: [authenticate, requirePermission('roles.list')],
  }, rolesController.getRole as any);

  app.post('/', {
    preHandler: [authenticate, requirePermission('roles.create')],
  }, rolesController.createRole as any);

  app.put('/:id', {
    preHandler: [authenticate, requirePermission('roles.edit_permissions')],
  }, rolesController.updateRole as any);

  app.delete('/:id', {
    preHandler: [authenticate, requirePermission('roles.delete')],
  }, rolesController.deleteRole as any);

  app.put('/:id/permissions', {
    preHandler: [authenticate, requirePermission('roles.edit_permissions')],
  }, rolesController.setPermissions as any);

  app.post('/:id/clone', {
    preHandler: [authenticate, requirePermission('roles.create')],
  }, rolesController.cloneRole as any);

  // Users — list + role assignment lives here so the Owner can manage them in
  // one place.
  app.get('/users', {
    preHandler: [authenticate, requirePermission('users.list')],
  }, rolesController.listUsers);

  app.put('/users/:userId/role', {
    preHandler: [authenticate, requirePermission('users.change_role')],
  }, rolesController.assignUserRole as any);

  app.post('/users/:userId/reset-password', {
    preHandler: [authenticate, requirePermission('users.reset_password')],
  }, rolesController.resetPassword as any);

  // Per-user permission overrides — Owner-only by default (gated by
  // the new `users.edit_permissions` key).
  app.get('/users/:userId/permissions', {
    preHandler: [authenticate, requirePermission('users.edit_permissions')],
  }, rolesController.getUserPermissions as any);

  app.put('/users/:userId/permissions', {
    preHandler: [authenticate, requirePermission('users.edit_permissions')],
  }, rolesController.setUserPermissions as any);
}
